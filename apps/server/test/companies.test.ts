import type {
  AuthResponse,
  CategoryDTO,
  Paginated,
  TicketDetailDTO,
  UserDTO,
} from '@support-desk/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  createCompany,
  createTestApp,
  createUser,
  latestEmailTo,
  login,
  resetDatabase,
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

const signup = (payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/companies',
    payload: {
      companyName: 'Globex Corporation',
      slug: 'globex',
      name: 'Hank Scorpio',
      email: 'hank@globex.example',
      password: 'Volcano123',
      ...payload,
    },
  });

describe('company sign-up', () => {
  it('creates the company and an unverified owner, then activates on email confirmation', async () => {
    const res = await signup();
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      email: 'hank@globex.example',
      verificationRequired: true,
      company: { name: 'Globex Corporation', slug: 'globex' },
    });

    // Can't sign in before confirming the email.
    await expect(login(app, 'hank@globex.example', 'Volcano123', 'globex')).rejects.toThrow(
      /EMAIL_NOT_VERIFIED/,
    );

    const email = await latestEmailTo(app.prisma, 'hank@globex.example');
    expect(email.subject).toContain('Globex Corporation');
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: tokenFromEmail(email, 'verify-email') },
    });
    expect(verify.statusCode).toBe(200);
    const session = verify.json<AuthResponse>();
    expect(session.user).toMatchObject({ role: 'OWNER', emailVerified: true });
    expect(session.user.permissions).toContain('groups.manage');

    // The new company starts with default categories and is fully usable.
    const categories = await app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(categories.json<{ data: CategoryDTO[] }>().data.map((c) => c.name)).toEqual([
      'Billing',
      'General',
      'Technical Support',
    ]);
  });

  it('rejects taken and reserved addresses', async () => {
    const taken = await signup({ slug: 'acme' });
    expect(taken.statusCode).toBe(400);
    expect(taken.json().error.details).toEqual([
      { path: 'slug', message: 'This address is already taken' },
    ]);

    const reserved = await signup({ slug: 'signup' });
    expect(reserved.statusCode).toBe(400);

    const invalid = await signup({ slug: '-Bad Slug-' });
    expect(invalid.statusCode).toBe(400);
  });

  it('checks address availability for the sign-up form', async () => {
    const check = async (slug: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/companies/check-slug?slug=${encodeURIComponent(slug)}`,
        })
      ).json();

    expect(await check('Brand-New')).toMatchObject({ slug: 'brand-new', available: true });
    expect(await check('acme')).toMatchObject({ available: false });
    expect(await check('api')).toMatchObject({
      available: false,
      reason: 'This address is reserved',
    });
  });

  it('exposes public company info and 404s for unknown companies', async () => {
    const known = await app.inject({ method: 'GET', url: '/api/companies/acme' });
    expect(known.json()).toMatchObject({
      name: 'Acme Inc.',
      slug: 'acme',
      allowRegistration: true,
    });

    const unknown = await app.inject({ method: 'GET', url: '/api/companies/nope' });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('separate accounts per company', () => {
  it('lets the same email have independent accounts and passwords in two companies', async () => {
    const globex = await createCompany(app.prisma, 'globex', 'Globex');
    const email = 'sam@example.com';
    const acmeUser = await createUser(app.prisma, 'AGENT', { email });
    const globexUser = await createUser(app.prisma, 'CUSTOMER', { email, companyId: globex.id });
    await app.prisma.user.update({
      where: { id: globexUser.id },
      data: {
        passwordHash: (await app.prisma.user.findUniqueOrThrow({ where: { id: acmeUser.id } }))
          .passwordHash,
      },
    });

    const inAcme = await login(app, email, PASSWORD, 'acme');
    const inGlobex = await login(app, email, PASSWORD, 'globex');
    expect(inAcme.cookieName).not.toBe(inGlobex.cookieName);

    const meAcme = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: inAcme.headers,
    });
    const meGlobex = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: inGlobex.headers,
    });
    expect(meAcme.json().user).toMatchObject({ id: acmeUser.id, role: 'AGENT' });
    expect(meGlobex.json().user).toMatchObject({ id: globexUser.id, role: 'CUSTOMER' });

    // Changing the password in one company leaves the other account alone.
    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: inAcme.headers,
      payload: { currentPassword: PASSWORD, newPassword: 'OnlyAcme123' },
    });
    await expect(login(app, email, PASSWORD, 'globex')).resolves.toBeDefined();
    await expect(login(app, email, PASSWORD, 'acme')).rejects.toThrow();
  });

  it('keeps refresh cookies separate so a browser can stay signed in to both', async () => {
    const globex = await createCompany(app.prisma, 'globex', 'Globex');
    const a = await signedInAs(app, 'CUSTOMER');
    const g = await signedInAs(app, 'CUSTOMER', globex);

    const refreshGlobex = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { companySlug: 'globex' },
      cookies: { [a.cookieName]: a.refreshCookie, [g.cookieName]: g.refreshCookie },
    });
    expect(refreshGlobex.statusCode).toBe(200);
    expect(refreshGlobex.json<AuthResponse>().company.slug).toBe('globex');

    // An Acme cookie can't be used to open a Globex session.
    const crossed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { companySlug: 'globex' },
      cookies: { [g.cookieName]: a.refreshCookie },
    });
    expect(crossed.statusCode).toBe(401);
  });
});

describe('tenant isolation', () => {
  it('never exposes another company’s tickets, users, categories or stats', async () => {
    const globex = await createCompany(app.prisma, 'globex', 'Globex');
    const acmeAdmin = await signedInAs(app, 'ADMIN');
    const acmeCustomer = await signedInAs(app, 'CUSTOMER');
    const globexAdmin = await signedInAs(app, 'ADMIN', globex);

    const created = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: acmeCustomer.headers,
      payload: { subject: 'Acme-only problem', description: 'Only Acme should see this ticket.' },
    });
    const ticket = created.json<TicketDetailDTO>();

    const read = (path: string, actor = globexAdmin) =>
      app.inject({ method: 'GET', url: `/api${path}`, headers: actor.headers });

    expect((await read(`/tickets/${ticket.id}`)).statusCode).toBe(404);
    expect((await read('/tickets')).json().meta.total).toBe(0);
    expect((await read('/stats/overview')).json().totals.total).toBe(0);
    expect((await read('/team/members')).json<{ data: UserDTO[] }>().data.map((u) => u.id)).toEqual(
      [globexAdmin.user.id],
    );
    expect((await read('/customers')).json<Paginated<UserDTO>>().meta.total).toBe(0);

    // Acme's admin can't touch Globex accounts, and vice versa.
    const removeForeignAgent = await app.inject({
      method: 'DELETE',
      url: `/api/team/members/${acmeAdmin.user.id}`,
      headers: globexAdmin.headers,
    });
    expect(removeForeignAgent.statusCode).toBe(404);
    const deactivateForeignCustomer = await app.inject({
      method: 'PATCH',
      url: `/api/customers/${acmeCustomer.user.id}`,
      headers: globexAdmin.headers,
      payload: { isActive: false },
    });
    expect(deactivateForeignCustomer.statusCode).toBe(404);

    // Assigning to someone from another company is rejected.
    const assign = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticket.id}`,
      headers: acmeAdmin.headers,
      payload: { assigneeId: globexAdmin.user.id },
    });
    expect(assign.statusCode).toBe(400);

    // Categories from another company can't be used.
    const globexCategory = await app.prisma.category.create({
      data: { companyId: globex.id, name: 'Globex only', color: '#000000' },
    });
    const useForeignCategory = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: acmeCustomer.headers,
      payload: {
        subject: 'Using a foreign category',
        description: 'This should be rejected by the API.',
        categoryId: globexCategory.id,
      },
    });
    expect(useForeignCategory.statusCode).toBe(400);
  });

  it('numbers tickets independently per company', async () => {
    const globex = await createCompany(app.prisma, 'globex', 'Globex');
    const acme = await signedInAs(app, 'CUSTOMER');
    const glob = await signedInAs(app, 'CUSTOMER', globex);
    const create = (actor: typeof acme) =>
      app.inject({
        method: 'POST',
        url: '/api/tickets',
        headers: actor.headers,
        payload: { subject: 'Numbering check', description: 'Checking ticket numbers.' },
      });

    expect((await create(acme)).json().number).toBe(1001);
    expect((await create(acme)).json().number).toBe(1002);
    expect((await create(glob)).json().number).toBe(1001);
  });

  it('rejects an access token whose user moved to a different company', async () => {
    const user = await signedInAs(app, 'AGENT');
    const globex = await createCompany(app.prisma, 'globex', 'Globex');
    await app.prisma.user.update({ where: { id: user.user.id }, data: { companyId: globex.id } });

    const res = await app.inject({ method: 'GET', url: '/api/tickets', headers: user.headers });
    expect(res.statusCode).toBe(401);
  });
});
