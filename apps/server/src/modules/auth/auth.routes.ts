import {
  type AuthResponse,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../lib/validation';
import type { IssuedSession, SessionMeta } from './auth.service';

export const REFRESH_COOKIE = 'sd_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { config } = app;
  const strictLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  const cookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: REFRESH_COOKIE_PATH,
  } as const;

  const meta = (request: FastifyRequest): SessionMeta => ({
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  });

  /** The refresh token only ever lives in an httpOnly cookie scoped to /api/auth. */
  const sendSession = (reply: FastifyReply, session: IssuedSession, status = 200) => {
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      expires: session.refreshTokenExpiresAt,
    });
    const body: AuthResponse = {
      user: session.user,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    };
    return reply.status(status).send(body);
  };

  app.post('/register', { config: strictLimit }, async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const session = await app.services.auth.register(input, meta(request));
    return sendSession(reply, session, 201);
  });

  app.post('/login', { config: strictLimit }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const session = await app.services.auth.login(input, meta(request));
    return sendSession(reply, session);
  });

  app.post('/refresh', async (request, reply) => {
    try {
      const session = await app.services.auth.refresh(
        request.cookies[REFRESH_COOKIE],
        meta(request),
      );
      return sendSession(reply, session);
    } catch (error) {
      // Drop a dead cookie, except during a benign rotation race where it is still valid.
      if ((error as { code?: string }).code !== 'SESSION_ROTATED') {
        reply.clearCookie(REFRESH_COOKIE, cookieOptions);
      }
      throw error;
    }
  });

  app.post('/logout', async (request, reply) => {
    await app.services.auth.logout(request.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    return { user: await app.services.auth.getProfile(request.user.id) };
  });

  app.patch('/me', { preHandler: app.authenticate }, async (request) => {
    const input = parse(updateProfileSchema, request.body);
    return { user: await app.services.auth.updateProfile(request.user.id, input) };
  });

  app.post(
    '/change-password',
    { preHandler: app.authenticate, config: strictLimit },
    async (request, reply) => {
      const input = parse(changePasswordSchema, request.body);
      await app.services.auth.changePassword(
        request.user.id,
        input,
        request.cookies[REFRESH_COOKIE],
      );
      return reply.status(204).send();
    },
  );
};
