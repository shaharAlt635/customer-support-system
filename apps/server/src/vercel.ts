import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { ensureDatabaseIndexes } from './lib/db-maintenance';

/**
 * Entry point for Vercel Functions (see scripts/vercel-build.mjs). Instead of listening on
 * a port, each request is handed to Fastify's router. The app is built once per function
 * instance and reused across requests.
 */
let instance: Promise<FastifyInstance> | undefined;

function getApp(): Promise<FastifyInstance> {
  instance ??= (async () => {
    const app = await buildApp();
    await app.ready();
    // TTL indexes are housekeeping (the daily job recreates them too): don't wait for them.
    void ensureDatabaseIndexes(app.prisma).catch((error: unknown) =>
      app.log.error({ err: error }, 'Could not create TTL indexes'),
    );
    return app;
  })().catch((error: unknown) => {
    instance = undefined; // retry on the next request
    throw error;
  });
  return instance;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', request, response);
}
