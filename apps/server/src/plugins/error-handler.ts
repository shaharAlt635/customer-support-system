import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@support-desk/shared';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { formatZodIssues } from '../lib/validation';

function send(reply: FastifyReply, status: number, body: ApiErrorBody['error']) {
  return reply.status(status).send({ error: body } satisfies ApiErrorBody);
}

/**
 * Normalises every error into `{ error: { code, message, details? } }`. Client errors keep
 * their message; unexpected errors are logged and returned as an opaque 500.
 */
export function registerErrorHandlers(app: FastifyInstance, options: { spaFallback: boolean }) {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      return send(reply, error.statusCode, {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    if (error instanceof ZodError) {
      return send(reply, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: formatZodIssues(error),
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          return send(reply, 409, {
            code: 'CONFLICT',
            message: 'A record with these details already exists',
          });
        case 'P2025':
          return send(reply, 404, { code: 'NOT_FOUND', message: 'Resource not found' });
        case 'P2023':
          return send(reply, 400, { code: 'BAD_REQUEST', message: 'Malformed identifier' });
      }
    }

    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return send(reply, statusCode, {
        code: ('code' in error && error.code) || 'BAD_REQUEST',
        message: error.message,
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return send(reply, 500, {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (options.spaFallback && !isApi && (request.method === 'GET' || request.method === 'HEAD')) {
      // Client-side routes: let the React router handle the path.
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return send(reply, 404, {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url.split('?')[0]} not found`,
    });
  });
}
