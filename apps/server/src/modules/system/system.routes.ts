import { ATTACHMENT_TYPES, type PublicConfigDTO } from '@support-desk/shared';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ensureDatabaseIndexes } from '../../lib/db-maintenance';
import { Errors } from '../../lib/errors';

export const systemRoutes: FastifyPluginAsync = async (app) => {
  /** Liveness + database connectivity, for load balancers and uptime checks. */
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await app.prisma.$runCommandRaw({ ping: 1 });
      return { status: 'ok', database: 'up', uptime: Math.round(process.uptime()) };
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed');
      return reply.status(503).send({ status: 'degraded', database: 'down' });
    }
  });

  /**
   * Daily housekeeping for serverless hosts, where no process stays up to run timers:
   * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. Recreates the TTL
   * indexes, removes expired unconfirmed requests and, for a public demo, restores the
   * demo data. Hidden (404) unless CRON_SECRET is set.
   */
  app.get('/cron/daily', { config: { rateLimit: false } }, async (request) => {
    const secret = app.config.CRON_SECRET;
    if (!secret) throw Errors.notFound('Route');
    const given = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw Errors.unauthorized('Invalid cron secret', 'INVALID_CRON_SECRET');
    }

    await ensureDatabaseIndexes(app.prisma);
    if (app.config.DEMO_MODE) {
      const { seedDemoData } = await import('../../../prisma/seed');
      await seedDemoData(app.prisma, { reset: true, log: (message) => app.log.info(message) });
      return { ok: true, demoReset: true };
    }
    const expiredRequestsRemoved = await app.services.portal.cleanupExpired();
    return { ok: true, demoReset: false, expiredRequestsRemoved };
  });

  /** Settings the web client needs before sign-in. */
  app.get('/config', async (): Promise<PublicConfigDTO> => ({
    allowRegistration: app.config.ALLOW_REGISTRATION,
    allowCompanySignup: app.config.ALLOW_COMPANY_SIGNUP,
    devMailbox: app.config.devMailboxEnabled,
    demo: app.config.DEMO_MODE,
    captchaSiteKey: app.config.captcha?.siteKey ?? null,
    uploads: {
      maxFileSizeBytes: app.config.maxUploadBytes,
      maxFiles: app.config.MAX_FILES_PER_UPLOAD,
      allowedExtensions: Object.keys(ATTACHMENT_TYPES),
    },
  }));
};
