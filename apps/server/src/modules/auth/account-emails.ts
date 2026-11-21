import type { PrismaClient, Role, TokenPurpose } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import type { EmailMessage, Mailer } from '../../email/mailer';
import {
  accountClaimMessage,
  companyListMessage,
  magicLinkMessage,
  replyNotificationMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from '../../email/templates';
import { Errors } from '../../lib/errors';
import { generateRefreshToken, hashToken } from '../../lib/tokens';

const MINUTE = 60 * 1000;
const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * MINUTE,
  RESET_PASSWORD: 60 * MINUTE,
  MAGIC_LOGIN: 30 * MINUTE,
};
/** Sign-in links inside reply notifications live longer than requested sign-in links. */
const REPLY_LINK_TTL_MS = 7 * 24 * 60 * MINUTE;

interface Recipient {
  id: string;
  email: string;
  name: string;
}

interface CompanyRef {
  name: string;
}

interface TicketRef {
  id: string;
  number: number;
  subject: string;
}

/**
 * Issues single-use email tokens and sends the matching emails. Only a SHA-256 hash of
 * each token is stored, and issuing a new token invalidates older unused ones.
 */
export class AccountEmails {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async sendVerification(user: Recipient, company: CompanyRef, isNewCompany = false) {
    const token = await this.issue(user.id, 'VERIFY_EMAIL');
    await this.deliver(
      verifyEmailMessage({
        to: user.email,
        name: user.name,
        companyName: company.name,
        url: `${this.config.APP_URL}/verify-email?token=${token}`,
        isNewCompany,
      }),
    );
  }

  async sendPasswordReset(user: Recipient, company: CompanyRef) {
    const token = await this.issue(user.id, 'RESET_PASSWORD');
    await this.deliver(
      resetPasswordMessage({
        to: user.email,
        name: user.name,
        companyName: company.name,
        url: `${this.config.APP_URL}/reset-password?token=${token}`,
      }),
    );
  }

  /** Someone with a guest (passwordless) account tried to register: let them set a password. */
  async sendAccountClaim(user: Recipient, company: CompanyRef) {
    const token = await this.issue(user.id, 'RESET_PASSWORD');
    await this.deliver(
      accountClaimMessage({
        to: user.email,
        name: user.name,
        companyName: company.name,
        url: `${this.config.APP_URL}/reset-password?token=${token}`,
      }),
    );
  }

  /** Passwordless sign-in link (requested from the sign-in or ticket page). */
  async sendMagicLink(user: Recipient, company: CompanyRef) {
    const token = await this.issue(user.id, 'MAGIC_LOGIN');
    await this.deliver(
      magicLinkMessage({
        to: user.email,
        name: user.name,
        companyName: company.name,
        url: `${this.config.APP_URL}/sign-in-link?token=${token}`,
      }),
    );
  }

  /** Tell a requester about a reply, with a link that signs them in straight to the ticket. */
  async sendReplyNotification(
    requester: Recipient,
    company: CompanyRef,
    ticket: TicketRef,
    authorName: string,
    preview: string,
  ) {
    // Several reply emails may be outstanding at once, so don't invalidate older links.
    const token = await this.issue(requester.id, 'MAGIC_LOGIN', {
      ttlMs: REPLY_LINK_TTL_MS,
      keepExisting: true,
    });
    await this.deliver(
      replyNotificationMessage({
        to: requester.email,
        companyName: company.name,
        ticketNumber: ticket.number,
        ticketSubject: ticket.subject,
        authorName,
        preview,
        url: `${this.config.APP_URL}/sign-in-link?token=${token}&ticket=${ticket.id}`,
      }),
    );
  }

  /** "Find my company": list every company where this email has an account. */
  async sendCompanyList(
    email: string,
    accounts: { role: Role; hasPassword: boolean; company: { name: string; slug: string } }[],
  ) {
    await this.deliver(
      companyListMessage({
        to: email,
        accounts: accounts.map((account) => ({
          companyName: account.company.name,
          role: account.role,
          hasPassword: account.hasPassword,
          url: `${this.config.APP_URL}/${account.company.slug}/login`,
        })),
      }),
    );
  }

  /** Mark a token as used and return its user id, or throw if it is invalid/expired/used. */
  async consume(rawToken: string, purpose: TokenPurpose): Promise<string> {
    const record = await this.prisma.userToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    const now = new Date();
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt <= now) {
      throw Errors.badRequest('This link is invalid or has expired.', 'INVALID_TOKEN');
    }
    // Conditional update: two clicks on the same link cannot both succeed.
    const { count } = await this.prisma.userToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (count === 0) throw Errors.badRequest('This link has already been used.', 'INVALID_TOKEN');
    return record.userId;
  }

  private async issue(
    userId: string,
    purpose: TokenPurpose,
    options: { ttlMs?: number; keepExisting?: boolean } = {},
  ): Promise<string> {
    const now = new Date();
    if (!options.keepExisting) {
      await this.prisma.userToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: now },
      });
    }
    const token = generateRefreshToken();
    await this.prisma.userToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + (options.ttlMs ?? TOKEN_TTL_MS[purpose])),
        usedAt: null,
      },
    });
    return token;
  }

  /** Email failures are logged, not thrown: the account action itself already succeeded. */
  private async deliver(message: EmailMessage) {
    try {
      await this.mailer.send(message);
    } catch (error) {
      this.log.error({ err: error, to: message.to }, 'Failed to send email');
    }
  }
}
