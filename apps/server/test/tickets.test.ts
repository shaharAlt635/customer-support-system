import type {
  MessageDTO,
  Paginated,
  StatsOverviewDTO,
  TicketDetailDTO,
  TicketSummaryDTO,
} from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { company, createTestApp, multipart, resetDatabase, signedInAs } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

type Actor = Awaited<ReturnType<typeof signedInAs>>;
let admin: Actor;
let agent: Actor;
let customer: Actor;
let otherCustomer: Actor;

beforeEach(async () => {
  await resetDatabase(app.prisma);
  [admin, agent, customer, otherCustomer] = await Promise.all([
    signedInAs(app, 'ADMIN'),
    signedInAs(app, 'AGENT'),
    signedInAs(app, 'CUSTOMER'),
    signedInAs(app, 'CUSTOMER'),
  ]);
});

async function createTicket(actor: Actor, payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tickets',
    headers: actor.headers,
    payload: {
      subject: 'Cannot access my invoices',
      description: 'The billing page shows a blank screen since this morning.',
      ...payload,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<TicketDetailDTO>();
}

const getTicket = (actor: Actor, id: string) =>
  app.inject({ method: 'GET', url: `/api/tickets/${id}`, headers: actor.headers });

const listTickets = async (actor: Actor, query = '') => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/tickets${query}`,
    headers: actor.headers,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Paginated<TicketSummaryDTO>>();
};

const reply = (actor: Actor, id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/tickets/${id}/messages`,
    headers: actor.headers,
    payload,
  });

const patch = (actor: Actor, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/tickets/${id}`, headers: actor.headers, payload });

describe('ticket creation', () => {
  it('assigns sequential numbers and records a CREATED event', async () => {
    const first = await createTicket(customer);
    const second = await createTicket(customer, { priority: 'HIGH' });

    expect(first.number).toBe(1001);
    expect(second.number).toBe(1002);
    expect(first).toMatchObject({ status: 'OPEN', priority: 'MEDIUM', assignee: null });
    expect(second.priority).toBe('HIGH');
    expect(first.events.map((e) => e.type)).toEqual(['CREATED']);
  });

  it('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: customer.headers,
      payload: { subject: 'Hi', description: 'short', priority: 'CRITICAL' },
    });
    expect(res.statusCode).toBe(400);
    expect(
      res
        .json()
        .error.details.map((d: { path: string }) => d.path)
        .sort(),
    ).toEqual(['description', 'priority', 'subject']);
  });

  it('rejects inactive categories', async () => {
    const category = await app.prisma.category.create({
      data: { companyId: company().id, name: 'Legacy', color: '#000000', isActive: false },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: customer.headers,
      payload: {
        subject: 'Question about legacy plan',
        description: 'Is the legacy plan still supported?',
        categoryId: category.id,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('access control', () => {
  it('customers only see their own tickets', async () => {
    const mine = await createTicket(customer);
    const theirs = await createTicket(otherCustomer);

    const list = await listTickets(customer);
    expect(list.data.map((t) => t.id)).toEqual([mine.id]);

    expect((await getTicket(customer, theirs.id)).statusCode).toBe(404);
    expect((await reply(customer, theirs.id, { body: 'Let me in' })).statusCode).toBe(404);
  });

  it('staff can see every ticket', async () => {
    await createTicket(customer);
    await createTicket(otherCustomer);
    expect((await listTickets(agent)).meta.total).toBe(2);
  });

  it('returns 404 for malformed ids', async () => {
    expect((await getTicket(agent, 'not-an-id')).statusCode).toBe(404);
  });

  it('customers cannot change priority, assignee or arbitrary statuses', async () => {
    const ticket = await createTicket(customer);
    expect((await patch(customer, ticket.id, { priority: 'URGENT' })).statusCode).toBe(403);
    expect((await patch(customer, ticket.id, { assigneeId: agent.user.id })).statusCode).toBe(403);
    expect((await patch(customer, ticket.id, { status: 'RESOLVED' })).statusCode).toBe(403);
  });

  it('customers can close and reopen their own tickets', async () => {
    const ticket = await createTicket(customer);
    const closed = await patch(customer, ticket.id, { status: 'CLOSED' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<TicketDetailDTO>().closedAt).not.toBeNull();

    const reopened = await patch(customer, ticket.id, { status: 'OPEN' });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json<TicketDetailDTO>()).toMatchObject({ status: 'OPEN', closedAt: null });
  });

  it('only admins can delete tickets', async () => {
    const ticket = await createTicket(customer);
    const asAgent = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticket.id}`,
      headers: agent.headers,
    });
    expect(asAgent.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticket.id}`,
      headers: admin.headers,
    });
    expect(asAdmin.statusCode).toBe(204);
    expect((await getTicket(admin, ticket.id)).statusCode).toBe(404);
  });
});

describe('conversation', () => {
  it('hides internal notes from customers', async () => {
    const ticket = await createTicket(customer);
    expect((await reply(agent, ticket.id, { body: 'Public answer' })).statusCode).toBe(201);
    expect(
      (await reply(agent, ticket.id, { body: 'Customer is on legacy plan', isInternal: true }))
        .statusCode,
    ).toBe(201);

    const staffView = (await getTicket(agent, ticket.id)).json<TicketDetailDTO>();
    const customerView = (await getTicket(customer, ticket.id)).json<TicketDetailDTO>();

    expect(staffView.messages).toHaveLength(2);
    expect(customerView.messages.map((m) => m.body)).toEqual(['Public answer']);
    expect((await listTickets(customer)).data[0]?.messageCount).toBe(1);
    expect((await listTickets(agent)).data[0]?.messageCount).toBe(2);
  });

  it('customers cannot write internal notes', async () => {
    const ticket = await createTicket(customer);
    const res = await reply(customer, ticket.id, { body: 'Sneaky', isInternal: true });
    expect(res.statusCode).toBe(403);
  });

  it('tracks first response time and status transitions', async () => {
    const ticket = await createTicket(customer);

    // Internal notes do not count as a first response.
    await reply(agent, ticket.id, { body: 'Looking into it', isInternal: true });
    expect((await getTicket(agent, ticket.id)).json<TicketDetailDTO>().firstResponseAt).toBeNull();

    // Staff reply + status change in one action.
    const res = await reply(agent, ticket.id, {
      body: 'Could you send a screenshot?',
      status: 'WAITING_ON_CUSTOMER',
    });
    expect(res.statusCode).toBe(201);
    let detail = (await getTicket(agent, ticket.id)).json<TicketDetailDTO>();
    expect(detail.status).toBe('WAITING_ON_CUSTOMER');
    expect(detail.firstResponseAt).not.toBeNull();

    // A customer reply moves it back to the queue.
    await reply(customer, ticket.id, { body: 'Here you go' });
    detail = (await getTicket(agent, ticket.id)).json<TicketDetailDTO>();
    expect(detail.status).toBe('OPEN');
    expect(detail.events.filter((e) => e.type === 'STATUS_CHANGED')).toHaveLength(2);
  });

  it('blocks replies on closed tickets until they are reopened', async () => {
    const ticket = await createTicket(customer);
    await patch(agent, ticket.id, { status: 'CLOSED' });

    const res = await reply(customer, ticket.id, { body: 'One more thing' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TICKET_CLOSED');

    const staffReopen = await reply(agent, ticket.id, { body: 'Reopening', status: 'IN_PROGRESS' });
    expect(staffReopen.statusCode).toBe(201);
  });
});

describe('assignment and triage', () => {
  it('assigns to staff, records events and filters by assignee', async () => {
    const ticket = await createTicket(customer);
    await createTicket(customer);

    const res = await patch(agent, ticket.id, {
      assigneeId: agent.user.id,
      priority: 'URGENT',
      status: 'IN_PROGRESS',
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<TicketDetailDTO>();
    expect(updated.assignee?.id).toBe(agent.user.id);
    expect(updated.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['ASSIGNEE_CHANGED', 'PRIORITY_CHANGED', 'STATUS_CHANGED']),
    );

    expect((await listTickets(agent, '?assigneeId=me')).data.map((t) => t.id)).toEqual([ticket.id]);
    expect((await listTickets(agent, '?assigneeId=unassigned')).meta.total).toBe(1);
  });

  it('refuses to assign tickets to customers', async () => {
    const ticket = await createTicket(customer);
    const res = await patch(agent, ticket.id, { assigneeId: otherCustomer.user.id });
    expect(res.statusCode).toBe(400);
  });

  it('records category changes with readable names', async () => {
    const category = await app.prisma.category.create({
      data: { companyId: company().id, name: 'Billing', color: '#22c55e' },
    });
    const ticket = await createTicket(customer);
    const res = await patch(agent, ticket.id, { categoryId: category.id });
    const event = res.json<TicketDetailDTO>().events.find((e) => e.type === 'CATEGORY_CHANGED');
    expect(event).toMatchObject({ fromValue: null, toValue: 'Billing' });
  });
});

describe('search and filtering', () => {
  it('filters by status and priority and searches text, numbers and customers', async () => {
    const a = await createTicket(customer, {
      subject: 'Password reset email never arrives',
      priority: 'HIGH',
    });
    const b = await createTicket(customer, {
      subject: 'Feature request: dark mode',
      priority: 'LOW',
    });
    await patch(agent, b.id, { status: 'RESOLVED' });

    expect((await listTickets(agent, '?status=OPEN')).data.map((t) => t.id)).toEqual([a.id]);
    expect((await listTickets(agent, '?status=OPEN,RESOLVED')).meta.total).toBe(2);
    expect((await listTickets(agent, '?priority=LOW')).data.map((t) => t.id)).toEqual([b.id]);
    expect((await listTickets(agent, '?q=dark%20MODE')).data.map((t) => t.id)).toEqual([b.id]);
    expect((await listTickets(agent, `?q=%23${a.number}`)).data.map((t) => t.id)).toEqual([a.id]);
    expect(
      (await listTickets(agent, `?q=${encodeURIComponent(customer.user.email)}`)).meta.total,
    ).toBe(2);
    // Regex metacharacters are treated literally.
    expect((await listTickets(agent, '?q=(%5B')).meta.total).toBe(0);
  });

  it('sorts by priority and paginates', async () => {
    await createTicket(customer, { priority: 'LOW' });
    await createTicket(customer, { priority: 'URGENT' });
    await createTicket(customer, { priority: 'MEDIUM' });

    const sorted = await listTickets(agent, '?sort=priority');
    expect(sorted.data.map((t) => t.priority)).toEqual(['URGENT', 'MEDIUM', 'LOW']);

    const page = await listTickets(agent, '?sort=priority&pageSize=2&page=2');
    expect(page.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.data.map((t) => t.priority)).toEqual(['LOW']);
  });

  it('rejects invalid filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tickets?status=BOGUS',
      headers: agent.headers,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('attachments', () => {
  it('uploads files with a ticket and downloads them with access checks', async () => {
    const form = await multipart(
      {
        subject: 'Error when exporting',
        description: 'Export fails with the attached log.',
        priority: 'HIGH',
      },
      [{ name: 'error.log', content: 'stack trace here', type: 'text/plain' }],
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { ...customer.headers, ...form.headers },
      payload: form.payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    const ticket = res.json<TicketDetailDTO>();
    expect(ticket.priority).toBe('HIGH');
    expect(ticket.attachments).toHaveLength(1);
    const attachment = ticket.attachments[0]!;
    expect(attachment).toMatchObject({ fileName: 'error.log', mimeType: 'text/plain', size: 16 });

    const download = (actor: Actor) =>
      app.inject({
        method: 'GET',
        url: `/api/attachments/${attachment.id}/download`,
        headers: actor.headers,
      });

    const own = await download(customer);
    expect(own.statusCode).toBe(200);
    expect(own.body).toBe('stack trace here');
    expect(own.headers['content-disposition']).toContain('attachment;');
    expect(own.headers['x-content-type-options']).toBe('nosniff');

    expect((await download(agent)).statusCode).toBe(200);
    expect((await download(otherCustomer)).statusCode).toBe(404);
  });

  it('keeps attachments on internal notes private', async () => {
    const ticket = await createTicket(customer);
    const form = await multipart({ body: 'Internal log', isInternal: 'true' }, [
      { name: 'debug.txt', content: 'secret', type: 'text/plain' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: { ...agent.headers, ...form.headers },
      payload: form.payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    const message = res.json<MessageDTO>();
    expect(message.isInternal).toBe(true);

    const attachmentId = message.attachments[0]!.id;
    const asCustomer = await app.inject({
      method: 'GET',
      url: `/api/attachments/${attachmentId}/download`,
      headers: customer.headers,
    });
    expect(asCustomer.statusCode).toBe(404);
  });

  it('rejects disallowed file types and oversized files without storing them', async () => {
    const ticket = await createTicket(customer);

    const exe = await multipart({ body: 'See attached' }, [
      { name: 'setup.exe', content: 'MZ', type: 'application/octet-stream' },
    ]);
    const exeRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: { ...customer.headers, ...exe.headers },
      payload: exe.payload,
    });
    expect(exeRes.statusCode).toBe(415);

    const big = await multipart({ body: 'Huge file' }, [
      { name: 'big.txt', content: new Uint8Array(1024 * 1024 + 10), type: 'text/plain' },
    ]);
    const bigRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/messages`,
      headers: { ...customer.headers, ...big.headers },
      payload: big.payload,
    });
    expect(bigRes.statusCode).toBe(413);

    expect(await app.prisma.attachment.count()).toBe(0);
    expect(await app.prisma.message.count()).toBe(0);
  });

  it('cleans up uploaded files when validation fails', async () => {
    const form = await multipart({ subject: 'x', description: 'y' }, [
      { name: 'notes.txt', content: 'hello', type: 'text/plain' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { ...customer.headers, ...form.headers },
      payload: form.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(await app.prisma.attachment.count()).toBe(0);
  });
});

describe('statistics', () => {
  it('reports organisation-wide numbers to staff and personal numbers to customers', async () => {
    const t1 = await createTicket(customer, { priority: 'URGENT' });
    await createTicket(customer);
    await createTicket(otherCustomer);
    await reply(agent, t1.id, { body: 'On it', status: 'RESOLVED' });

    const staffRes = await app.inject({
      method: 'GET',
      url: '/api/stats/overview?days=7',
      headers: agent.headers,
    });
    expect(staffRes.statusCode, staffRes.body).toBe(200);
    const staff = staffRes.json<StatsOverviewDTO>();
    expect(staff.scope).toBe('organization');
    expect(staff.totals).toMatchObject({
      total: 3,
      active: 2,
      unassigned: 2,
      createdInPeriod: 3,
      resolvedInPeriod: 1,
    });
    expect(staff.trend).toHaveLength(7);
    expect(staff.trend.at(-1)).toMatchObject({ created: 3, resolved: 1 });
    expect(staff.byStatus.find((s) => s.key === 'RESOLVED')?.count).toBe(1);
    expect(staff.avgFirstResponseMinutes).toBe(0);
    expect(staff.avgResolutionMinutes).toBe(0);
    expect(staff.agentWorkload.map((a) => a.id)).toEqual(
      expect.arrayContaining([agent.user.id, admin.user.id]),
    );

    const mine = (
      await app.inject({ method: 'GET', url: '/api/stats/overview', headers: customer.headers })
    ).json<StatsOverviewDTO>();
    expect(mine.scope).toBe('personal');
    expect(mine.totals.total).toBe(2);
    expect(mine.agentWorkload).toEqual([]);
  });
});
