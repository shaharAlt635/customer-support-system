import fastifyJwt from '@fastify/jwt';
import { type Permission, hasPermission } from '@support-desk/shared';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Errors } from '../lib/errors';

/**
 * Access tokens are short-lived JWTs sent as `Authorization: Bearer <token>`.
 * Every authenticated request re-loads the user so that deactivation and role changes
 * take effect immediately rather than when the token expires.
 */
export default fp(
  async (app) => {
    await app.register(fastifyJwt, {
      secret: app.config.JWT_ACCESS_SECRET,
      sign: { expiresIn: `${app.config.ACCESS_TOKEN_TTL_MINUTES}m` },
    });

    async function authenticate(request: FastifyRequest): Promise<void> {
      let userId: string;
      try {
        const payload = await request.jwtVerify<{ sub: string }>();
        userId = payload.sub;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
          throw Errors.unauthorized('Access token expired', 'TOKEN_EXPIRED');
        }
        throw Errors.unauthorized('Missing or invalid access token', 'INVALID_TOKEN');
      }

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw Errors.unauthorized('This account is no longer active', 'ACCOUNT_DISABLED');
      }

      request.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    }

    app.decorate('authenticate', authenticate);

    app.decorate('authorize', (...permissions: Permission[]) => {
      return async (request: FastifyRequest) => {
        await authenticate(request);
        if (!permissions.every((permission) => hasPermission(request.user.role, permission))) {
          throw Errors.forbidden();
        }
      };
    });
  },
  { name: 'auth' },
);
