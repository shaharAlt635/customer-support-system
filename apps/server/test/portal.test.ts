import type {
  AuthResponse,
  NotificationListDTO,
  Paginated,
  PublicCompanyDTO,
  TicketDetailDTO,
  TicketSummaryDTO,
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
  latestEmailTo,
  login,
  multipart,
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
beforeEach(async () => {
  await resetDatabase(app.prisma);
});

const request = {
  subject: 'Cannot download my invoice',
  description: 'The download button on the billing page does nothing.',
};

const setPortal = (data: {
  allowAccountTickets?: boolean;
  allowGuestTickets?: boolean;
  allowAnonymousTickets?: boolean;
}) => app.prisma.company.update({ where: { id: company().id }, data });

const submit = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/portal/${DEFAULT_SLUG}/tickets`,
    payload: { ...request, ...payload },
  });

/** Submit as a guest and click the confirmation link; returns the signed-in session. */
async function submitAndConfirm(payload: Record<string, unknown>) {
  const res = await submit(payload);
  expect(res.statusCode, res.body).toBe(202);
  const email = await latestEmailTo(app.prisma, String(payload.email));
  const confirm = await app.inject({
    method: 'POST',
    url: '/api/portal/confirm',
    payload: { token: tokenFromEmail(email, 'confirm-request') },
  });
  expect(confirm.statusCode, confirm.body).toBe(200);
  const body = confirm.json<AuthResponse & { ticketId: string }>();
  return { ...sessionFrom(body, confirm.cookies), ticketId: body.ticketId, user: body.user };
}

const get = (actor: { headers: Record<string, string> }, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: actor.headers });

describe('public company page', () => {
  it('exposes the ticket page settings and active categories', async () => {
    await app.prisma.category.createMany({
      data: [
        { companyId: company().id, name: 'Billing', color: '#22c55e' },
        { companyId: company().id, name: 'Old', color: '#000000', isActive: false },
      ],
    });
    const info = await app.inject({ method: 'GET', url: '/api/companies/acme' });
    expect(info.json<PublicCompanyDTO>()).toMatchObject({
      allowAccountTickets: true,
      allowGuestTickets: true,
      allowAnonymousTickets: false,
      allowRegistration: true,
      brandColor: '#4f46e5',
    });
    const categories = await app.inject({ method: 'GET', url: '/api/portal/acme/categories' });
    expect(categories.json().data.map((c: { name: string }) => c.name)).toEqual(['Billing']);
  });

  it('lets the company change its ticket page', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/company',
      headers: admin.headers,
      payload: {
        name: 'Acme Inc.',
        allowAccountTickets: false,
        allowAnonymousTickets: true,
        portalTitle: 'How can we help?',
        portalMessage: 'We usually answer within a day.',
        brandColor: '#0ea5e9',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PublicCompanyDTO>()).toMatchObject({
      allowAccountTickets: false,
      allowRegistration: false,
      allowAnonymousTickets: true,
      portalTitle: 'How can we help?',
      brandColor: '#0ea5e9',
    });
  });
});

describe('guest tickets', () => {
  it('only creates the ticket once the email is confirmed', async () => {
    const res = await submit({ name: 'Grace Guest', email: 'grace@example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ email: 'grace@example.com' });

    // Nothing exists yet — no ticket, no account.
    expect(await app.prisma.ticket.count()).toBe(0);
    expect(await app.prisma.user.count({ where: { email: 'grace@example.com' } })).toBe(0);

    const email = await latestEmailTo(app.prisma, 'grace@example.com');
    expect(email.subject).toContain('Confirm your request');
    const token = tokenFromEmail(email, 'confirm-request');
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/portal/confirm',
      payload: { token },
    });
    expect(confirm.statusCode).toBe(200);
    const body = confirm.json<AuthResponse & { ticketId: string }>();
    expect(body.user).toMatchObject({
      email: 'grace@example.com',
      role: 'CUSTOMER',
      hasPassword: false,
    });

    // The guest is signed in and can follow their ticket.
    const session = sessionFrom(body, confirm.cookies);
    const ticket = (await get(session, `/tickets/${body.ticketId}`)).json<TicketDetailDTO>();
    expect(ticket).toMatchObject({ number: 1001, subject: request.subject, isAnonymous: false });
    expect(ticket.customer).toMatchObject({ name: 'Grace Guest', email: 'grace@example.com' });

    // Links work once.
    const again = await app.inject({
      method: 'POST',
      url: '/api/portal/confirm',
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
  });

  it('respects the company settings and validates the form', async () => {
    expect((await submit({ email: 'x@example.com' })).json().error.details).toEqual([
      { path: 'name', message: 'Please tell us your name' },
    ]);
    expect((await submit({ email: 'x@example.com', isAnonymous: true })).json().error.code).toBe(
      'ANONYMOUS_DISABLED',
    );
    await setPortal({ allowGuestTickets: false });
    expect((await submit({ name: 'Xavier', email: 'x@example.com' })).json().error.code).toBe(
      'GUEST_TICKETS_DISABLED',
    );
  });

  it('attaches the ticket to an existing account with the same email', async () => {
    const customer = await createUser(app.prisma, 'CUSTOMER', { email: 'known@example.com' });
    const guest = await submitAndConfirm({ name: 'Known Person', email: 'known@example.com' });
    expect(guest.user.id).toBe(customer.id);
    // Their password still works.
    await expect(login(app, 'known@example.com')).resolves.toBeDefined();
  });

  it('drops a password that was set on a never-confirmed account', async () => {
    // Someone registered this email without access to the inbox…
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companySlug: DEFAULT_SLUG,
        name: 'Impostor',
        email: 'victim@example.com',
        password: 'Hijack1234',
      },
    });
    // …then the real owner confirms a guest request from their inbox.
    await submitAndConfirm({ name: 'Real Owner', email: 'victim@example.com' });
    await expect(login(app, 'victim@example.com', 'Hijack1234')).rejects.toThrow(
      /INVALID_CREDENTIALS/,
    );
  });

  it('accepts attachments and cleans up requests that are never confirmed', async () => {
    const form = await multipart({ ...request, name: 'Fiona File', email: 'fiona@example.com' }, [
      { name: 'screen.txt', content: 'error 500', type: 'text/plain' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/portal/${DEFAULT_SLUG}/tickets`,
      headers: form.headers,
      payload: form.payload,
    });
    expect(res.statusCode, res.body).toBe(202);

    const pending = await app.prisma.pendingSubmission.findFirstOrThrow();
    const [file] = pending.files as unknown as { storageKey: string }[];
    expect(await app.services.storage.exists(file!.storageKey)).toBe(true);

    await app.prisma.pendingSubmission.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await app.services.portal.cleanupExpired()).toBe(1);
    expect(await app.prisma.pendingSubmission.count()).toBe(0);
    expect(await app.services.storage.exists(file!.storageKey)).toBe(false);
  });

  it('quietly drops bot submissions and limits unconfirmed requests', async () => {
    const bot = await submit({ name: 'Bot', email: 'bot@example.com', website: 'http://spam' });
    expect(bot.statusCode).toBe(202);
    expect(await app.prisma.pendingSubmission.count()).toBe(0);
    expect(await app.prisma.devEmail.count()).toBe(0);

    for (let i = 0; i < 5; i++) {
      expect((await submit({ name: 'Eager', email: 'eager@example.com' })).statusCode).toBe(202);
    }
    expect((await submit({ name: 'Eager', email: 'eager@example.com' })).json().error.code).toBe(
      'TOO_MANY_PENDING',
    );
  });
});

describe('anonymous tickets', () => {
  beforeEach(async () => {
    await setPortal({ allowAnonymousTickets: true });
  });

  it('hides the requester from the team but not from themselves', async () => {
    const agent = await signedInAs(app, 'AGENT');
    const guest = await submitAndConfirm({ email: 'whistle@example.com', isAnonymous: true });

    // The requester sees their own identity.
    const own = (await get(guest, `/tickets/${guest.ticketId}`)).json<TicketDetailDTO>();
    expect(own.customer.email).toBe('whistle@example.com');

    // The team never does — not on the ticket, messages, events or notifications.
    await app.inject({
      method: 'POST',
      url: `/api/tickets/${guest.ticketId}/messages`,
      headers: guest.headers,
      payload: { body: 'More details from me' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${guest.ticketId}`,
      headers: agent.headers,
      payload: { assigneeId: agent.user.id },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tickets/${guest.ticketId}/messages`,
      headers: guest.headers,
      payload: { body: 'Any news?' },
    });

    const seen = (await get(agent, `/tickets/${guest.ticketId}`)).json<TicketDetailDTO>();
    expect(seen.isAnonymous).toBe(true);
    expect(seen.customer).toEqual({
      id: 'anonymous',
      name: 'Anonymous',
      email: null,
      role: 'CUSTOMER',
    });
    expect(seen.messages.every((m) => m.author.name === 'Anonymous')).toBe(true);
    expect(seen.events.find((e) => e.type === 'CREATED')?.actor.name).toBe('Anonymous');
    expect(JSON.stringify(seen)).not.toContain('whistle@example.com');

    const bell = (await get(agent, '/notifications')).json<NotificationListDTO>();
    expect(bell.data[0]?.title).toMatch(/^Anonymous replied/);

    // Searching for the requester finds nothing.
    const search = (await get(agent, '/tickets?q=whistle')).json<Paginated<TicketSummaryDTO>>();
    expect(search.meta.total).toBe(0);
    const list = (await get(agent, '/tickets')).json<Paginated<TicketSummaryDTO>>();
    expect(list.data[0]?.customer.name).toBe('Anonymous');
  });

  it('lets signed-in customers submit anonymously only when allowed', async () => {
    const customer = await signedInAs(app, 'CUSTOMER');
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: customer.headers,
      payload: { ...request, isAnonymous: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<TicketDetailDTO>().isAnonymous).toBe(true);

    await setPortal({ allowAnonymousTickets: false });
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: customer.headers,
      payload: { ...request, isAnonymous: true },
    });
    expect(blocked.json().error.code).toBe('ANONYMOUS_DISABLED');
  });
});

describe('customer accounts on the ticket page', () => {
  it('blocks customer tickets and sign-ups when the company turns them off', async () => {
    await setPortal({ allowAccountTickets: false });
    const customer = await signedInAs(app, 'CUSTOMER');
    const agent = await signedInAs(app, 'AGENT');
    const create = (actor: typeof customer) =>
      app.inject({ method: 'POST', url: '/api/tickets', headers: actor.headers, payload: request });

    expect((await create(customer)).json().error.code).toBe('ACCOUNT_TICKETS_DISABLED');
    expect((await create(agent)).statusCode).toBe(201);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companySlug: DEFAULT_SLUG,
        name: 'New One',
        email: 'new@example.com',
        password: 'Password1',
      },
    });
    expect(register.json().error.code).toBe('REGISTRATION_DISABLED');
  });
});

describe('guest accounts and sign-in links', () => {
  it('signs guests in with an emailed link', async () => {
    await submitAndConfirm({ name: 'Linda Link', email: 'linda@example.com' });
    await expect(login(app, 'linda@example.com', PASSWORD)).rejects.toThrow(/INVALID_CREDENTIALS/);

    const ask = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { companySlug: DEFAULT_SLUG, email: 'linda@example.com' },
    });
    expect(ask.statusCode).toBe(202);
    const token = tokenFromEmail(
      await latestEmailTo(app.prisma, 'linda@example.com'),
      'sign-in-link',
    );

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-login',
      payload: { token },
    });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json<AuthResponse>().user.email).toBe('linda@example.com');
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-login',
      payload: { token },
    });
    expect(reuse.statusCode).toBe(400);

    // Unknown emails get the same answer and no email.
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { companySlug: DEFAULT_SLUG, email: 'nobody@example.com' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(await app.prisma.devEmail.count({ where: { to: 'nobody@example.com' } })).toBe(0);
  });

  it('lets a guest add a password once', async () => {
    const guest = await submitAndConfirm({ name: 'Paul Pass', email: 'paul@example.com' });
    const set = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/set-password',
        headers: guest.headers,
        payload: { password },
      });
    expect((await set('MyNewPass1')).statusCode).toBe(204);
    await expect(login(app, 'paul@example.com', 'MyNewPass1')).resolves.toBeDefined();
    expect((await set('Another1234')).json().error.code).toBe('PASSWORD_ALREADY_SET');
  });

  it('turns registration with a guest email into a set-your-password email', async () => {
    const guest = await submitAndConfirm({ name: 'Rita Reg', email: 'rita@example.com' });
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companySlug: DEFAULT_SLUG,
        name: 'Rita',
        email: 'rita@example.com',
        password: 'Typed1234',
      },
    });
    expect(register.statusCode).toBe(201);
    expect(await app.prisma.user.count({ where: { email: 'rita@example.com' } })).toBe(1);
    // The typed password isn't applied until the inbox owner confirms.
    await expect(login(app, 'rita@example.com', 'Typed1234')).rejects.toThrow();

    const email = await latestEmailTo(app.prisma, 'rita@example.com');
    expect(email.subject).toContain('Finish creating your');
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: tokenFromEmail(email, 'reset-password'), password: 'Chosen1234' },
    });
    expect(reset.statusCode).toBe(200);
    const session = await login(app, 'rita@example.com', 'Chosen1234');
    const me = (await get(session, '/auth/me')).json<{ user: UserDTO }>().user;
    expect(me).toMatchObject({ id: guest.user.id, hasPassword: true });
  });
});

describe('reply emails', () => {
  it('emails the requester a sign-in link for public replies only', async () => {
    const agent = await signedInAs(app, 'AGENT');
    const guest = await submitAndConfirm({ name: 'Ed Email', email: 'ed@example.com' });
    const before = await app.prisma.devEmail.count({ where: { to: 'ed@example.com' } });

    await app.inject({
      method: 'POST',
      url: `/api/tickets/${guest.ticketId}/messages`,
      headers: agent.headers,
      payload: { body: 'Internal only', isInternal: true },
    });
    expect(await app.prisma.devEmail.count({ where: { to: 'ed@example.com' } })).toBe(before);

    await app.inject({
      method: 'POST',
      url: `/api/tickets/${guest.ticketId}/messages`,
      headers: agent.headers,
      payload: { body: 'We fixed the download button.' },
    });
    const email = await latestEmailTo(app.prisma, 'ed@example.com');
    expect(email.subject).toMatch(/^Re: \[#1001\]/);
    expect(email.text).toContain('We fixed the download button.');
    expect(email.text).toContain(`&ticket=${guest.ticketId}`);

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-login',
      payload: { token: tokenFromEmail(email, 'sign-in-link') },
    });
    expect(signIn.json<AuthResponse>().user.email).toBe('ed@example.com');
  });
});
