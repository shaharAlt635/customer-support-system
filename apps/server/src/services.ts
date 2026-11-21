import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config/env';
import type { Mailer } from './email/mailer';
import { AccountEmails } from './modules/auth/account-emails';
import { AttachmentService } from './modules/attachments/attachments.service';
import { AuthService } from './modules/auth/auth.service';
import { CategoryService } from './modules/categories/categories.service';
import { CustomerService } from './modules/customers/customers.service';
import { GroupService } from './modules/groups/groups.service';
import { NotificationService } from './modules/notifications/notifications.service';
import { PortalService } from './modules/portal/portal.service';
import { StatsService } from './modules/stats/stats.service';
import { TeamService } from './modules/team/team.service';
import { TicketService } from './modules/tickets/tickets.service';
import type { FileStorage } from './storage/file-storage';
import type { AccessTokenPayload } from './types';

export interface ServiceDependencies {
  prisma: PrismaClient;
  storage: FileStorage;
  config: AppConfig;
  log: FastifyBaseLogger;
  mailer: Mailer;
  signAccessToken: (payload: AccessTokenPayload) => string;
}

/** Composition root: wires services to their dependencies once per app instance. */
export function createServices(deps: ServiceDependencies) {
  const { prisma, config, log, mailer } = deps;
  const accountEmails = new AccountEmails(prisma, mailer, config, log);
  const notifications = new NotificationService(prisma, log);
  const groups = new GroupService(prisma);
  const auth = new AuthService(
    prisma,
    deps.signAccessToken,
    config,
    accountEmails,
    notifications,
    log,
  );
  const tickets = new TicketService(prisma, deps.storage, notifications, accountEmails);
  return {
    storage: deps.storage,
    mailer,
    notifications,
    groups,
    auth,
    team: new TeamService(prisma, groups, notifications, mailer, config, log),
    customers: new CustomerService(prisma),
    categories: new CategoryService(prisma),
    tickets,
    portal: new PortalService(prisma, tickets, auth, deps.storage, mailer, config, log),
    attachments: new AttachmentService(deps.prisma, deps.storage),
    stats: new StatsService(deps.prisma),
  };
}

export type Services = ReturnType<typeof createServices>;
