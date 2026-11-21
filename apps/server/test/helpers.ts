import type { Company, PrismaClient, Role } from '@prisma/client';
import { type AuthResponse, DEFAULT_GROUPS } from '@support-desk/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { refreshCookieName } from '../src/modules/auth/auth.routes';

export const PASSWORD = 'Passw0rd!';
export const DEFAULT_SLUG = 'acme';

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

let defaultCompany: Company | undefined;

/** The company most tests run in (created by `resetDatabase`). */
export function company(): Company {
  if (!defaultCompany) throw new Error('Call resetDatabase() before using company()');
  return defaultCompany;
}

/** Wipe every collection and recreate the default company. */
export async function resetDatabase(prisma: PrismaClient): Promise<Company> {
  await prisma.attachment.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userToken.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.permissionGroup.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.devEmail.deleteMany();
  await prisma.pendingSubmission.deleteMany();
  await prisma.company.deleteMany();
  defaultCompany = await createCompany(prisma, DEFAULT_SLUG, 'Acme Inc.');
  return defaultCompany;
}

/** Create a company with the default permission groups (Administrator, Agent, Read-only). */
export async function createCompany(prisma: PrismaClient, slug: string, name = slug) {
  const created = await prisma.company.create({ data: { slug, name } });
  await prisma.permissionGroup.createMany({
    data: DEFAULT_GROUPS.map((group) => ({
      companyId: created.id,
      name: group.name,
      description: group.description,
      permissions: [...group.permissions],
      isDefault: group.isDefault,
    })),
  });
  return created;
}

export async function findGroup(prisma: PrismaClient, companyId: string, name: string) {
  return prisma.permissionGroup.findUniqueOrThrow({
    where: { companyId_name: { companyId, name } },
  });
}

/**
 * `ADMIN` is test shorthand for an agent in the Administrator group; plain agents get the
 * Agent group unless another group is named.
 */
export type TestRole = Role | 'ADMIN';

let passwordHash: Promise<string> | undefined;

export async function createUser(
  prisma: PrismaClient,
  role: TestRole,
  overrides: {
    email?: string;
    name?: string;
    isActive?: boolean;
    verified?: boolean;
    companyId?: string;
    group?: string;
  } = {},
) {
  passwordHash ??= hashPassword(PASSWORD);
  const suffix = Math.random().toString(36).slice(2, 8);
  const companyId = overrides.companyId ?? company().id;
  const dbRole: Role = role === 'ADMIN' ? 'AGENT' : role;
  const groupName = overrides.group ?? (role === 'ADMIN' ? 'Administrator' : 'Agent');
  const groupId = dbRole === 'AGENT' ? (await findGroup(prisma, companyId, groupName)).id : null;
  return prisma.user.create({
    data: {
      companyId,
      name: overrides.name ?? `${role.toLowerCase()} ${suffix}`,
      email: overrides.email ?? `${role.toLowerCase()}-${suffix}@example.com`,
      role: dbRole,
      groupId,
      isActive: overrides.isActive ?? true,
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
      passwordHash: await passwordHash,
      lastLoginAt: null,
    },
  });
}

export interface Session {
  token: string;
  refreshCookie: string;
  cookieName: string;
  headers: { authorization: string };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
  companySlug = DEFAULT_SLUG,
): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { companySlug, email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed (${res.statusCode}): ${res.body}`);
  return sessionFrom(res.json<AuthResponse>(), res.cookies);
}

export function sessionFrom(body: AuthResponse, cookies: { name: string; value: string }[]) {
  const cookieName = refreshCookieName(body.company.id);
  return {
    token: body.accessToken,
    refreshCookie: cookies.find((c) => c.name === cookieName)?.value ?? '',
    cookieName,
    headers: { authorization: `Bearer ${body.accessToken}` },
  } satisfies Session;
}

/** Create a user with the given role (in the default company unless given) and sign in. */
export async function signedInAs(
  app: FastifyInstance,
  role: TestRole,
  inCompany?: Company,
  group?: string,
) {
  const target = inCompany ?? company();
  const user = await createUser(app.prisma, role, { companyId: target.id, group });
  return { user, ...(await login(app, user.email, PASSWORD, target.slug)) };
}

/** The newest email sent to an address (dev mailbox transport). */
export async function latestEmailTo(prisma: PrismaClient, to: string) {
  const email = await prisma.devEmail.findFirst({ where: { to }, orderBy: { createdAt: 'desc' } });
  if (!email) throw new Error(`No email sent to ${to}`);
  return email;
}

/** Extract the token from a link like …/verify-email?token=XYZ in an email. */
export function tokenFromEmail(email: { text: string }, path: string): string {
  const match = new RegExp(`/${path}\\?token=([\\w-]+)`).exec(email.text);
  if (!match?.[1]) throw new Error(`No ${path} link in email`);
  return match[1];
}

/** Encode a multipart/form-data payload for `app.inject`. */
export async function multipart(
  fields: Record<string, string>,
  files: { field?: string; name: string; content: string | Uint8Array; type?: string }[] = [],
): Promise<Pick<InjectOptions, 'payload' | 'headers'>> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    form.append(file.field ?? 'files', new Blob([file.content], { type: file.type }), file.name);
  }
  const encoded = new Response(form);
  return {
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type') ?? '' },
  };
}
