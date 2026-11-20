import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { type AppConfig, loadConfig } from './config/env';
import { AppError } from './lib/errors';
import { attachmentRoutes } from './modules/attachments/attachments.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { categoryRoutes } from './modules/categories/categories.routes';
import { statsRoutes } from './modules/stats/stats.routes';
import { systemRoutes } from './modules/system/system.routes';
import { ticketRoutes } from './modules/tickets/tickets.routes';
import { userRoutes } from './modules/users/users.routes';
import authPlugin from './plugins/auth';
import { registerErrorHandlers } from './plugins/error-handler';
import { createServices } from './services';
import { type FileStorage, LocalFileStorage } from './storage/file-storage';

export interface BuildAppOptions {
  config?: AppConfig;
  prisma?: PrismaClient;
  storage?: FileStorage;
}

function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    ...(config.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const prisma = options.prisma ?? new PrismaClient();
  const storage = options.storage ?? new LocalFileStorage(path.resolve(config.UPLOAD_DIR));

  const webRoot = path.resolve(config.WEB_DIST_DIR);
  const serveWeb = config.SERVE_WEB && existsSync(path.join(webRoot, 'index.html'));

  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  app.decorate('config', config);
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  // --- Security & parsing -------------------------------------------------
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Only force HTTPS sub-resources when the app is actually served over HTTPS.
        upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
      },
    },
    strictTransportSecurity: config.COOKIE_SECURE ? undefined : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many requests. Try again in ${context.after}.`),
  });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: config.MAX_FILES_PER_UPLOAD,
      fields: 20,
      fieldSize: 64 * 1024,
      parts: 40,
    },
  });
  await app.register(authPlugin);

  app.decorate(
    'services',
    createServices({
      prisma,
      storage,
      config,
      log: app.log,
      signAccessToken: (payload) => app.jwt.sign(payload),
    }),
  );

  registerErrorHandlers(app, { spaFallback: serveWeb });

  // --- API -----------------------------------------------------------------
  await app.register(
    async (api) => {
      await api.register(systemRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(categoryRoutes, { prefix: '/categories' });
      await api.register(ticketRoutes, { prefix: '/tickets' });
      await api.register(attachmentRoutes, { prefix: '/attachments' });
      await api.register(statsRoutes, { prefix: '/stats' });
    },
    { prefix: '/api' },
  );

  // --- Optional: serve the built React app from the same origin ----------
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: true,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        // Vite fingerprints everything under /assets, so those files never change.
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        reply.header(
          'Cache-Control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  } else if (config.SERVE_WEB) {
    app.log.warn({ webRoot }, 'SERVE_WEB is enabled but no web build was found; serving API only');
  }

  return app;
}
