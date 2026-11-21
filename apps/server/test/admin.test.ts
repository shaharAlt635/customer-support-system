import type { CategoryDTO } from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, signedInAs } from './helpers';

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

beforeEach(async () => {
  await resetDatabase(app.prisma);
  [admin, agent, customer] = await Promise.all([
    signedInAs(app, 'ADMIN'),
    signedInAs(app, 'AGENT'),
    signedInAs(app, 'CUSTOMER'),
  ]);
});

describe('categories', () => {
  const create = (actor: Actor, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/categories', headers: actor.headers, payload });

  it('lets admins manage categories and everyone read active ones', async () => {
    expect((await create(agent, { name: 'Billing', color: '#22c55e' })).statusCode).toBe(403);

    const billing = await create(admin, { name: 'Billing', color: '#22c55e' });
    expect(billing.statusCode).toBe(201);
    const archived = await create(admin, { name: 'Archived', color: '#64748b', isActive: false });
    expect(archived.statusCode).toBe(201);

    const duplicate = await create(admin, { name: 'billing', color: '#000000' });
    expect(duplicate.statusCode).toBe(409);

    const forCustomer = await app.inject({
      method: 'GET',
      url: '/api/categories?includeInactive=true',
      headers: customer.headers,
    });
    expect(forCustomer.json<{ data: CategoryDTO[] }>().data.map((c) => c.name)).toEqual([
      'Billing',
    ]);

    const forAdmin = await app.inject({
      method: 'GET',
      url: '/api/categories?includeInactive=true',
      headers: admin.headers,
    });
    expect(forAdmin.json<{ data: CategoryDTO[] }>().data).toHaveLength(2);
  });

  it('refuses to delete categories that are in use', async () => {
    const category = (await create(admin, { name: 'Bugs', color: '#ef4444' })).json<CategoryDTO>();
    await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: customer.headers,
      payload: {
        subject: 'Button does nothing',
        description: 'Clicking save does nothing at all.',
        categoryId: category.id,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${category.id}`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CATEGORY_IN_USE');
  });
});

describe('system endpoints', () => {
  it('reports health and public config', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ status: 'ok', database: 'up' });

    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.json()).toMatchObject({
      allowRegistration: true,
      uploads: { maxFiles: 3, maxFileSizeBytes: 1024 * 1024 },
    });
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
