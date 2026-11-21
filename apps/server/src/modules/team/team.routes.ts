import { PERMISSIONS, inviteSchema, updateMemberSchema } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parse, parseIdParam } from '../../lib/validation';

/** /api/team — the company's support team and its invitations. */
export const teamRoutes: FastifyPluginAsync = async (app) => {
  const viewTeam = app.authorizeAny(PERMISSIONS.TEAM_INVITE, PERMISSIONS.TEAM_MANAGE);
  const invite = app.authorize(PERMISSIONS.TEAM_INVITE);
  const manage = app.authorize(PERMISSIONS.TEAM_MANAGE);

  app.get('/members', { preHandler: viewTeam }, async (request) => ({
    data: await app.services.team.listMembers(request.user.companyId),
  }));

  /** Team members tickets can be assigned to — for anyone who can assign. */
  app.get(
    '/assignable',
    {
      preHandler: app.authorizeAny(
        PERMISSIONS.TICKETS_ASSIGN_SELF,
        PERMISSIONS.TICKETS_ASSIGN_OTHERS,
      ),
    },
    async (request) => ({ data: await app.services.team.listAssignable(request.user.companyId) }),
  );

  app.patch('/members/:id', { preHandler: manage }, async (request) => {
    const id = parseIdParam(request.params, 'Team member');
    const input = parse(updateMemberSchema, request.body);
    return app.services.team.changeGroup(request.user, id, input);
  });

  app.delete('/members/:id', { preHandler: manage }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Team member');
    await app.services.team.removeMember(request.user, id);
    return reply.status(204).send();
  });

  app.get('/invitations', { preHandler: viewTeam }, async (request) => ({
    data: await app.services.team.listInvitations(request.user.companyId),
  }));

  app.post(
    '/invitations',
    {
      preHandler: invite,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const input = parse(inviteSchema, request.body);
      return reply.status(201).send(await app.services.team.invite(request.user, input));
    },
  );

  app.post(
    '/invitations/:id/resend',
    { preHandler: invite, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const id = parseIdParam(request.params, 'Invitation');
      return app.services.team.resend(request.user, id);
    },
  );

  app.delete('/invitations/:id', { preHandler: invite }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Invitation');
    await app.services.team.revoke(request.user, id);
    return reply.status(204).send();
  });
};

/** /api/me — things that belong to the signed-in user. */
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/invitations', async (request) => ({
    data: await app.services.team.myInvitations(request.user),
  }));

  app.post('/invitations/:id/accept', async (request) => {
    const id = parseIdParam(request.params, 'Invitation');
    await app.services.team.accept(request.user, id);
    return app.services.auth.getProfile(request.user.id);
  });

  app.post('/invitations/:id/decline', async (request, reply) => {
    const id = parseIdParam(request.params, 'Invitation');
    await app.services.team.decline(request.user, id);
    return reply.status(204).send();
  });
};
