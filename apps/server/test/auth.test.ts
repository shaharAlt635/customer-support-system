import type { AuthResponse } from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE } from '../src/modules/auth/auth.routes';
import { PASSWORD, createTestApp, createUser, login, resetDatabase } from './helpers';

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

const refreshWith = (cookie: string) =>
  app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: cookie } });

describe('registration', () => {
  it('creates a customer account and starts a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Ada Lovelace', email: '  Ada@Example.com ', password: 'Analytical1' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<AuthResponse>();
    expect(body.user).toMatchObject({ email: 'ada@example.com', role: 'CUSTOMER', isActive: true });
    expect(body.accessToken).toBeTypeOf('string');
    expect(body).not.toHaveProperty('user.passwordHash');

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/auth', sameSite: 'Strict' });
  });

  it('rejects weak passwords with field-level errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'A', email: 'not-an-email', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('refuses duplicate emails', async () => {
    await createUser(app.prisma, 'CUSTOMER', { email: 'taken@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Someone', email: 'taken@example.com', password: 'Password1' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_IN_USE');
  });
});

describe('login', () => {
  it('signs in with valid credentials', async () => {
    const user = await createUser(app.prisma, 'AGENT');
    const session = await login(app, user.email);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: session.headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ id: user.id, role: 'AGENT' });
  });

  it('returns the same error for unknown emails and wrong passwords', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'Wrong-password1' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it('blocks deactivated accounts', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER', { isActive: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_DISABLED');
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

    const first = await refreshWith(session.refreshCookie);
    expect(first.statusCode).toBe(200);
    const rotated = first.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(session.refreshCookie);

    // Within the grace window the old token is rejected but the session survives.
    const replay = await refreshWith(session.refreshCookie);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_ROTATED');

    const again = await refreshWith(rotated!);
    expect(again.statusCode).toBe(200);
  });

  it('revokes the whole session when an old token is replayed later', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);
    const rotated = (await refreshWith(session.refreshCookie)).cookies.find(
      (c) => c.name === REFRESH_COOKIE,
    )!.value;

    // Pretend the original token was rotated a long time ago.
    await app.prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const theft = await refreshWith(session.refreshCookie);
    expect(theft.statusCode).toBe(401);
    expect(theft.json().error.code).toBe('SESSION_REVOKED');

    // The legitimate (newer) token is now dead too.
    const legit = await refreshWith(rotated);
    expect(legit.statusCode).toBe(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const user = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, user.email);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [REFRESH_COOKIE]: session.refreshCookie },
    });
    expect(logout.statusCode).toBe(204);

    const res = await refreshWith(session.refreshCookie);
    expect(res.statusCode).toBe(401);
  });
});

describe('profile', () => {
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
});
