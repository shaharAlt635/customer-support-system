import { Readable } from 'node:stream';
import type { PublicConfigDTO } from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { DatabaseFileStorage } from '../src/storage/database-storage';
import { createTestApp, resetDatabase } from './helpers';

/** Settings as Vercel would provide them (plus the test database). */
const vercelEnv = (extra: Record<string, string> = {}) => ({
  ...process.env,
  NODE_ENV: undefined,
  VERCEL: '1',
  VERCEL_PROJECT_PRODUCTION_URL: 'support-desk.vercel.app',
  // Not set on Vercel (a developer's .env may set them locally).
  APP_URL: undefined,
  EMAIL_TRANSPORT: undefined,
  MAX_UPLOAD_SIZE_MB: undefined,
  FILE_STORAGE: undefined,
  TRUST_PROXY: undefined,
  COOKIE_SECURE: undefined,
  ...extra,
});

describe('configuration on Vercel', () => {
  it('defaults to production, the deployment URL, database storage and the proxy IP', () => {
    const config = loadConfig(vercelEnv({ DEMO_MODE: 'true' }));
    expect(config.isProduction).toBe(true);
    expect(config.APP_URL).toBe('https://support-desk.vercel.app');
    expect(config.FILE_STORAGE).toBe('database');
    expect(config.MAX_UPLOAD_SIZE_MB).toBe(4);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('keeps the dev mailbox on in production only for a demo', () => {
    const demo = loadConfig(vercelEnv({ DEMO_MODE: 'true' }));
    expect(demo.EMAIL_TRANSPORT).toBe('dev');
    expect(demo.devMailboxEnabled).toBe(true);

    expect(() => loadConfig(vercelEnv())).toThrow(/SMTP_HOST/);
    expect(() => loadConfig(vercelEnv({ EMAIL_TRANSPORT: 'dev' }))).toThrow(/DEMO_MODE/);
  });

  it('leaves local defaults unchanged', () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'development',
      APP_URL: undefined,
      FILE_STORAGE: undefined,
      TRUST_PROXY: undefined,
    });
    expect(config.FILE_STORAGE).toBe('disk');
    expect(config.APP_URL).toBe('http://localhost:5173');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.DEMO_MODE).toBe(false);
  });
});

describe('database file storage', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves, reads and removes files', async () => {
    const storage = new DatabaseFileStorage(app.prisma);
    const key = storage.createKey('.txt');
    expect(
      await storage.save(key, Readable.from([Buffer.from('hello '), Buffer.from('world')])),
    ).toBe(11);
    expect(await storage.exists(key)).toBe(true);

    const chunks: Buffer[] = [];
    for await (const chunk of storage.read(key)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello world');

    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });
});

describe('public demo (DEMO_MODE)', () => {
  let app: FastifyInstance;
  const secret = 'cron-secret-for-tests';

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        CRON_SECRET: secret,
        EMAIL_TRANSPORT: 'dev',
      }),
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
  });

  const cron = (authorization?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/cron/daily',
      headers: authorization ? { authorization } : {},
    });

  it('tells the web app to show the demo logins and the shared mailbox', async () => {
    const config = (
      await app.inject({ method: 'GET', url: '/api/config' })
    ).json<PublicConfigDTO>();
    expect(config).toMatchObject({ demo: true, devMailbox: true });
  });

  it("doesn't let visitors empty the shared mailbox", async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/dev/emails' });
    expect(res.statusCode).toBe(403);
  });

  it('requires the cron secret for the daily job', async () => {
    expect((await cron()).statusCode).toBe(401);
    expect((await cron('Bearer wrong-secret')).statusCode).toBe(401);
  });

  it('resets the database to the demo data every day', async () => {
    await app.prisma.company.create({ data: { slug: 'visitor-co', name: 'A visitor company' } });

    const res = await cron(`Bearer ${secret}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, demoReset: true });

    const slugs = (await app.prisma.company.findMany({ select: { slug: true } })).map(
      (c) => c.slug,
    );
    expect(slugs.sort()).toEqual(['acme', 'globex']);
    expect(await app.prisma.ticket.count()).toBeGreaterThan(50);
  });
});

describe('daily job without demo mode', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({ ...process.env, CRON_SECRET: 'another-secret-for-tests' }),
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('only cleans up, and is hidden when no secret is configured', async () => {
    await resetDatabase(app.prisma);
    const res = await app.inject({
      method: 'GET',
      url: '/api/cron/daily',
      headers: { authorization: 'Bearer another-secret-for-tests' },
    });
    expect(res.json()).toEqual({ ok: true, demoReset: false, expiredRequestsRemoved: 0 });
    expect(await app.prisma.company.count()).toBe(1);

    const plain = await createTestApp();
    expect((await plain.inject({ method: 'GET', url: '/api/cron/daily' })).statusCode).toBe(404);
    await plain.close();
  });
});
