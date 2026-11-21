import {
  changePasswordSchema,
  companyLoginSchema,
  companyRegisterSchema,
  companySlugSchema,
  emailLinkSchema,
  emailRequestSchema,
  passwordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  refreshCookieName,
  refreshCookieOptions,
  sendSession as sendSessionReply,
  sessionMeta,
} from '../../lib/session-cookie';
import { parse } from '../../lib/validation';
import type { IssuedSession } from './auth.service';

export { refreshCookieName };

const companyBodySchema = z.object({ companySlug: companySlugSchema });
const setPasswordSchema = z.object({ password: passwordSchema });

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { config } = app;
  const strictLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };
  const cookieOptions = refreshCookieOptions(config);
  const meta = sessionMeta;
  const sendSession = (reply: FastifyReply, session: IssuedSession) =>
    sendSessionReply(reply, config, session);

  app.post('/register', { config: strictLimit }, async (request, reply) => {
    const input = parse(companyRegisterSchema, request.body);
    return reply.status(201).send(await app.services.auth.register(input));
  });

  app.post('/login', { config: strictLimit }, async (request, reply) => {
    const input = parse(companyLoginSchema, request.body);
    return sendSession(reply, await app.services.auth.login(input, meta(request)));
  });

  app.post('/verify-email', { config: strictLimit }, async (request, reply) => {
    const { token } = parse(verifyEmailSchema, request.body);
    return sendSession(reply, await app.services.auth.verifyEmail(token, meta(request)));
  });

  app.post('/resend-verification', { config: strictLimit }, async (request, reply) => {
    await app.services.auth.resendVerification(parse(emailRequestSchema, request.body));
    return reply.status(202).send({ ok: true });
  });

  app.post('/forgot-password', { config: strictLimit }, async (request, reply) => {
    await app.services.auth.requestPasswordReset(parse(emailRequestSchema, request.body));
    return reply.status(202).send({ ok: true });
  });

  /** Email a one-time sign-in link (works for guests, who have no password). */
  app.post('/magic-link', { config: strictLimit }, async (request, reply) => {
    await app.services.auth.requestMagicLink(parse(emailRequestSchema, request.body));
    return reply.status(202).send({ ok: true });
  });

  app.post('/magic-login', { config: strictLimit }, async (request, reply) => {
    const { token } = parse(emailLinkSchema, request.body);
    return sendSession(reply, await app.services.auth.magicLogin(token, meta(request)));
  });

  /** Guests who signed in by email link can add a password to their account. */
  app.post(
    '/set-password',
    { preHandler: app.authenticate, config: strictLimit },
    async (request, reply) => {
      const { password } = parse(setPasswordSchema, request.body);
      await app.services.auth.setInitialPassword(request.user.id, password);
      return reply.status(204).send();
    },
  );

  app.post('/reset-password', { config: strictLimit }, async (request) => {
    return app.services.auth.resetPassword(parse(resetPasswordSchema, request.body));
  });

  app.post('/refresh', async (request, reply) => {
    const { companySlug } = parse(companyBodySchema, request.body);
    const company = await app.services.auth.findCompany(companySlug);
    const cookieName = refreshCookieName(company.id);
    try {
      const session = await app.services.auth.refresh(
        company,
        request.cookies[cookieName],
        meta(request),
      );
      return sendSession(reply, session);
    } catch (error) {
      // Drop a dead cookie, except during a benign rotation race where it is still valid.
      if ((error as { code?: string }).code !== 'SESSION_ROTATED') {
        reply.clearCookie(cookieName, cookieOptions);
      }
      throw error;
    }
  });

  app.post('/logout', async (request, reply) => {
    const { companySlug } = parse(companyBodySchema, request.body);
    const company = await app.services.auth.findCompany(companySlug).catch(() => null);
    if (company) {
      const cookieName = refreshCookieName(company.id);
      await app.services.auth.logout(request.cookies[cookieName]);
      reply.clearCookie(cookieName, cookieOptions);
    }
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    return app.services.auth.getProfile(request.user.id);
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
        request.cookies[refreshCookieName(request.user.companyId)],
      );
      return reply.status(204).send();
    },
  );
};
