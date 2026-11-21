import type { Prisma, PrismaClient, Ticket, TicketEventType } from '@prisma/client';
import {
  type CreateMessageInput,
  type CreateTicketInput,
  type MessageDTO,
  PERMISSIONS,
  PRIORITY_RANK,
  type Paginated,
  type TicketDetailDTO,
  type TicketListQuery,
  type TicketSort,
  type TicketStatus,
  type TicketSummaryDTO,
  type UpdateTicketInput,
  customerCanSetStatus,
  isStaff,
} from '@support-desk/shared';
import { Errors } from '../../lib/errors';
import type { StoredFile } from '../../lib/multipart';
import { paginated, paginationArgs } from '../../lib/pagination';
import { containsInsensitive } from '../../lib/search';
import {
  messageInclude,
  ticketDetailInclude,
  ticketSummaryInclude,
  toMessageDTOFor,
  toTicketDetailDTO,
  toTicketSummaryDTO,
} from '../../serializers';
import type { FileStorage } from '../../storage/file-storage';
import type { AuthUser } from '../../types';
import type { AccountEmails } from '../auth/account-emails';
import type { NewNotification, NotificationService } from '../notifications/notifications.service';
import { nextTicketNumber } from './ticket-number';
import { can, canSeeInternal, canViewTicket } from './ticket.policy';

interface EventDraft {
  type: TicketEventType;
  fromValue: string | null;
  toValue: string | null;
}

const TICKET_ORDER: Record<TicketSort, Prisma.TicketOrderByWithRelationInput[]> = {
  updated: [{ lastActivityAt: 'desc' }, { number: 'desc' }],
  newest: [{ createdAt: 'desc' }, { number: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { number: 'asc' }],
  priority: [{ priorityRank: 'desc' }, { createdAt: 'asc' }],
};

/** Keep resolution/closure timestamps consistent with the status. */
function statusChangeData(
  ticket: Pick<Ticket, 'resolvedAt'>,
  next: TicketStatus,
  now: Date,
): Pick<Prisma.TicketUncheckedUpdateInput, 'status' | 'resolvedAt' | 'closedAt'> {
  switch (next) {
    case 'RESOLVED':
      return { status: next, resolvedAt: now, closedAt: null };
    case 'CLOSED':
      return { status: next, resolvedAt: ticket.resolvedAt ?? now, closedAt: now };
    default:
      return { status: next, resolvedAt: null, closedAt: null };
  }
}

const ticketLabel = (ticket: Pick<Ticket, 'number' | 'subject'>) =>
  `#${ticket.number} ${ticket.subject}`;

/** Everything needed to create a ticket, whoever submits it (signed-in user or guest). */
export interface NewTicket {
  companyId: string;
  requesterId: string;
  subject: string;
  description: string;
  priority?: Ticket['priority'];
  categoryId?: string | null;
  isAnonymous: boolean;
  files: StoredFile[];
}

export class TicketService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: FileStorage,
    private readonly notifications: NotificationService,
    private readonly emails: AccountEmails,
  ) {}

  async list(user: AuthUser, query: TicketListQuery): Promise<Paginated<TicketSummaryDTO>> {
    const where = this.buildListFilter(user, query);
    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: ticketSummaryInclude(canSeeInternal(user)),
        orderBy: TICKET_ORDER[query.sort],
        ...paginationArgs(query.page, query.pageSize),
      }),
    ]);
    return paginated(
      tickets.map((ticket) => toTicketSummaryDTO(ticket, user.id)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDetail(user: AuthUser, id: string): Promise<TicketDetailDTO> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: ticketDetailInclude(canSeeInternal(user)),
    });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');
    return toTicketDetailDTO(ticket, user.id);
  }

  async create(
    user: AuthUser,
    input: CreateTicketInput,
    files: StoredFile[],
  ): Promise<TicketDetailDTO> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { allowAccountTickets: true, allowAnonymousTickets: true },
    });
    // The company decides whether customer accounts may open tickets and whether
    // requesters may hide their identity. Team members can always open tickets.
    if (!isStaff(user.role) && !company.allowAccountTickets) {
      throw Errors.forbidden(
        'This company is not accepting new tickets from customer accounts',
        'ACCOUNT_TICKETS_DISABLED',
      );
    }
    const isAnonymous = input.isAnonymous ?? false;
    if (isAnonymous && !company.allowAnonymousTickets) {
      throw Errors.forbidden(
        'This company does not accept anonymous tickets',
        'ANONYMOUS_DISABLED',
      );
    }

    const id = await this.insertTicket({
      companyId: user.companyId,
      requesterId: user.id,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      categoryId: input.categoryId,
      isAnonymous,
      files,
    });
    return this.getDetail(user, id);
  }

  /** Create a ticket (number, CREATED event and attachments) and return its id. */
  async insertTicket(ticket: NewTicket): Promise<string> {
    const categoryId = ticket.categoryId ?? null;
    if (categoryId) await this.findActiveCategory(ticket.companyId, categoryId);

    const priority = ticket.priority ?? 'MEDIUM';
    const number = await nextTicketNumber(this.prisma, ticket.companyId);

    // Nullable fields are written explicitly so `field: null` filters match in MongoDB.
    const created = await this.prisma.ticket.create({
      data: {
        companyId: ticket.companyId,
        number,
        subject: ticket.subject,
        description: ticket.description,
        priority,
        priorityRank: PRIORITY_RANK[priority],
        isAnonymous: ticket.isAnonymous,
        categoryId,
        customerId: ticket.requesterId,
        assigneeId: null,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
        attachments: {
          create: ticket.files.map((file) => ({
            ...file,
            messageId: null,
            uploaderId: ticket.requesterId,
          })),
        },
        events: {
          create: [
            { type: 'CREATED', actorId: ticket.requesterId, fromValue: null, toValue: null },
          ],
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  async update(user: AuthUser, id: string, input: UpdateTicketInput): Promise<TicketDetailDTO> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { category: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');

    const require = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], what: string) => {
      if (!can(user, permission)) throw Errors.forbidden(`You don't have permission to ${what}`);
    };

    const now = new Date();
    const data: Prisma.TicketUncheckedUpdateInput = {};
    const events: EventDraft[] = [];
    let newAssignee: { id: string; name: string } | null = null;

    if (input.subject !== undefined && input.subject !== ticket.subject) {
      require(PERMISSIONS.TICKETS_EDIT_DETAILS, 'edit the subject');
      data.subject = input.subject;
      events.push({ type: 'SUBJECT_CHANGED', fromValue: ticket.subject, toValue: input.subject });
    }

    if (input.status !== undefined && input.status !== ticket.status) {
      const isRequester = ticket.customerId === user.id;
      const allowed =
        can(user, PERMISSIONS.TICKETS_CHANGE_STATUS) ||
        (isRequester && customerCanSetStatus(ticket.status, input.status));
      if (!allowed) throw Errors.forbidden('You cannot move this ticket to that status');
      Object.assign(data, statusChangeData(ticket, input.status, now));
      events.push({ type: 'STATUS_CHANGED', fromValue: ticket.status, toValue: input.status });
    }

    if (input.priority !== undefined && input.priority !== ticket.priority) {
      require(PERMISSIONS.TICKETS_CHANGE_PRIORITY, 'change the priority');
      data.priority = input.priority;
      data.priorityRank = PRIORITY_RANK[input.priority];
      events.push({
        type: 'PRIORITY_CHANGED',
        fromValue: ticket.priority,
        toValue: input.priority,
      });
    }

    if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
      require(PERMISSIONS.TICKETS_EDIT_DETAILS, 'change the category');
      const category = input.categoryId
        ? await this.findActiveCategory(user.companyId, input.categoryId)
        : null;
      data.categoryId = input.categoryId;
      events.push({
        type: 'CATEGORY_CHANGED',
        fromValue: ticket.category?.name ?? null,
        toValue: category?.name ?? null,
      });
    }

    if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
      // Taking or dropping your own tickets needs "assign to themselves"; anything that
      // involves someone else's queue needs "assign to others".
      const onlyInvolvesMe =
        (input.assigneeId === null || input.assigneeId === user.id) &&
        (ticket.assigneeId === null || ticket.assigneeId === user.id);
      const permission = onlyInvolvesMe
        ? can(user, PERMISSIONS.TICKETS_ASSIGN_SELF) || can(user, PERMISSIONS.TICKETS_ASSIGN_OTHERS)
        : can(user, PERMISSIONS.TICKETS_ASSIGN_OTHERS);
      if (!permission) throw Errors.forbidden("You don't have permission to assign this ticket");

      const assignee = input.assigneeId
        ? await this.findAssignableUser(user.companyId, input.assigneeId)
        : null;
      data.assigneeId = input.assigneeId;
      newAssignee = assignee;
      events.push({
        type: 'ASSIGNEE_CHANGED',
        fromValue: ticket.assignee?.name ?? null,
        toValue: assignee?.name ?? null,
      });
    }

    if (events.length > 0) {
      data.lastActivityAt = now;
      await this.prisma.$transaction([
        this.prisma.ticket.update({ where: { id }, data }),
        this.prisma.ticketEvent.createMany({
          data: events.map((event) => ({
            ...event,
            ticketId: id,
            actorId: user.id,
            createdAt: now,
          })),
        }),
      ]);

      if (newAssignee && newAssignee.id !== user.id) {
        await this.notifications.notify([
          {
            userId: newAssignee.id,
            type: 'TICKET_ASSIGNED',
            title: `${user.name} assigned you ${ticketLabel(ticket)}`,
            link: `/tickets/${id}`,
          },
        ]);
      }
    }

    return this.getDetail(user, id);
  }

  async addMessage(
    user: AuthUser,
    ticketId: string,
    input: CreateMessageInput,
    files: StoredFile[],
  ): Promise<MessageDTO> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');

    const isRequester = ticket.customerId === user.id;
    const isInternal = input.isInternal ?? false;
    if (isInternal && !canSeeInternal(user)) {
      throw Errors.forbidden("You don't have permission to add internal notes");
    }
    if (!isInternal && !isRequester && !can(user, PERMISSIONS.TICKETS_REPLY)) {
      throw Errors.forbidden("You don't have permission to reply to customers");
    }
    if (input.status && !can(user, PERMISSIONS.TICKETS_CHANGE_STATUS)) {
      throw Errors.forbidden("You don't have permission to change the status");
    }
    const reopening = input.status !== undefined && input.status !== 'CLOSED';
    if (ticket.status === 'CLOSED' && !reopening) {
      throw Errors.conflict('This ticket is closed. Reopen it before replying.', 'TICKET_CLOSED');
    }

    const now = new Date();
    const authorIsStaff = isStaff(user.role);

    let nextStatus = input.status;
    // A customer replying to a ticket that was waiting on them (or resolved) reopens it.
    if (
      !nextStatus &&
      isRequester &&
      !authorIsStaff &&
      (ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED')
    ) {
      nextStatus = 'OPEN';
    }

    const ticketData: Prisma.TicketUncheckedUpdateInput = { lastActivityAt: now };
    if (!isInternal && authorIsStaff && !isRequester && !ticket.firstResponseAt) {
      ticketData.firstResponseAt = now;
    }
    const statusChanged = nextStatus !== undefined && nextStatus !== ticket.status;
    if (statusChanged && nextStatus) {
      Object.assign(ticketData, statusChangeData(ticket, nextStatus, now));
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          ticketId,
          authorId: user.id,
          body: input.body,
          isInternal,
          createdAt: now,
          attachments: {
            create: files.map((file) => ({ ...file, ticketId, uploaderId: user.id })),
          },
        },
        include: messageInclude,
      });
      await tx.ticket.update({ where: { id: ticketId }, data: ticketData });
      if (statusChanged) {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            type: 'STATUS_CHANGED',
            fromValue: ticket.status,
            toValue: nextStatus ?? null,
            createdAt: now,
          },
        });
      }
      return created;
    });

    await this.notifyAboutMessage(user, ticket, isInternal, input.body);
    return toMessageDTOFor(message, ticket, user.id);
  }

  /** Permanently delete a ticket, its conversation, history and stored files. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true, companyId: true, attachments: { select: { storageKey: true } } },
    });
    if (!ticket || ticket.companyId !== user.companyId) throw Errors.notFound('Ticket');

    await this.prisma.$transaction([
      this.prisma.attachment.deleteMany({ where: { ticketId: id } }),
      this.prisma.ticketEvent.deleteMany({ where: { ticketId: id } }),
      this.prisma.message.deleteMany({ where: { ticketId: id } }),
      this.prisma.ticket.delete({ where: { id } }),
    ]);
    await Promise.allSettled(ticket.attachments.map((a) => this.storage.remove(a.storageKey)));
  }

  /**
   * The assignee hears about every message they didn't write; the requester hears about
   * public replies from others. Internal notes never notify customers.
   */
  private async notifyAboutMessage(
    author: AuthUser,
    ticket: Ticket,
    isInternal: boolean,
    body: string,
  ) {
    const link = `/tickets/${ticket.id}`;
    const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
    const notifications: NewNotification[] = [];
    // Never reveal an anonymous requester's name to the team.
    const authorName =
      ticket.isAnonymous && author.id === ticket.customerId ? 'Anonymous' : author.name;

    if (ticket.assigneeId && ticket.assigneeId !== author.id) {
      notifications.push({
        userId: ticket.assigneeId,
        type: isInternal ? 'TICKET_NOTE' : 'TICKET_REPLY',
        title: `${authorName} ${isInternal ? 'added a note to' : 'replied on'} ${ticketLabel(ticket)}`,
        body: preview,
        link,
      });
    }
    if (!isInternal && ticket.customerId !== author.id && ticket.customerId !== ticket.assigneeId) {
      notifications.push({
        userId: ticket.customerId,
        type: 'TICKET_REPLY',
        title: `New reply on ${ticketLabel(ticket)}`,
        body: preview,
        link,
      });
    }
    await this.notifications.notify(notifications);

    // Requesters also get an email for public replies, with a link that signs them in —
    // the only way back for guests, who have no password.
    if (!isInternal && ticket.customerId !== author.id) {
      const requester = await this.prisma.user.findUnique({
        where: { id: ticket.customerId },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          company: { select: { name: true } },
        },
      });
      if (requester?.isActive) {
        await this.emails.sendReplyNotification(
          requester,
          requester.company,
          ticket,
          author.name,
          body.length > 600 ? `${body.slice(0, 600)}…` : body,
        );
      }
    }
  }

  private buildListFilter(user: AuthUser, query: TicketListQuery): Prisma.TicketWhereInput {
    const canViewAll = can(user, PERMISSIONS.TICKETS_VIEW_ALL);
    const and: Prisma.TicketWhereInput[] = [];
    const where: Prisma.TicketWhereInput = { companyId: user.companyId, AND: and };

    if (!isStaff(user.role)) {
      where.customerId = user.id;
    } else if (!canViewAll) {
      // Agents without "see all tickets": their requests, their queue and the open pool.
      and.push({ OR: [{ customerId: user.id }, { assigneeId: user.id }, { assigneeId: null }] });
    }
    // Filtering by requester never matches anonymous tickets (that would reveal who sent them).
    if (canViewAll && query.customerId) {
      where.customerId = query.customerId;
      where.isAnonymous = false;
    }

    if (query.status?.length) where.status = { in: query.status };
    if (query.priority?.length) where.priority = { in: query.priority };
    if (query.categoryId) where.categoryId = query.categoryId;

    if (query.assigneeId === 'me') where.assigneeId = user.id;
    else if (query.assigneeId === 'unassigned') where.assigneeId = null;
    else if (query.assigneeId) where.assigneeId = query.assigneeId;

    if (query.q) {
      const contains = containsInsensitive(query.q);
      const or: Prisma.TicketWhereInput[] = [{ subject: contains }, { description: contains }];
      const numberMatch = /^#?(\d{1,9})$/.exec(query.q);
      if (numberMatch) or.push({ number: Number(numberMatch[1]) });
      if (isStaff(user.role)) {
        or.push({
          isAnonymous: false,
          customer: { is: { OR: [{ name: contains }, { email: contains }] } },
        });
      }
      and.push({ OR: or });
    }

    return where;
  }

  private async findActiveCategory(companyId: string, id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || !category.isActive || category.companyId !== companyId) {
      throw Errors.validation([{ path: 'categoryId', message: 'Select a valid category' }]);
    }
    return category;
  }

  private async findAssignableUser(companyId: string, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive || !isStaff(user.role) || user.companyId !== companyId) {
      throw Errors.validation([
        { path: 'assigneeId', message: 'Tickets can only be assigned to active team members' },
      ]);
    }
    return user;
  }
}
