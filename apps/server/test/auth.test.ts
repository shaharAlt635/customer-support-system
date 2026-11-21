import type { AuthResponse, VerificationPendingDTO } from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SLUG,
  PASSWORD,
  type Session,
  company,
  createTestApp,
  createUser,
  latestEmailTo,
  login,
  resetDatabase,
  tokenFromEmail,
} from './helpers';

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

const refreshWith = (session: Pick<Session, 'cookieName'>, cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    payload: { companySlug: DEFAULT_SLUG },
    cookies: { [session.cookieName]: cookie },
  });

const register = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { companySlug: DEFAULT_SLUG, ...payload },
  });

describe('registration', () => {
  it('creates an unverified customer account and emails a confirmation link', async () => {
    const res = await register({
      name: 'Ada Lovelace',
      email: '  Ada@Example.com ',
      password: 'Analytical1',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<VerificationPendingDTO>()).toMatchObject({
      email: 'ada@example.com',
      verificationRequired: true,
      company: { slug: DEFAULT_SLUG },
    });
    // No session until the email is confirmed.
    expect(res.cookies).toHaveLength(0);

    const user = await app.prisma.user.findFirstOrThrow({ where: { email: 'ada@example.com' } });
    expect(user).toMatchObject({
      role: 'CUSTOMER',
      companyId: company().id,
      emailVerifiedAt: null,
    });

    const email = await latestEmailTo(app.prisma, 'ada@example.com');
    expect(email.subject).toContain('Acme Inc.');
    expect(email.html).not.toContain('<script');
  });

  it('confirms the email from the link and signs the user in', async () => {
    await register({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'Analytical1' });
    const token = tokenFromEmail(
      await latestEmailTo(app.prisma, 'ada@example.com'),
      'verify-email',
    );

    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json<AuthResponse>();
    expect(body.user).toMatchObject({ email: 'ada@example.com', emailVerified: true });
    expect(body.company.slug).toBe(DEFAULT_SLUG);
    expect(verify.cookies.find((c) => c.name.startsWith('sd_rt_'))).toMatchObject({
      httpOnly: true,
      path: '/api/auth',
      sameSite: 'Strict',
    });

    // Links are single-use.
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('INVALID_TOKEN');
  });

  it('rejects weak passwords with field-level errors', async () => {
    const res = await register({ name: 'A', email: 'not-an-email', password: 'short' });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('refuses duplicate emails within the same company', async () => {
    await createUser(app.prisma, 'CUSTOMER', { email: 'taken@example.com' });
    const res = await register({
      name: 'Someone',
      email: 'taken@example.com',
      password: 'Password1',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_IN_USE');
  });

  it('returns 404 for an unknown company', async () => {
    const res = await register({
      companySlug: 'nope',
      name: 'Someone',
      email: 'x@example.com',
      password: 'Password1',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('login', () => {
  it('signs in with valid credentials', async () => {
    const user = await createUser(app.prisma, 'AGENT');
    const session = await login(app, user.email);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: session.headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { id: user.id, role: 'AGENT' },
      company: { slug: DEFAULT_SLUG },
    });
  });

  it('returns the same error for unknown emails, wrong passwords and unknown companies', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const attempt = (payload: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload });

    const wrongPassword = await attempt({
      companySlug: DEFAULT_SLUG,
      email: user.email,
      password: 'Wrong-password1',
    });
    const unknownEmail = await attempt({
      companySlug: DEFAULT_SLUG,
      email: 'nobody@example.com',
      password: PASSWORD,
    });
    const unknownCompany = await attempt({
      companySlug: 'globex',
      email: user.email,
      password: PASSWORD,
    });

    for (const res of [wrongPassword, unknownEmail, unknownCompany]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(wrongPassword.json());
    }
  });

  it('requires a confirmed email', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER', { verified: false });
    await expect(login(app, user.email)).rejects.toThrow(/EMAIL_NOT_VERIFIED/);

    // Resending is always accepted and emails a fresh link.
    const resend = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { companySlug: DEFAULT_SLUG, email: user.email },
    });
    expect(resend.statusCode).toBe(202);
    await expect(latestEmailTo(app.prisma, user.email)).resolves.toBeDefined();

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { companySlug: DEFAULT_SLUG, email: 'nobody@example.com' },
    });
    expect(unknown.statusCode).toBe(202);
  });

  it('blocks deactivated accounts', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER', { isActive: false });
    await expect(login(app, user.email)).rejects.toThrow(/ACCOUNT_DISABLED/);
  });

  it('rejects requests without a valid access token', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/tickets' });
    const garbage = await app.inject({
      method: 'GET',
      url: '/api/tickets',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(missing.statusCode).toBe(401);
    expect(garbage.statusCode).toBe(401);
  });

  it('invalidates existing access tokens when the user is deactivated', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);
    await app.prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const res = await app.inject({ method: 'GET', url: '/api/tickets', headers: session.headers });
    expect(res.statusCode).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('issues a new token pair and invalidates the old refresh token', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);

    const first = await refreshWith(session, session.refreshCookie);
    expect(first.statusCode).toBe(200);
    const rotated = first.cookies.find((c) => c.name === session.cookieName)?.value;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(session.refreshCookie);

    // Within the grace window the old token is rejected but the session survives.
    const replay = await refreshWith(session, session.refreshCookie);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_ROTATED');

    const again = await refreshWith(session, rotated!);
    expect(again.statusCode).toBe(200);
  });

  it('revokes the whole session when an old token is replayed later', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);
    const rotated = (await refreshWith(session, session.refreshCookie)).cookies.find(
      (c) => c.name === session.cookieName,
    )!.value;

    // Pretend the original token was rotated a long time ago.
    await app.prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const theft = await refreshWith(session, session.refreshCookie);
    expect(theft.statusCode).toBe(401);
    expect(theft.json().error.code).toBe('SESSION_REVOKED');

    // The legitimate (newer) token is now dead too.
    const legit = await refreshWith(session, rotated);
    expect(legit.statusCode).toBe(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { companySlug: DEFAULT_SLUG },
      cookies: { [session.cookieName]: session.refreshCookie },
    });
    expect(logout.statusCode).toBe(204);

    const res = await refreshWith(session, session.refreshCookie);
    expect(res.statusCode).toBe(401);
  });
});

describe('passwords', () => {
  it('changes the password after verifying the current one', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: session.headers,
      payload: { currentPassword: 'nope', newPassword: 'BrandNew1' },
    });
    expect(wrong.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: session.headers,
      payload: { currentPassword: PASSWORD, newPassword: 'BrandNew1' },
    });
    expect(ok.statusCode).toBe(204);

    await expect(login(app, user.email)).rejects.toThrow();
    await expect(login(app, user.email, 'BrandNew1')).resolves.toBeDefined();
  });

  it('resets a forgotten password from an emailed link and signs out other sessions', async () => {
    const user = await createUser(app.prisma, 'AGENT');
    const oldSession = await login(app, user.email);

    const forgot = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { companySlug: DEFAULT_SLUG, email: user.email },
    });
    expect(forgot.statusCode).toBe(202);
    const token = tokenFromEmail(await latestEmailTo(app.prisma, user.email), 'reset-password');

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'Recovered99' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ company: { slug: DEFAULT_SLUG } });

    await expect(login(app, user.email)).rejects.toThrow();
    await expect(login(app, user.email, 'Recovered99')).resolves.toBeDefined();
    expect((await refreshWith(oldSession, oldSession.refreshCookie)).statusCode).toBe(401);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'Another123' },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('does not reveal whether an email has an account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { companySlug: DEFAULT_SLUG, email: 'ghost@example.com' },
    });
    expect(res.statusCode).toBe(202);
    expect(await app.prisma.devEmail.count()).toBe(0);
  });
});
