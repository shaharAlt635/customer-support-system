import type { PrismaClient } from '@prisma/client';
import type { Permission } from '@support-desk/shared';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from './config/env';
import type { Services } from './services';
import type { AccessTokenPayload, AuthUser } from './types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    services: Services;
    /** preHandler: requires a valid access token for an active user. */
    authenticate: (request: FastifyRequest) => Promise<void>;
    /** preHandler factory: authenticates, then requires every listed permission. */
    authorize: (...permissions: Permission[]) => (request: FastifyRequest) => Promise<void>;
    /** preHandler factory: authenticates, then requires at least one listed permission. */
    authorizeAny: (...permissions: Permission[]) => (request: FastifyRequest) => Promise<void>;
  }
}
