import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Anything that can deliver an email. Swap implementations without touching callers. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Real delivery through any SMTP provider (Gmail, Resend, SendGrid, Postmark, SES, …). */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    config: AppConfig,
    private readonly from = config.EMAIL_FROM,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

/**
 * Development mailbox: stores emails in MongoDB so they can be read at /dev/mailbox
 * without configuring an email provider. Never used in production.
 */
export class DevMailboxMailer implements Mailer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.prisma.devEmail.create({ data: message });
    this.log.info({ to: message.to, subject: message.subject }, 'Email stored in dev mailbox');
  }
}

export function createMailer(
  config: AppConfig,
  prisma: PrismaClient,
  log: FastifyBaseLogger,
): Mailer {
  return config.EMAIL_TRANSPORT === 'smtp'
    ? new SmtpMailer(config)
    : new DevMailboxMailer(prisma, log);
}
