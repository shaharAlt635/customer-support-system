import type { AuthResponse } from '@support-desk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env';
import type { IssuedSession, SessionMeta } from '../modules/auth/auth.service';

/**
 * Each company gets its own refresh cookie, so one browser can stay signed in to several
 * companies at once (the same email may have an account in each).
 */
export const refreshCookieName = (companyId: string) => `sd_rt_${companyId}`;

export function refreshCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    // Only sent to the auth endpoints (refresh/logout), never to the rest of the API.
    path: '/api/auth',
  } as const;
}

export function sessionMeta(request: FastifyRequest): SessionMeta {
  return { userAgent: request.headers['user-agent'], ipAddress: request.ip };
}

/** Set the refresh cookie and reply with the access token (plus any extra fields). */
export function sendSession(
  reply: FastifyReply,
  config: AppConfig,
  session: IssuedSession,
  extra: Record<string, unknown> = {},
  status = 200,
) {
  reply.setCookie(refreshCookieName(session.company.id), session.refreshToken, {
    ...refreshCookieOptions(config),
    expires: session.refreshTokenExpiresAt,
  });
  const body: AuthResponse = {
    user: session.user,
    company: session.company,
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
  };
  return reply.status(status).send({ ...body, ...extra });
}
