import {
  PERMISSIONS,
  createMessageSchema,
  createTicketSchema,
  ticketListQuerySchema,
  updateTicketSchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { readBodyWithFiles, withUploadCleanup } from '../../lib/multipart';
import { parse, parseIdParam } from '../../lib/validation';

const BOOLEAN_FORM_FIELDS = new Set(['isInternal']);

/** Multipart form fields arrive as strings; convert them to the JSON shapes the schemas expect. */
function normalizeFormFields(body: unknown, isMultipart: boolean): unknown {
  if (!isMultipart || typeof body !== 'object' || body === null) return body;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, string>)) {
    if (value === '') continue;
    fields[key] = BOOLEAN_FORM_FIELDS.has(key) ? value === 'true' : value;
  }
  return fields;
}

export const ticketRoutes: FastifyPluginAsync = async (app) => {
  const { storage } = app.services;
  const uploadLimits = {
    maxFileSizeBytes: app.config.maxUploadBytes,
    maxFiles: app.config.MAX_FILES_PER_UPLOAD,
  };

  const readForm = async (request: FastifyRequest) => {
    const { body, files } = await readBodyWithFiles(request, storage, uploadLimits);
    return { body: normalizeFormFields(body, request.isMultipart()), files };
  };

  app.get('/', { preHandler: app.authenticate }, async (request) => {
    const query = parse(ticketListQuerySchema, request.query);
    return app.services.tickets.list(request.user, query);
  });

  app.post(
    '/',
    { preHandler: app.authorize(PERMISSIONS.TICKET_CREATE) },
    async (request, reply) => {
      const { body, files } = await readForm(request);
      const ticket = await withUploadCleanup(storage, files, () =>
        app.services.tickets.create(request.user, parse(createTicketSchema, body), files),
      );
      return reply.status(201).send(ticket);
    },
  );

  app.get('/:id', { preHandler: app.authenticate }, async (request) => {
    const id = parseIdParam(request.params, 'Ticket');
    return app.services.tickets.getDetail(request.user, id);
  });

  app.patch('/:id', { preHandler: app.authenticate }, async (request) => {
    const id = parseIdParam(request.params, 'Ticket');
    const input = parse(updateTicketSchema, request.body);
    return app.services.tickets.update(request.user, id, input);
  });

  app.delete(
    '/:id',
    { preHandler: app.authorize(PERMISSIONS.TICKET_DELETE) },
    async (request, reply) => {
      const id = parseIdParam(request.params, 'Ticket');
      await app.services.tickets.remove(id);
      return reply.status(204).send();
    },
  );

  app.post('/:id/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Ticket');
    const { body, files } = await readForm(request);
    const message = await withUploadCleanup(storage, files, () =>
      app.services.tickets.addMessage(request.user, id, parse(createMessageSchema, body), files),
    );
    return reply.status(201).send(message);
  });
};
