import { readdir } from 'node:fs/promises';
import type { PublicConfigDTO } from '@support-desk/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import {
  type Mock,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import {
  DEFAULT_SLUG,
  PASSWORD,
  createCompany,
  createTestApp,
  createUser,
  latestEmailTo,
  multipart,
  resetDatabase,
} from './helpers';

describe('find my company', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
  });

  const find = (email: string) =>
    app.inject({ method: 'POST', url: '/api/companies/find', payload: { email } });

  it('emails every company where the address has an active account', async () => {
    const email = 'sam@example.com';
    const globex = await createCompany(app.prisma, 'globex', 'Globex Corporation');
    const initech = await createCompany(app.prisma, 'initech', 'Initech');
    await createUser(app.prisma, 'AGENT', { email });
    await createUser(app.prisma, 'CUSTOMER', { email, companyId: globex.id });
    await createUser(app.prisma, 'CUSTOMER', { email, companyId: initech.id, isActive: false });
    // A guest account (created by a confirmed public request) has no password.
    const hooli = await createCompany(app.prisma, 'hooli', 'Hooli');
    await app.prisma.user.create({
      data: { companyId: hooli.id, email, name: 'Sam', role: 'CUSTOMER', passwordHash: null },
    });

    const res = await find('  SAM@example.com ');
    expect(res.statusCode, res.body).toBe(202);

    const sent = await latestEmailTo(app.prisma, email);
    expect(sent.subject).toBe('Your Support Desk companies');
    expect(sent.text).toContain('Here are your 3 companies');
    expect(sent.text).toContain(
      `Acme Inc. (Team member): http://localhost:5173/${DEFAULT_SLUG}/login`,
    );
    expect(sent.text).toContain(
      'Globex Corporation (Customer): http://localhost:5173/globex/login',
    );
    expect(sent.text).toContain('Hooli (Customer · signs in with an email link)');
    // Deactivated accounts are left out.
    expect(sent.text).not.toContain('Initech');
    expect(sent.html).toContain('href="http://localhost:5173/globex/login"');
  });

  it('answers the same way for unknown emails, without sending anything', async () => {
    const res = await find('nobody@example.com');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(await app.prisma.devEmail.count({ where: { to: 'nobody@example.com' } })).toBe(0);
  });

  it('validates the email address', async () => {
    const res = await find('not-an-email');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].path).toBe('email');
  });
});

describe('human check (Cloudflare Turnstile)', () => {
  let app: FastifyInstance;
  let siteverify: Mock<typeof fetch>;

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      TURNSTILE_SITE_KEY: 'test-site-key',
      TURNSTILE_SECRET_KEY: 'test-secret-key',
    });
    app = await buildApp({ config });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
    // Cloudflare's verdict: tokens starting with "good" pass.
    siteverify = vi.fn<typeof fetch>(async (_url, init) => {
      const token = new URLSearchParams(init?.body as URLSearchParams).get('response') ?? '';
      return Response.json(
        token.startsWith('good')
          ? { success: true }
          : { success: false, 'error-codes': ['invalid-input-response'] },
      );
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(siteverify);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const guardedRequests: [string, InjectOptions][] = [
    [
      'company sign-up',
      {
        method: 'POST',
        url: '/api/companies',
        payload: {
          companyName: 'Globex',
          slug: 'globex',
          name: 'Hank Scorpio',
          email: 'hank@example.com',
          password: PASSWORD,
        },
      },
    ],
    [
      'find my company',
      { method: 'POST', url: '/api/companies/find', payload: { email: 'a@example.com' } },
    ],
    [
      'registration',
      {
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          companySlug: DEFAULT_SLUG,
          name: 'Rita',
          email: 'rita@example.com',
          password: PASSWORD,
        },
      },
    ],
    [
      'forgot password',
      {
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { companySlug: DEFAULT_SLUG, email: 'a@example.com' },
      },
    ],
    [
      'sign-in link',
      {
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { companySlug: DEFAULT_SLUG, email: 'a@example.com' },
      },
    ],
    [
      'public ticket request',
      {
        method: 'POST',
        url: `/api/portal/${DEFAULT_SLUG}/tickets`,
        payload: {
          subject: 'Printer on fire',
          description: 'It is very much on fire.',
          email: 'guest@example.com',
          name: 'Guest',
        },
      },
    ],
  ];

  it('publishes the site key and allows the widget in the CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json<PublicConfigDTO>().captchaSiteKey).toBe('test-site-key');
    expect(res.headers['content-security-policy']).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
  });

  it.each(guardedRequests)('requires a token for %s', async (_name, options) => {
    const res = await app.inject(options);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.code).toBe('CAPTCHA_REQUIRED');
    expect(siteverify).not.toHaveBeenCalled();
  });

  it.each(guardedRequests)('accepts a verified token for %s', async (_name, options) => {
    const res = await app.inject({
      ...options,
      headers: { 'x-captcha-token': 'good-token' },
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode, res.body).toBeLessThan(300);

    expect(siteverify).toHaveBeenCalledOnce();
    const [url, init] = siteverify.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({
      secret: 'test-secret-key',
      response: 'good-token',
      remoteip: '203.0.113.7',
    });
  });

  it('rejects a token Cloudflare refuses before reading any upload', async () => {
    const uploadDir = app.config.UPLOAD_DIR;
    const before = await readdir(uploadDir).catch(() => []);
    const form = await multipart(
      {
        subject: 'Spam',
        description: 'Buy cheap things now',
        email: 'bot@example.com',
        name: 'Bot',
      },
      [{ name: 'payload.txt', content: 'x'.repeat(1000), type: 'text/plain' }],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/portal/${DEFAULT_SLUG}/tickets`,
      headers: { ...form.headers, 'x-captcha-token': 'bad-token' },
      payload: form.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CAPTCHA_FAILED');
    expect(await app.prisma.pendingSubmission.count()).toBe(0);
    expect(await readdir(uploadDir).catch(() => [])).toEqual(before);
  });

  it('fails closed when Cloudflare cannot be reached', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    const [, options] = guardedRequests[1]!;
    const res = await app.inject({ ...options, headers: { 'x-captcha-token': 'good-token' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CAPTCHA_UNAVAILABLE');
  });

  it('does not slow down signing in', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { companySlug: DEFAULT_SLUG, email: user.email, password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(siteverify).not.toHaveBeenCalled();
  });
});

describe('human check configuration', () => {
  it('is off unless both keys are set', () => {
    expect(loadConfig({ ...process.env }).captcha).toBeNull();
    expect(() => loadConfig({ ...process.env, TURNSTILE_SITE_KEY: 'only-the-site-key' })).toThrow(
      /set both/,
    );
  });
});
