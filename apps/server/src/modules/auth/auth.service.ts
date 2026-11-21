import type { PrismaClient } from '@prisma/client';
import type {
  ChangePasswordInput,
  CompanyLoginInput,
  CompanyRegisterInput,
  CompanySummaryDTO,
  CreateCompanyInput,
  CurrentUserDTO,
  EmailRequestInput,
  ResetPasswordInput,
  UpdateProfileInput,
  VerificationPendingDTO,
} from '@support-desk/shared';
import { DEFAULT_GROUPS } from '@support-desk/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import { Errors } from '../../lib/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashToken, newTokenFamily } from '../../lib/tokens';
import { companySummarySelect, currentUserSelect, toCurrentUserDTO } from '../../serializers';
import type { AccessTokenPayload } from '../../types';
import type { NotificationService } from '../notifications/notifications.service';
import type { AccountEmails } from './account-emails';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  user: CurrentUserDTO;
  company: CompanySummaryDTO;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Categories every new company starts with; they can be edited or removed later. */
const DEFAULT_CATEGORIES = [
  { name: 'General', color: '#64748b', description: 'Anything else' },
  { name: 'Billing', color: '#22c55e', description: 'Invoices, payments and plans' },
  { name: 'Technical Support', color: '#3b82f6', description: 'Help using the product' },
];

/**
 * A rotated refresh token presented again within this window is treated as a benign race
 * (two tabs refreshing at once) rather than token theft.
 */
const ROTATION_GRACE_MS = 30_000;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly signAccessToken: (payload: AccessTokenPayload) => string,
    private readonly config: AppConfig,
    private readonly emails: AccountEmails,
    private readonly notifications: NotificationService,
    private readonly log: FastifyBaseLogger,
  ) {}

  async findCompany(slug: string): Promise<CompanySummaryDTO> {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: companySummarySelect,
    });
    if (!company) throw Errors.notFound('Company');
    return company;
  }

  /** Create a company and its owner account. The owner must confirm their email to sign in. */
  async createCompany(input: CreateCompanyInput): Promise<VerificationPendingDTO> {
    if (!this.config.ALLOW_COMPANY_SIGNUP) {
      throw Errors.forbidden('Creating new companies is disabled', 'COMPANY_SIGNUP_DISABLED');
    }
    const taken = await this.prisma.company.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (taken) {
      throw Errors.validation([{ path: 'slug', message: 'This address is already taken' }]);
    }

    const passwordHash = await hashPassword(input.password);
    const { company, owner } = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: input.companyName, slug: input.slug },
        select: companySummarySelect,
      });
      const owner = await tx.user.create({
        data: {
          companyId: company.id,
          name: input.name,
          email: input.email,
          passwordHash,
          role: 'OWNER',
          emailVerifiedAt: null,
          lastLoginAt: null,
        },
        select: { id: true, name: true, email: true },
      });
      await tx.category.createMany({
        data: DEFAULT_CATEGORIES.map((category) => ({ ...category, companyId: company.id })),
      });
      await tx.permissionGroup.createMany({
        data: DEFAULT_GROUPS.map((group) => ({
          companyId: company.id,
          name: group.name,
          description: group.description,
          permissions: [...group.permissions],
          isDefault: group.isDefault,
        })),
      });
      return { company, owner };
    });

    await this.emails.sendVerification(owner, company, true);
    return { email: owner.email, company, verificationRequired: true };
  }

  /** Customer self-registration on a company's page. Requires email confirmation. */
  async register(input: CompanyRegisterInput): Promise<VerificationPendingDTO> {
    const record = await this.prisma.company.findUnique({ where: { slug: input.companySlug } });
    if (!record) throw Errors.notFound('Company');
    if (!this.config.ALLOW_REGISTRATION || !record.allowAccountTickets) {
      throw Errors.forbidden('Self-service registration is disabled', 'REGISTRATION_DISABLED');
    }
    const company = { id: record.id, name: record.name, slug: record.slug };
    const existing = await this.prisma.user.findUnique({
      where: { companyId_email: { companyId: company.id, email: input.email } },
      select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
    });
    // A guest (passwordless) account with this email: let its owner set a password by email
    // instead of creating a second account. Nothing changes until they click the link.
    if (existing && !existing.passwordHash) {
      if (existing.isActive) await this.emails.sendAccountClaim(existing, company);
      return { email: existing.email, company, verificationRequired: true };
    }
    if (existing) {
      throw Errors.conflict(
        `An account with this email already exists at ${company.name}`,
        'EMAIL_IN_USE',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: 'CUSTOMER',
        emailVerifiedAt: null,
        lastLoginAt: null,
      },
      select: { id: true, name: true, email: true },
    });

    await this.emails.sendVerification(user, company);
    return { email: user.email, company, verificationRequired: true };
  }

  async login(input: CompanyLoginInput, meta: SessionMeta): Promise<IssuedSession> {
    const company = await this.prisma.company.findUnique({
      where: { slug: input.companySlug },
      select: companySummarySelect,
    });
    const user = company
      ? await this.prisma.user.findUnique({
          where: { companyId_email: { companyId: company.id, email: input.email } },
        })
      : null;

    if (!company || !user || !user.passwordHash) {
      // Guest accounts have no password; they sign in with an emailed link instead.
      await burnPasswordCheck(input.password);
      throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    // Only revealed after a correct password, so these don't leak whether an account exists.
    if (!user.emailVerifiedAt) {
      throw Errors.forbidden(
        'Please confirm your email address first. Check your inbox for the link.',
        'EMAIL_NOT_VERIFIED',
      );
    }
    if (!user.isActive) {
      throw Errors.forbidden(
        'This account has been deactivated. Contact the company administrator.',
        'ACCOUNT_DISABLED',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: currentUserSelect,
    });
    return this.startSession(toCurrentUserDTO(updated), company, meta);
  }

  /** Confirm an email address from the emailed link, then sign the user in. */
  async verifyEmail(token: string, meta: SessionMeta): Promise<IssuedSession> {
    const userId = await this.emails.consume(token, 'VERIFY_EMAIL');
    const now = new Date();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: now, lastLoginAt: now },
      select: { ...currentUserSelect, company: { select: companySummarySelect } },
    });
    if (!user.isActive) {
      throw Errors.forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');
    }
    await this.announcePendingInvitations(user.id, user.companyId, user.email);
    return this.startSession(toCurrentUserDTO(user), user.company, meta);
  }

  /** Email a one-time sign-in link. Always succeeds, so it never reveals which emails exist. */
  async requestMagicLink(input: EmailRequestInput): Promise<void> {
    const user = await this.findAccount(input);
    if (user && user.isActive) await this.emails.sendMagicLink(user, user.company);
  }

  /** Sign in with an emailed link. Clicking it also proves the email address. */
  async magicLogin(token: string, meta: SessionMeta): Promise<IssuedSession> {
    const userId = await this.emails.consume(token, 'MAGIC_LOGIN');
    const existing = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!existing.isActive) {
      throw Errors.forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: now,
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        // A password set on a never-confirmed account was never proven to be theirs.
        ...(existing.emailVerifiedAt ? {} : { passwordHash: null }),
      },
    });
    return this.createSession(userId, meta);
  }

  /** Start a session for a user who proved their identity some other way (e.g. an email link). */
  async createSession(userId: string, meta: SessionMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ...currentUserSelect, company: { select: companySummarySelect } },
    });
    return this.startSession(toCurrentUserDTO(user), user.company, meta);
  }

  /** Guests (who sign in by email link) can add a password to their account. */
  async setInitialPassword(userId: string, password: string): Promise<void> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: null },
      data: { passwordHash: await hashPassword(password) },
    });
    if (count === 0) {
      throw Errors.conflict('This account already has a password', 'PASSWORD_ALREADY_SET');
    }
  }

  /** Always succeeds so the response never reveals which emails have accounts. */
  async resendVerification(input: EmailRequestInput): Promise<void> {
    const user = await this.findAccount(input);
    if (user && !user.emailVerifiedAt && user.isActive) {
      await this.emails.sendVerification(user, user.company);
    }
  }

  /**
   * "Find my company": email the companies where this address has an active account.
   * Always succeeds, and sends nothing for unknown emails, so it reveals nothing.
   */
  async sendCompanyList(email: string): Promise<void> {
    const accounts = await this.prisma.user.findMany({
      where: { email, isActive: true },
      select: { role: true, passwordHash: true, company: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (accounts.length === 0) return;
    await this.emails.sendCompanyList(
      email,
      accounts.map(({ role, passwordHash, company }) => ({
        role,
        hasPassword: passwordHash !== null,
        company,
      })),
    );
  }

  /** Always succeeds so the response never reveals which emails have accounts. */
  async requestPasswordReset(input: EmailRequestInput): Promise<void> {
    const user = await this.findAccount(input);
    if (user && user.isActive) await this.emails.sendPasswordReset(user, user.company);
  }

  /** Set a new password from an emailed link and sign out every existing session. */
  async resetPassword(input: ResetPasswordInput): Promise<{ company: CompanySummaryDTO }> {
    const userId = await this.emails.consume(input.token, 'RESET_PASSWORD');
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true, company: { select: companySummarySelect } },
    });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(input.password),
          // Receiving the reset email proves the address belongs to them.
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    return { company: user.company };
  }

  /** Exchange a company's refresh cookie for a new access token, rotating the cookie. */
  async refresh(
    company: CompanySummaryDTO,
    rawToken: string | undefined,
    meta: SessionMeta,
  ): Promise<IssuedSession> {
    if (!rawToken) throw Errors.unauthorized('No active session', 'NO_SESSION');

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: currentUserSelect } },
    });
    if (!record || record.user.companyId !== company.id) {
      throw Errors.unauthorized('Invalid session', 'INVALID_SESSION');
    }

    const now = new Date();
    if (record.revokedAt) {
      if (now.getTime() - record.revokedAt.getTime() < ROTATION_GRACE_MS) {
        throw Errors.unauthorized('Session was refreshed elsewhere; retry', 'SESSION_ROTATED');
      }
      // A long-revoked token is being replayed: assume it was stolen and end the session.
      await this.revokeFamily(record.familyId, now);
      this.log.warn({ userId: record.userId }, 'Refresh token reuse detected; session revoked');
      throw Errors.unauthorized(
        'Session is no longer valid. Please sign in again.',
        'SESSION_REVOKED',
      );
    }
    if (record.expiresAt <= now) throw Errors.unauthorized('Session expired', 'SESSION_EXPIRED');
    if (!record.user.isActive) {
      await this.revokeFamily(record.familyId, now);
      throw Errors.unauthorized('This account has been deactivated', 'ACCOUNT_DISABLED');
    }

    // Conditional update so two concurrent refreshes cannot both rotate the same token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) {
      throw Errors.unauthorized('Session was refreshed elsewhere; retry', 'SESSION_ROTATED');
    }

    return this.startSession(toCurrentUserDTO(record.user), company, meta, record.familyId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId, new Date());
  }

  async getProfile(userId: string): Promise<{ user: CurrentUserDTO; company: CompanySummaryDTO }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...currentUserSelect, company: { select: companySummarySelect } },
    });
    if (!user) throw Errors.notFound('User');
    return { user: toCurrentUserDTO(user), company: user.company };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<CurrentUserDTO> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
      select: currentUserSelect,
    });
    return toCurrentUserDTO(user);
  }

  /** Change the password and sign out every other session. */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    currentRefreshToken: string | undefined,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');
    if (!user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw Errors.validation([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }

    const keepHash = currentRefreshToken ? hashToken(currentRefreshToken) : undefined;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepHash ? { tokenHash: { not: keepHash } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async findAccount(input: EmailRequestInput) {
    const company = await this.prisma.company.findUnique({
      where: { slug: input.companySlug },
      select: { id: true },
    });
    if (!company) return null;
    return this.prisma.user.findUnique({
      where: { companyId_email: { companyId: company.id, email: input.email } },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        emailVerifiedAt: true,
        company: { select: { name: true } },
      },
    });
  }

  /**
   * Someone invited before they had an account (or before confirming it) gets a bell
   * notification as soon as their email is confirmed.
   */
  private async announcePendingInvitations(userId: string, companyId: string, email: string) {
    const invitations = await this.prisma.invitation.findMany({
      where: { companyId, email, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { company: { select: { name: true } } },
    });
    await this.notifications.notify(
      invitations.map((invitation) => ({
        userId,
        type: 'INVITATION' as const,
        title: `You're invited to join the ${invitation.company.name} team`,
        link: '/invitations',
      })),
    );
  }

  private async startSession(
    user: CurrentUserDTO,
    company: CompanySummaryDTO,
    meta: SessionMeta,
    familyId = newTokenFamily(),
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshTokenExpiresAt,
        revokedAt: null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    return {
      user,
      company,
      accessToken: this.signAccessToken({ sub: user.id, cid: company.id }),
      expiresIn: this.config.ACCESS_TOKEN_TTL_MINUTES * 60,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
