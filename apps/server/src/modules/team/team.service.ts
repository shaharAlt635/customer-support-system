import type { PrismaClient } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  type InvitationDTO,
  type InviteInput,
  type MyInvitationDTO,
  type UpdateMemberInput,
  type UserDTO,
  type UserSummaryDTO,
} from '@support-desk/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import type { Mailer } from '../../email/mailer';
import { invitationMessage } from '../../email/templates';
import { Errors } from '../../lib/errors';
import {
  invitationInclude,
  toInvitationDTO,
  toUserDTO,
  toUserSummaryDTO,
  userSelect,
  userSummarySelect,
} from '../../serializers';
import type { AuthUser } from '../../types';
import type { GroupService } from '../groups/groups.service';
import type { NotificationService } from '../notifications/notifications.service';

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The company's support team: the owner plus agents. People join only by invitation —
 * a manager invites an email, and the person accepts or declines from their own account.
 */
export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly groups: GroupService,
    private readonly notifications: NotificationService,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async listMembers(companyId: string): Promise<UserDTO[]> {
    const members = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['OWNER', 'AGENT'] } },
      select: userSelect,
      orderBy: { name: 'asc' },
    });
    // Owner first, then agents alphabetically.
    return members
      .sort((a, b) => Number(b.role === 'OWNER') - Number(a.role === 'OWNER'))
      .map(toUserDTO);
  }

  /** Active team members tickets can be assigned to. */
  async listAssignable(companyId: string): Promise<UserSummaryDTO[]> {
    const users = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['OWNER', 'AGENT'] }, isActive: true },
      select: userSummarySelect,
      orderBy: { name: 'asc' },
    });
    return users.map(toUserSummaryDTO);
  }

  async changeGroup(actor: AuthUser, memberId: string, input: UpdateMemberInput): Promise<UserDTO> {
    const member = await this.findAgent(actor, memberId);
    if (member.id === actor.id) {
      throw Errors.badRequest("You can't change your own permission group", 'SELF_ACCESS_CHANGE');
    }
    await this.groups.findInCompany(actor.companyId, input.groupId);
    const updated = await this.prisma.user.update({
      where: { id: memberId },
      data: { groupId: input.groupId },
      select: userSelect,
    });
    return toUserDTO(updated);
  }

  /** Remove an agent from the team: their account becomes a customer account again. */
  async removeMember(actor: AuthUser, memberId: string): Promise<void> {
    const member = await this.findAgent(actor, memberId);
    if (member.id === actor.id) {
      throw Errors.badRequest("You can't remove yourself from the team", 'SELF_ACCESS_CHANGE');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: memberId },
        data: { role: 'CUSTOMER', groupId: null },
      }),
      // Return their open work to the queue.
      this.prisma.ticket.updateMany({
        where: {
          companyId: actor.companyId,
          assigneeId: memberId,
          status: { in: [...ACTIVE_STATUSES] },
        },
        data: { assigneeId: null },
      }),
    ]);
  }

  private async findAgent(actor: AuthUser, memberId: string) {
    const member = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!member || member.companyId !== actor.companyId || member.role === 'CUSTOMER') {
      throw Errors.notFound('Team member');
    }
    if (member.role === 'OWNER') {
      throw Errors.forbidden("The company owner can't be changed or removed", 'OWNER_PROTECTED');
    }
    return member;
  }

  // ---------------------------------------------------------------------------
  // Invitations (company side)
  // ---------------------------------------------------------------------------

  async listInvitations(companyId: string): Promise<InvitationDTO[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: { companyId, status: 'PENDING' },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });
    const accounts = await this.prisma.user.findMany({
      where: { companyId, email: { in: invitations.map((i) => i.email) } },
      select: { email: true },
    });
    const withAccount = new Set(accounts.map((a) => a.email));
    return invitations.map((i) => toInvitationDTO(i, withAccount.has(i.email)));
  }

  async invite(actor: AuthUser, input: InviteInput): Promise<InvitationDTO> {
    const group = await this.groups.findInCompany(actor.companyId, input.groupId);
    const account = await this.prisma.user.findUnique({
      where: { companyId_email: { companyId: actor.companyId, email: input.email } },
    });
    if (account && account.role !== 'CUSTOMER') {
      throw Errors.conflict('This person is already on the team', 'ALREADY_MEMBER');
    }
    if (account && !account.isActive) {
      throw Errors.conflict(
        'This account is deactivated. Reactivate it on the Customers page first.',
        'ACCOUNT_DISABLED',
      );
    }
    const pending = await this.prisma.invitation.findFirst({
      where: { companyId: actor.companyId, email: input.email, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      throw Errors.conflict(
        'This email already has a pending invitation. Resend it instead.',
        'INVITATION_PENDING',
      );
    }

    const invitation = await this.prisma.invitation.create({
      data: {
        companyId: actor.companyId,
        email: input.email,
        groupId: group.id,
        invitedById: actor.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        respondedAt: null,
      },
      include: invitationInclude,
    });

    await this.deliver(invitation.id, account?.id ?? null);
    return toInvitationDTO(invitation, Boolean(account));
  }

  /** Send the invitation again and extend its expiry. */
  async resend(actor: AuthUser, invitationId: string): Promise<InvitationDTO> {
    await this.findPendingForCompany(actor.companyId, invitationId);
    const invitation = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
      include: invitationInclude,
    });
    const account = await this.prisma.user.findUnique({
      where: { companyId_email: { companyId: actor.companyId, email: invitation.email } },
      select: { id: true },
    });
    await this.deliver(invitation.id, account?.id ?? null);
    return toInvitationDTO(invitation, Boolean(account));
  }

  async revoke(actor: AuthUser, invitationId: string): Promise<void> {
    await this.findPendingForCompany(actor.companyId, invitationId);
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });
  }

  private async findPendingForCompany(companyId: string, id: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invitation || invitation.companyId !== companyId || invitation.status !== 'PENDING') {
      throw Errors.notFound('Invitation');
    }
    return invitation;
  }

  /** Email the invitation and, if the person already has an account, ping their bell. */
  private async deliver(invitationId: string, accountId: string | null) {
    const invitation = await this.prisma.invitation.findUniqueOrThrow({
      where: { id: invitationId },
      include: { ...invitationInclude, company: { select: { name: true, slug: true } } },
    });
    const { company } = invitation;
    const base = `${this.config.APP_URL}/${company.slug}`;
    const url = accountId
      ? `${base}/invitations`
      : `${base}/register?email=${encodeURIComponent(invitation.email)}`;

    try {
      await this.mailer.send(
        invitationMessage({
          to: invitation.email,
          companyName: company.name,
          inviterName: invitation.invitedBy.name,
          groupName: invitation.group.name,
          url,
          hasAccount: Boolean(accountId),
        }),
      );
    } catch (error) {
      this.log.error({ err: error, to: invitation.email }, 'Failed to send invitation email');
    }

    if (accountId) {
      await this.notifications.notify([
        {
          userId: accountId,
          type: 'INVITATION',
          title: `${invitation.invitedBy.name} invited you to join the ${company.name} team`,
          link: '/invitations',
        },
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Invitations (invited user's side)
  // ---------------------------------------------------------------------------

  async myInvitations(user: AuthUser): Promise<MyInvitationDTO[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: {
        companyId: user.companyId,
        email: user.email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        group: { select: { id: true, name: true } },
        invitedBy: { select: { name: true } },
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      company: invitation.company,
      group: invitation.group,
      invitedBy: invitation.invitedBy,
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    }));
  }

  /** Accepting turns the user's customer account into an agent account in the chosen group. */
  async accept(user: AuthUser, invitationId: string): Promise<void> {
    const invitation = await this.findMine(user, invitationId);
    if (user.role !== 'CUSTOMER') {
      throw Errors.conflict('You are already on this team', 'ALREADY_MEMBER');
    }
    const group = await this.prisma.permissionGroup.findUnique({
      where: { id: invitation.groupId },
    });
    if (!group || group.companyId !== user.companyId) {
      throw Errors.conflict('This invitation is no longer valid', 'INVITATION_INVALID');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { role: 'AGENT', groupId: group.id },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', respondedAt: now },
      }),
    ]);
    await this.notifyInviter(invitation.invitedById, `${user.name} joined the team`);
  }

  async decline(user: AuthUser, invitationId: string): Promise<void> {
    const invitation = await this.findMine(user, invitationId);
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    await this.notifyInviter(invitation.invitedById, `${user.name} declined your invitation`);
  }

  private async findMine(user: AuthUser, id: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    const isMine =
      invitation &&
      invitation.companyId === user.companyId &&
      invitation.email === user.email &&
      invitation.status === 'PENDING';
    if (!isMine) throw Errors.notFound('Invitation');
    if (invitation.expiresAt <= new Date()) {
      throw Errors.conflict(
        'This invitation has expired. Ask for a new one.',
        'INVITATION_EXPIRED',
      );
    }
    return invitation;
  }

  private async notifyInviter(inviterId: string, title: string) {
    await this.notifications.notify([
      { userId: inviterId, type: 'INVITATION', title, link: '/settings/team' },
    ]);
  }
}
