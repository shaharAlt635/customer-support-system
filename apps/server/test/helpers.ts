import type { PrismaClient, Role } from '@prisma/client';
import type { AuthResponse } from '@support-desk/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { REFRESH_COOKIE } from '../src/modules/auth/auth.routes';

export const PASSWORD = 'Passw0rd!';

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.attachment.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.counter.deleteMany();
}

let passwordHash: Promise<string> | undefined;

export async function createUser(
  prisma: PrismaClient,
  role: Role,
  overrides: { email?: string; name?: string; isActive?: boolean } = {},
) {
  passwordHash ??= hashPassword(PASSWORD);
  const suffix = Math.random().toString(36).slice(2, 8);
  return prisma.user.create({
    data: {
      name: overrides.name ?? `${role.toLowerCase()} ${suffix}`,
      email: overrides.email ?? `${role.toLowerCase()}-${suffix}@example.com`,
      role,
      isActive: overrides.isActive ?? true,
      passwordHash: await passwordHash,
      lastLoginAt: null,
    },
  });
}

export interface Session {
  token: string;
  refreshCookie: string;
  headers: { authorization: string };
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed (${res.statusCode}): ${res.body}`);
  const body = res.json<AuthResponse>();
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
  return {
    token: body.accessToken,
    refreshCookie: cookie?.value ?? '',
    headers: { authorization: `Bearer ${body.accessToken}` },
  } satisfies Session;
}

/** Create a user with the given role and sign them in. */
export async function signedInAs(app: FastifyInstance, role: Role) {
  const user = await createUser(app.prisma, role);
  return { user, ...(await login(app, user.email)) };
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
