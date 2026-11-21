import { emailLinkSchema, guestTicketSchema } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { normalizeFormFields, readBodyWithFiles, withUploadCleanup } from '../../lib/multipart';
import { sendSession, sessionMeta } from '../../lib/session-cookie';
import { parse } from '../../lib/validation';

const slugParamsSchema = z.object({ slug: z.string().max(100) });

/** /api/portal — public endpoints behind each company's ticket page. */
export const portalRoutes: FastifyPluginAsync = async (app) => {
  const { config } = app;
  const submissionLimit = {
    rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' },
  };

  app.get('/:slug/categories', async (request) => {
    const { slug } = parse(slugParamsSchema, request.params);
    return { data: await app.services.portal.listCategories(slug.toLowerCase()) };
  });

  /** A request from a visitor who isn't signed in (JSON or multipart with `files`). */
  app.post('/:slug/tickets', { config: submissionLimit }, async (request, reply) => {
    const { slug } = parse(slugParamsSchema, request.params);
    const { storage } = app.services;
    const { body, files } = await readBodyWithFiles(request, storage, {
      maxFileSizeBytes: config.maxUploadBytes,
      maxFiles: config.MAX_FILES_PER_UPLOAD,
    });
    const result = await withUploadCleanup(storage, files, () =>
      app.services.portal.submit(
        slug.toLowerCase(),
        parse(guestTicketSchema, normalizeFormFields(body, request.isMultipart())),
        files,
      ),
    );
    return reply.status(202).send(result);
  });

  /** Confirm a request from its emailed link: creates the ticket and signs the visitor in. */
  app.post('/confirm', { config: submissionLimit }, async (request, reply) => {
    const { token } = parse(emailLinkSchema, request.body);
    const { session, ticketId } = await app.services.portal.confirm(token, sessionMeta(request));
    return sendSession(reply, config, session, { ticketId });
  });
};
