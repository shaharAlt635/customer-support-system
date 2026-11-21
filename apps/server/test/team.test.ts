import type {
  AuthResponse,
  CurrentUserDTO,
  GroupDTO,
  InvitationDTO,
  MyInvitationDTO,
  NotificationListDTO,
  Paginated,
  TicketDetailDTO,
  UserDTO,
} from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SLUG,
  PASSWORD,
  company,
  createTestApp,
  createUser,
  findGroup,
  latestEmailTo,
  login,
  resetDatabase,
  sessionFrom,
  signedInAs,
  tokenFromEmail,
} from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

type Actor = Awaited<ReturnType<typeof signedInAs>>;
let owner: Actor;
let admin: Actor;
let agent: Actor;
let customer: Actor;

beforeEach(async () => {
  await resetDatabase(app.prisma);
  [owner, admin, agent, customer] = await Promise.all([
    signedInAs(app, 'OWNER'),
    signedInAs(app, 'ADMIN'),
    signedInAs(app, 'AGENT'),
    signedInAs(app, 'CUSTOMER'),
  ]);
});

const api = (
  actor: { headers: Record<string, string> },
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: `/api${url}`,
    headers: actor.headers,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const groupId = async (name: string) => (await findGroup(app.prisma, company().id, name)).id;

async function createTicket(actor: Actor, subject = 'Printer is on fire again') {
  const res = await api(actor, 'POST', '/tickets', {
    subject,
    description: 'Smoke is coming out of the office printer.',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<TicketDetailDTO>();
}

describe('permission groups', () => {
  it('every company starts with Administrator, Agent and Read-only groups', async () => {
    const res = await api(owner, 'GET', '/groups');
    expect(res.statusCode).toBe(200);
    const groups = res.json<{ data: GroupDTO[] }>().data;
    expect(groups.map((g) => g.name)).toEqual(['Administrator', 'Agent', 'Read-only']);
    expect(groups.find((g) => g.name === 'Agent')).toMatchObject({
      isDefault: true,
      memberCount: 1,
    });
  });

  it('only people with the right permission can manage groups', async () => {
    expect((await api(customer, 'GET', '/groups')).statusCode).toBe(403);
    expect((await api(agent, 'GET', '/groups')).statusCode).toBe(403);
    expect(
      (await api(agent, 'POST', '/groups', { name: 'Sneaky', permissions: [] })).statusCode,
    ).toBe(403);
    expect((await api(admin, 'GET', '/groups')).statusCode).toBe(200);
  });

  it('creates groups with validated permissions and unique names', async () => {
    const created = await api(owner, 'POST', '/groups', {
      name: 'Tier 1',
      description: 'First line support',
      permissions: ['tickets.reply', 'tickets.assign_self', 'tickets.reply'],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<GroupDTO>().permissions).toEqual(['tickets.reply', 'tickets.assign_self']);

    const unknown = await api(owner, 'POST', '/groups', {
      name: 'Hackers',
      permissions: ['everything.ever'],
    });
    expect(unknown.statusCode).toBe(400);

    const duplicate = await api(owner, 'POST', '/groups', { name: 'tier 1', permissions: [] });
    expect(duplicate.statusCode).toBe(409);
  });

  it('applies permission changes to members immediately', async () => {
    const ticket = await createTicket(customer);
    const reply = () => api(agent, 'POST', `/tickets/${ticket.id}/messages`, { body: 'Hello!' });
    expect((await reply()).statusCode).toBe(201);

    const agentGroup = await groupId('Agent');
    const withoutReply = (await findGroup(app.prisma, company().id, 'Agent')).permissions.filter(
      (p) => p !== 'tickets.reply',
    );
    const update = await api(owner, 'PATCH', `/groups/${agentGroup}`, {
      permissions: withoutReply,
    });
    expect(update.statusCode).toBe(200);

    // Same access token as before — permissions are re-read on every request.
    expect((await reply()).statusCode).toBe(403);
    const me = await api(agent, 'GET', '/auth/me');
    expect(me.json<{ user: CurrentUserDTO }>().user.permissions).not.toContain('tickets.reply');
  });

  it('protects groups that are in use and the default group', async () => {
    const inUse = await api(owner, 'DELETE', `/groups/${await groupId('Administrator')}`);
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe('GROUP_IN_USE');

    const isDefault = await api(owner, 'DELETE', `/groups/${await groupId('Agent')}`);
    expect(isDefault.json().error.code).toBe('DEFAULT_GROUP');

    expect((await api(owner, 'DELETE', `/groups/${await groupId('Read-only')}`)).statusCode).toBe(
      204,
    );
  });

  it('moves the default flag when another group becomes the default', async () => {
    const readOnly = await groupId('Read-only');
    await api(owner, 'PATCH', `/groups/${readOnly}`, { isDefault: true });
    const groups = (await api(owner, 'GET', '/groups')).json<{ data: GroupDTO[] }>().data;
    expect(groups.filter((g) => g.isDefault).map((g) => g.name)).toEqual(['Read-only']);
  });
});

describe('team invitations', () => {
  it('invites an existing customer, who accepts and becomes an agent', async () => {
    const res = await api(admin, 'POST', '/team/invitations', {
      email: customer.user.email,
      groupId: await groupId('Agent'),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<InvitationDTO>()).toMatchObject({ hasAccount: true, status: 'PENDING' });

    // Email + bell notification for the invitee.
    const email = await latestEmailTo(app.prisma, customer.user.email);
    expect(email.text).toContain(`/${DEFAULT_SLUG}/invitations`);
    const bell = (await api(customer, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(bell.unreadCount).toBe(1);
    expect(bell.data[0]).toMatchObject({ type: 'INVITATION', link: '/invitations' });

    const mine = (await api(customer, 'GET', '/me/invitations')).json<{
      data: MyInvitationDTO[];
    }>().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]?.group.name).toBe('Agent');

    const accept = await api(customer, 'POST', `/me/invitations/${mine[0]!.id}/accept`);
    expect(accept.statusCode).toBe(200);
    expect(accept.json<{ user: CurrentUserDTO }>().user).toMatchObject({
      role: 'AGENT',
      group: { name: 'Agent' },
    });

    // They now see every ticket, and the inviter hears about it.
    await createTicket(owner, 'Visible to the new agent');
    expect((await api(customer, 'GET', '/tickets')).json().meta.total).toBe(1);
    const inviterBell = (await api(admin, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(inviterBell.data[0]?.title).toContain('joined the team');
    const members = (await api(owner, 'GET', '/team/members')).json<{ data: UserDTO[] }>().data;
    expect(members.map((m) => m.id)).toContain(customer.user.id);
  });

  it('invites an email without an account; the invite waits until they sign up', async () => {
    await api(admin, 'POST', '/team/invitations', {
      email: 'newbie@example.com',
      groupId: await groupId('Read-only'),
    });
    const invitationEmail = await latestEmailTo(app.prisma, 'newbie@example.com');
    expect(invitationEmail.text).toContain(`/${DEFAULT_SLUG}/register?email=newbie%40example.com`);

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companySlug: DEFAULT_SLUG,
        name: 'New Bie',
        email: 'newbie@example.com',
        password: 'Welcome123',
      },
    });
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: {
        token: tokenFromEmail(
          await latestEmailTo(app.prisma, 'newbie@example.com'),
          'verify-email',
        ),
      },
    });
    const newbie = sessionFrom(verify.json<AuthResponse>(), verify.cookies);

    const bell = (await api(newbie, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(bell.data.map((n) => n.type)).toEqual(['INVITATION']);
    const [invitation] = (await api(newbie, 'GET', '/me/invitations')).json<{
      data: MyInvitationDTO[];
    }>().data;
    await api(newbie, 'POST', `/me/invitations/${invitation!.id}/accept`);
    const me = (await api(newbie, 'GET', '/auth/me')).json<{ user: CurrentUserDTO }>().user;
    expect(me).toMatchObject({ role: 'AGENT', group: { name: 'Read-only' } });
    expect(me.permissions.sort()).toEqual(['reports.view', 'tickets.view_all']);
  });

  it('lets the invitee decline', async () => {
    await api(admin, 'POST', '/team/invitations', {
      email: customer.user.email,
      groupId: await groupId('Agent'),
    });
    const [invitation] = (await api(customer, 'GET', '/me/invitations')).json<{
      data: MyInvitationDTO[];
    }>().data;
    expect(
      (await api(customer, 'POST', `/me/invitations/${invitation!.id}/decline`)).statusCode,
    ).toBe(204);
    expect((await api(customer, 'GET', '/me/invitations')).json().data).toEqual([]);
    expect((await api(admin, 'GET', '/team/invitations')).json().data).toEqual([]);
  });

  it('rejects invalid invitations and lets managers resend or revoke', async () => {
    const agentGroup = await groupId('Agent');

    const existingAgent = await api(admin, 'POST', '/team/invitations', {
      email: agent.user.email,
      groupId: agentGroup,
    });
    expect(existingAgent.json().error.code).toBe('ALREADY_MEMBER');

    const first = await api(admin, 'POST', '/team/invitations', {
      email: 'pending@example.com',
      groupId: agentGroup,
    });
    const duplicate = await api(admin, 'POST', '/team/invitations', {
      email: 'pending@example.com',
      groupId: agentGroup,
    });
    expect(duplicate.json().error.code).toBe('INVITATION_PENDING');

    const invitation = first.json<InvitationDTO>();
    const resent = await api(admin, 'POST', `/team/invitations/${invitation.id}/resend`);
    expect(resent.statusCode).toBe(200);
    expect(await app.prisma.devEmail.count({ where: { to: 'pending@example.com' } })).toBe(2);

    expect((await api(admin, 'DELETE', `/team/invitations/${invitation.id}`)).statusCode).toBe(204);
    expect((await api(admin, 'GET', '/team/invitations')).json().data).toEqual([]);
  });

  it('refuses expired invitations', async () => {
    const created = await api(admin, 'POST', '/team/invitations', {
      email: customer.user.email,
      groupId: await groupId('Agent'),
    });
    const { id } = created.json<InvitationDTO>();
    await app.prisma.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await api(customer, 'POST', `/me/invitations/${id}/accept`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVITATION_EXPIRED');
  });

  it('requires the invite permission', async () => {
    const res = await api(agent, 'POST', '/team/invitations', {
      email: 'x@example.com',
      groupId: await groupId('Agent'),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('team members', () => {
  it('changes an agent’s group but never the owner’s or your own', async () => {
    const readOnly = await groupId('Read-only');
    const ok = await api(admin, 'PATCH', `/team/members/${agent.user.id}`, { groupId: readOnly });
    expect(ok.json<UserDTO>().group?.name).toBe('Read-only');

    const ownerChange = await api(admin, 'PATCH', `/team/members/${owner.user.id}`, {
      groupId: readOnly,
    });
    expect(ownerChange.json().error.code).toBe('OWNER_PROTECTED');

    const self = await api(admin, 'PATCH', `/team/members/${admin.user.id}`, { groupId: readOnly });
    expect(self.json().error.code).toBe('SELF_ACCESS_CHANGE');
  });

  it('removing an agent turns them back into a customer and frees their tickets', async () => {
    const ticket = await createTicket(customer);
    await api(admin, 'PATCH', `/tickets/${ticket.id}`, {
      assigneeId: agent.user.id,
      status: 'IN_PROGRESS',
    });

    expect((await api(admin, 'DELETE', `/team/members/${agent.user.id}`)).statusCode).toBe(204);

    const reloaded = await app.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(reloaded.assigneeId).toBeNull();
    // Their existing token immediately loses staff access.
    expect((await api(agent, 'GET', `/tickets/${ticket.id}`)).statusCode).toBe(404);
    const me = (await api(agent, 'GET', '/auth/me')).json<{ user: CurrentUserDTO }>().user;
    expect(me).toMatchObject({ role: 'CUSTOMER', group: null, permissions: [] });

    expect((await api(admin, 'DELETE', `/team/members/${owner.user.id}`)).statusCode).toBe(403);
  });
});

describe('customers', () => {
  it('lists customers and deactivates accounts for people with the permission', async () => {
    expect((await api(agent, 'GET', '/customers')).statusCode).toBe(403);

    const list = await api(admin, 'GET', '/customers');
    expect(list.json<Paginated<UserDTO>>().data.map((u) => u.id)).toEqual([customer.user.id]);

    const res = await api(admin, 'PATCH', `/customers/${customer.user.id}`, { isActive: false });
    expect(res.json<UserDTO>().isActive).toBe(false);
    await expect(login(app, customer.user.email)).rejects.toThrow(/ACCOUNT_DISABLED/);
    expect((await api(customer, 'GET', '/tickets')).statusCode).toBe(401);

    // Team members are managed on the team page, not here.
    expect(
      (await api(admin, 'PATCH', `/customers/${agent.user.id}`, { isActive: false })).statusCode,
    ).toBe(404);
  });
});

describe('ticket permissions', () => {
  it('agents without "see all tickets" only see the open pool and their own queue', async () => {
    const limited = await signedInAs(app, 'AGENT', undefined, 'Read-only');
    await app.prisma.permissionGroup.update({
      where: { id: await groupId('Read-only') },
      data: { permissions: ['tickets.reply'] },
    });
    const pool = await createTicket(customer, 'In the open pool');
    const others = await createTicket(customer, 'Assigned to someone else');
    await api(admin, 'PATCH', `/tickets/${others.id}`, { assigneeId: agent.user.id });

    const visible = (await api(limited, 'GET', '/tickets'))
      .json()
      .data.map((t: { id: string }) => t.id);
    expect(visible).toEqual([pool.id]);
    expect((await api(limited, 'GET', `/tickets/${others.id}`)).statusCode).toBe(404);
  });

  it('enforces each ticket permission separately', async () => {
    const ticket = await createTicket(customer);
    const readOnly = await signedInAs(app, 'AGENT', undefined, 'Read-only');

    expect((await api(readOnly, 'GET', `/tickets/${ticket.id}`)).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ['POST', `/tickets/${ticket.id}/messages`, { body: 'Hi' }],
      ['POST', `/tickets/${ticket.id}/messages`, { body: 'Note', isInternal: true }],
      ['PATCH', `/tickets/${ticket.id}`, { status: 'IN_PROGRESS' }],
      ['PATCH', `/tickets/${ticket.id}`, { priority: 'URGENT' }],
      ['PATCH', `/tickets/${ticket.id}`, { subject: 'Renamed ticket' }],
      ['PATCH', `/tickets/${ticket.id}`, { assigneeId: readOnly.user.id }],
      ['DELETE', `/tickets/${ticket.id}`, undefined],
    ] as const) {
      const res = await api(readOnly, method, url, payload);
      expect(res.statusCode, `${method} ${JSON.stringify(payload)}`).toBe(403);
    }
  });

  it('separates assigning yourself from assigning others', async () => {
    const ticket = await createTicket(customer);
    await app.prisma.permissionGroup.update({
      where: { id: await groupId('Read-only') },
      data: { permissions: ['tickets.view_all', 'tickets.assign_self'] },
    });
    const selfOnly = await signedInAs(app, 'AGENT', undefined, 'Read-only');

    const toOther = await api(selfOnly, 'PATCH', `/tickets/${ticket.id}`, {
      assigneeId: agent.user.id,
    });
    expect(toOther.statusCode).toBe(403);
    const toSelf = await api(selfOnly, 'PATCH', `/tickets/${ticket.id}`, {
      assigneeId: selfOnly.user.id,
    });
    expect(toSelf.statusCode).toBe(200);
    const drop = await api(selfOnly, 'PATCH', `/tickets/${ticket.id}`, { assigneeId: null });
    expect(drop.statusCode).toBe(200);
  });

  it('the owner can do everything', async () => {
    const ticket = await createTicket(customer);
    expect((await api(owner, 'DELETE', `/tickets/${ticket.id}`)).statusCode).toBe(204);
  });
});

describe('notifications', () => {
  it('tells assignees and requesters about relevant activity', async () => {
    const ticket = await createTicket(customer);

    await api(admin, 'PATCH', `/tickets/${ticket.id}`, { assigneeId: agent.user.id });
    let bell = (await api(agent, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(bell.data[0]).toMatchObject({
      type: 'TICKET_ASSIGNED',
      link: `/tickets/${ticket.id}`,
    });
    expect(bell.data[0]?.title).toContain(`#${ticket.number}`);

    // Internal notes never reach the customer.
    await api(admin, 'POST', `/tickets/${ticket.id}/messages`, { body: 'FYI', isInternal: true });
    expect((await api(customer, 'GET', '/notifications')).json().unreadCount).toBe(0);

    await api(agent, 'POST', `/tickets/${ticket.id}/messages`, { body: 'We are on it' });
    const customerBell = (await api(customer, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(customerBell.data.map((n) => n.type)).toEqual(['TICKET_REPLY']);
    expect(customerBell.data[0]?.body).toBe('We are on it');

    await api(customer, 'POST', `/tickets/${ticket.id}/messages`, { body: 'Thanks!' });
    bell = (await api(agent, 'GET', '/notifications')).json<NotificationListDTO>();
    expect(bell.data.map((n) => n.type)).toEqual([
      'TICKET_REPLY',
      'TICKET_NOTE',
      'TICKET_ASSIGNED',
    ]);
    expect(bell.unreadCount).toBe(3);
  });

  it('marks notifications as read', async () => {
    const ticket = await createTicket(customer);
    await api(agent, 'POST', `/tickets/${ticket.id}/messages`, { body: 'One' });
    await api(agent, 'POST', `/tickets/${ticket.id}/messages`, { body: 'Two' });

    const { data } = (await api(customer, 'GET', '/notifications')).json<NotificationListDTO>();
    expect((await api(customer, 'POST', `/notifications/${data[0]!.id}/read`)).statusCode).toBe(
      204,
    );
    expect((await api(customer, 'GET', '/notifications')).json().unreadCount).toBe(1);

    // Someone else's notification can't be touched.
    expect((await api(agent, 'POST', `/notifications/${data[1]!.id}/read`)).statusCode).toBe(404);

    await api(customer, 'POST', '/notifications/read-all');
    expect((await api(customer, 'GET', '/notifications')).json().unreadCount).toBe(0);
  });
});

describe('company settings', () => {
  it('renames the company with the company-settings permission', async () => {
    expect((await api(agent, 'PATCH', '/company', { name: 'Hijacked' })).statusCode).toBe(403);
    const res = await api(admin, 'PATCH', '/company', { name: 'Acme Corporation' });
    expect(res.json()).toMatchObject({ name: 'Acme Corporation', slug: DEFAULT_SLUG });
    expect((await app.inject({ method: 'GET', url: '/api/companies/acme' })).json().name).toBe(
      'Acme Corporation',
    );
  });

  it('customers have no permissions and the owner has all of them', async () => {
    const someone = await createUser(app.prisma, 'CUSTOMER');
    const session = await login(app, someone.email, PASSWORD);
    const me = (await api(session, 'GET', '/auth/me')).json<{ user: CurrentUserDTO }>().user;
    expect(me.permissions).toEqual([]);
    const ownerMe = (await api(owner, 'GET', '/auth/me')).json<{ user: CurrentUserDTO }>().user;
    expect(ownerMe.permissions).toHaveLength(16);
  });
});
