import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  CategorySummaryDTO,
  CompanySettingsInput,
  GuestTicketInput,
  PublicCompanyDTO,
  SubmissionPendingDTO,
} from '@support-desk/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import type { Mailer } from '../../email/mailer';
import { confirmSubmissionMessage } from '../../email/templates';
import { Errors } from '../../lib/errors';
import { type StoredFile, removeStoredFiles } from '../../lib/multipart';
import { generateRefreshToken, hashToken } from '../../lib/tokens';
import type { FileStorage } from '../../storage/file-storage';
import type { AuthService, IssuedSession, SessionMeta } from '../auth/auth.service';
import type { TicketService } from '../tickets/tickets.service';

const SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Unconfirmed requests one email may have waiting at a company at once. */
const MAX_PENDING_PER_EMAIL = 5;

type CompanyRow = Prisma.CompanyGetPayload<object>;

/**
 * The public ticket page of each company. Visitors who aren't signed in submit a request
 * with their email; it only becomes a ticket when they click the confirmation link, which
 * also signs them in to a (passwordless) guest account so they can follow up.
 */
export class PortalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tickets: TicketService,
    private readonly auth: AuthService,
    private readonly storage: FileStorage,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async getPublicCompany(slug: string): Promise<PublicCompanyDTO> {
    return this.toPublic(await this.findCompany(slug));
  }

  async updateSettings(companyId: string, input: CompanySettingsInput): Promise<PublicCompanyDTO> {
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: input.name,
        allowAccountTickets: input.allowAccountTickets,
        allowGuestTickets: input.allowGuestTickets,
        allowAnonymousTickets: input.allowAnonymousTickets,
        portalTitle: input.portalTitle === undefined ? undefined : input.portalTitle || null,
        portalMessage: input.portalMessage === undefined ? undefined : input.portalMessage || null,
        brandColor: input.brandColor,
      },
    });
    return this.toPublic(company);
  }

  /** Active categories visitors can pick on the public page. */
  async listCategories(slug: string): Promise<CategorySummaryDTO[]> {
    const company = await this.findCompany(slug);
    return this.prisma.category.findMany({
      where: { companyId: company.id, isActive: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Store a guest's request and email them a confirmation link. */
  async submit(
    slug: string,
    input: GuestTicketInput,
    files: StoredFile[],
  ): Promise<SubmissionPendingDTO> {
    const company = await this.findCompany(slug);
    const expiresAt = new Date(Date.now() + SUBMISSION_TTL_MS);

    // Honeypot field: real visitors never see it. Pretend everything worked.
    if (input.website) {
      await removeStoredFiles(this.storage, files);
      return { email: input.email, expiresAt: expiresAt.toISOString() };
    }

    const isAnonymous = input.isAnonymous ?? false;
    if (isAnonymous && !company.allowAnonymousTickets) {
      throw Errors.forbidden(
        'This company does not accept anonymous tickets',
        'ANONYMOUS_DISABLED',
      );
    }
    if (!isAnonymous && !company.allowGuestTickets) {
      throw Errors.forbidden(
        'Please sign in or create an account to open a ticket',
        'GUEST_TICKETS_DISABLED',
      );
    }
    const name = input.name?.trim() || null;
    if (!isAnonymous && (!name || name.length < 2)) {
      throw Errors.validation([{ path: 'name', message: 'Please tell us your name' }]);
    }
    if (input.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
      if (!category || category.companyId !== company.id || !category.isActive) {
        throw Errors.validation([{ path: 'categoryId', message: 'Select a valid category' }]);
      }
    }
    const pending = await this.prisma.pendingSubmission.count({
      where: { companyId: company.id, email: input.email, expiresAt: { gt: new Date() } },
    });
    if (pending >= MAX_PENDING_PER_EMAIL) {
      throw Errors.conflict(
        'You already have several unconfirmed requests. Check your inbox for the confirmation emails.',
        'TOO_MANY_PENDING',
      );
    }

    const token = generateRefreshToken();
    await this.prisma.pendingSubmission.create({
      data: {
        companyId: company.id,
        email: input.email,
        name,
        isAnonymous,
        subject: input.subject,
        description: input.description,
        priority: input.priority ?? 'MEDIUM',
        categoryId: input.categoryId ?? null,
        files: files as unknown as Prisma.InputJsonValue,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    try {
      await this.mailer.send(
        confirmSubmissionMessage({
          to: input.email,
          companyName: company.name,
          subject: input.subject,
          url: `${this.config.APP_URL}/confirm-request?token=${token}`,
        }),
      );
    } catch (error) {
      this.log.error({ err: error, to: input.email }, 'Failed to send confirmation email');
    }
    return { email: input.email, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Turn a confirmed request into a ticket. The submitter is signed in to the account that
   * owns this email at the company — an existing one, or a new passwordless guest account.
   */
  async confirm(
    token: string,
    meta: SessionMeta,
  ): Promise<{ session: IssuedSession; ticketId: string }> {
    const submission = await this.prisma.pendingSubmission.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!submission || submission.expiresAt <= new Date()) {
      throw Errors.badRequest(
        'This link is invalid or has expired. Please submit your request again.',
        'INVALID_TOKEN',
      );
    }
    // Claim it atomically so a double click can't create two tickets.
    const { count } = await this.prisma.pendingSubmission.deleteMany({
      where: { id: submission.id },
    });
    if (count === 0) {
      throw Errors.badRequest('This request has already been confirmed.', 'INVALID_TOKEN');
    }
    const files = submission.files as unknown as StoredFile[];

    try {
      const userId = await this.resolveRequester(submission);
      const ticketId = await this.tickets.insertTicket({
        companyId: submission.companyId,
        requesterId: userId,
        subject: submission.subject,
        description: submission.description,
        priority: submission.priority,
        categoryId: submission.categoryId,
        isAnonymous: submission.isAnonymous,
        files,
      });
      const session = await this.auth.createSession(userId, meta);
      return { session, ticketId };
    } catch (error) {
      await removeStoredFiles(this.storage, files);
      throw error;
    }
  }

  /** Delete unconfirmed requests older than 24 hours, including their uploaded files. */
  async cleanupExpired(): Promise<number> {
    const expired = await this.prisma.pendingSubmission.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, files: true },
    });
    if (expired.length === 0) return 0;
    await Promise.all(
      expired.map((s) => removeStoredFiles(this.storage, s.files as unknown as StoredFile[])),
    );
    await this.prisma.pendingSubmission.deleteMany({
      where: { id: { in: expired.map((s) => s.id) } },
    });
    return expired.length;
  }

  private async resolveRequester(submission: {
    companyId: string;
    email: string;
    name: string | null;
  }): Promise<string> {
    const now = new Date();
    const existing = await this.prisma.user.findUnique({
      where: { companyId_email: { companyId: submission.companyId, email: submission.email } },
    });
    if (existing) {
      if (!existing.isActive) {
        throw Errors.forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');
      }
      if (!existing.emailVerifiedAt) {
        // The confirmation link proves the email. A password set on an unconfirmed account
        // was never proven to belong to this person, so drop it (they can set a new one).
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { emailVerifiedAt: now, passwordHash: null },
        });
      }
      return existing.id;
    }

    const guest = await this.prisma.user.create({
      data: {
        companyId: submission.companyId,
        email: submission.email,
        name: submission.name ?? submission.email.split('@')[0]!,
        passwordHash: null,
        role: 'CUSTOMER',
        emailVerifiedAt: now,
        lastLoginAt: now,
      },
      select: { id: true },
    });
    return guest.id;
  }

  private async findCompany(slug: string): Promise<CompanyRow> {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) throw Errors.notFound('Company');
    return company;
  }

  private toPublic(company: CompanyRow): PublicCompanyDTO {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      allowRegistration: this.config.ALLOW_REGISTRATION && company.allowAccountTickets,
      allowAccountTickets: company.allowAccountTickets,
      allowGuestTickets: company.allowGuestTickets,
      allowAnonymousTickets: company.allowAnonymousTickets,
      portalTitle: company.portalTitle ?? null,
      portalMessage: company.portalMessage ?? null,
      brandColor: company.brandColor,
    };
  }
}
