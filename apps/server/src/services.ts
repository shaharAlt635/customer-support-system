import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config/env';
import { AttachmentService } from './modules/attachments/attachments.service';
import { AuthService } from './modules/auth/auth.service';
import { CategoryService } from './modules/categories/categories.service';
import { StatsService } from './modules/stats/stats.service';
import { TicketService } from './modules/tickets/tickets.service';
import { UserService } from './modules/users/users.service';
import type { FileStorage } from './storage/file-storage';
import type { AccessTokenPayload } from './types';

export interface ServiceDependencies {
  prisma: PrismaClient;
  storage: FileStorage;
  config: AppConfig;
  log: FastifyBaseLogger;
  signAccessToken: (payload: AccessTokenPayload) => string;
}

/** Composition root: wires services to their dependencies once per app instance. */
export function createServices(deps: ServiceDependencies) {
  return {
    storage: deps.storage,
    auth: new AuthService(deps.prisma, deps.signAccessToken, deps.config, deps.log),
    users: new UserService(deps.prisma),
    categories: new CategoryService(deps.prisma),
    tickets: new TicketService(deps.prisma, deps.storage),
    attachments: new AttachmentService(deps.prisma, deps.storage),
    stats: new StatsService(deps.prisma),
  };
}

export type Services = ReturnType<typeof createServices>;
