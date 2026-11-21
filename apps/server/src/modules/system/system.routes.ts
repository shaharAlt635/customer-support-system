import { ATTACHMENT_TYPES, type PublicConfigDTO } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';

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

  /** Settings the web client needs before sign-in. */
  app.get('/config', async (): Promise<PublicConfigDTO> => ({
    allowRegistration: app.config.ALLOW_REGISTRATION,
    allowCompanySignup: app.config.ALLOW_COMPANY_SIGNUP,
    devMailbox: app.config.devMailboxEnabled,
    uploads: {
      maxFileSizeBytes: app.config.maxUploadBytes,
      maxFiles: app.config.MAX_FILES_PER_UPLOAD,
      allowedExtensions: Object.keys(ATTACHMENT_TYPES),
    },
  }));
};
