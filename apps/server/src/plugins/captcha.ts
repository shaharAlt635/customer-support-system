import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, Errors } from '../lib/errors';

/** Cloudflare's script and challenge frames are served from this origin. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const VERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
/** The browser sends the widget's token in this header, so it also works for multipart forms. */
export const CAPTCHA_HEADER = 'x-captcha-token';

/**
 * `app.requireCaptcha` — a preHandler for public forms (sign-up, public requests, emailed
 * links). It runs before the body is read, so bots are turned away before any upload is
 * streamed to disk. Without Turnstile keys configured it lets every request through.
 */
export default fp(
  async (app) => {
    async function requireCaptcha(request: FastifyRequest): Promise<void> {
      const captcha = app.config.captcha;
      if (!captcha) return;

      const token = request.headers[CAPTCHA_HEADER];
      if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
        throw Errors.badRequest('Please complete the human check.', 'CAPTCHA_REQUIRED');
      }

      let outcome: { success?: boolean; 'error-codes'?: string[] };
      try {
        const response = await fetch(VERIFY_URL, {
          method: 'POST',
          body: new URLSearchParams({
            secret: captcha.secretKey,
            response: token,
            remoteip: request.ip,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Turnstile responded with ${response.status}`);
        outcome = (await response.json()) as typeof outcome;
      } catch (error) {
        request.log.error({ err: error }, 'Human check verification failed');
        throw new AppError(
          503,
          'CAPTCHA_UNAVAILABLE',
          "We couldn't run the human check right now. Please try again in a moment.",
        );
      }

      if (!outcome.success) {
        request.log.info({ codes: outcome['error-codes'] }, 'Human check rejected');
        throw Errors.badRequest(
          "We couldn't confirm you're human. Please try the check again.",
          'CAPTCHA_FAILED',
        );
      }
    }

    app.decorate('requireCaptcha', requireCaptcha);
  },
  { name: 'captcha' },
);
