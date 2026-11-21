import {
  PERMISSIONS,
  type PublicCompanyDTO,
  companySettingsSchema,
  companySlugSchema,
  createCompanySchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validation';

const slugParamsSchema = z.object({ slug: z.string() });
const checkSlugQuerySchema = z.object({ slug: z.string().max(100) });

export const companyRoutes: FastifyPluginAsync = async (app) => {
  const strictLimit = {
    rateLimit: { max: app.config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' },
  };

  /** Create a company and its owner account (email confirmation required). */
  app.post('/', { config: strictLimit }, async (request, reply) => {
    const input = parse(createCompanySchema, request.body);
    return reply.status(201).send(await app.services.auth.createCompany(input));
  });

  /** Live availability check for the sign-up form. */
  app.get('/check-slug', async (request) => {
    const { slug: raw } = parse(checkSlugQuerySchema, request.query);
    const result = companySlugSchema.safeParse(raw);
    if (!result.success) {
      return { slug: raw, available: false, reason: result.error.issues[0]?.message };
    }
    const taken = await app.prisma.company.findUnique({
      where: { slug: result.data },
      select: { id: true },
    });
    return {
      slug: result.data,
      available: !taken,
      reason: taken ? 'This address is already taken' : undefined,
    };
  });

  /** Public information shown on a company's sign-in page. */
  app.get('/:slug', async (request): Promise<PublicCompanyDTO> => {
    const { slug } = parse(slugParamsSchema, request.params);
    return app.services.portal.getPublicCompany(slug.toLowerCase());
  });
};

/** /api/company — settings of the signed-in user's company. */
export const companySettingsRoutes: FastifyPluginAsync = async (app) => {
  app.patch(
    '/',
    { preHandler: app.authorize(PERMISSIONS.COMPANY_SETTINGS) },
    async (request): Promise<PublicCompanyDTO> => {
      const input = parse(companySettingsSchema, request.body);
      return app.services.portal.updateSettings(request.user.companyId, input);
    },
  );
};
