import type { PrismaClient } from '@prisma/client';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  UserDTO,
} from '@support-desk/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import { Errors } from '../../lib/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashToken, newTokenFamily } from '../../lib/tokens';
import { toUserDTO, userSelect } from '../../serializers';
import type { AccessTokenPayload } from '../../types';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  user: UserDTO;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * A rotated refresh token presented again within this window is treated as a benign race
 * (two tabs refreshing at once) rather than token theft.
 */
const ROTATION_GRACE_MS = 30_000;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly signAccessToken: (payload: AccessTokenPayload) => string,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async register(input: RegisterInput, meta: SessionMeta): Promise<IssuedSession> {
    if (!this.config.ALLOW_REGISTRATION) {
      throw Errors.forbidden('Self-service registration is disabled', 'REGISTRATION_DISABLED');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing)
      throw Errors.conflict('An account with this email already exists', 'EMAIL_IN_USE');

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: 'CUSTOMER',
        lastLoginAt: new Date(),
      },
      select: userSelect,
    });

    return this.startSession(toUserDTO(user), meta);
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user) {
      await burnPasswordCheck(input.password);
      throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      throw Errors.forbidden(
        'This account has been deactivated. Contact an administrator.',
        'ACCOUNT_DISABLED',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: userSelect,
    });

    return this.startSession(toUserDTO(updated), meta);
  }

  /** Exchange a refresh token for a new access token, rotating the refresh token. */
  async refresh(rawToken: string | undefined, meta: SessionMeta): Promise<IssuedSession> {
    if (!rawToken) throw Errors.unauthorized('No active session', 'NO_SESSION');

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: userSelect } },
    });
    if (!record) throw Errors.unauthorized('Invalid session', 'INVALID_SESSION');

    const now = new Date();

    if (record.revokedAt) {
      if (now.getTime() - record.revokedAt.getTime() < ROTATION_GRACE_MS) {
        throw Errors.unauthorized('Session was refreshed elsewhere; retry', 'SESSION_ROTATED');
      }
      // A long-revoked token is being replayed: assume it was stolen and end the session.
      await this.revokeFamily(record.familyId, now);
      this.log.warn({ userId: record.userId }, 'Refresh token reuse detected; session revoked');
      throw Errors.unauthorized(
        'Session is no longer valid. Please sign in again.',
        'SESSION_REVOKED',
      );
    }
    if (record.expiresAt <= now) throw Errors.unauthorized('Session expired', 'SESSION_EXPIRED');
    if (!record.user.isActive) {
      await this.revokeFamily(record.familyId, now);
      throw Errors.unauthorized('This account has been deactivated', 'ACCOUNT_DISABLED');
    }

    // Conditional update so two concurrent refreshes cannot both rotate the same token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) {
      throw Errors.unauthorized('Session was refreshed elsewhere; retry', 'SESSION_ROTATED');
    }

    return this.startSession(toUserDTO(record.user), meta, record.familyId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId, new Date());
  }

  async getProfile(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw Errors.notFound('User');
    return toUserDTO(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserDTO> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
      select: userSelect,
    });
    return toUserDTO(user);
  }

  /** Change the password and sign out every other session. */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    currentRefreshToken: string | undefined,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw Errors.validation([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }

    const keepHash = currentRefreshToken ? hashToken(currentRefreshToken) : undefined;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepHash ? { tokenHash: { not: keepHash } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async startSession(
    user: UserDTO,
    meta: SessionMeta,
    familyId = newTokenFamily(),
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshTokenExpiresAt,
        revokedAt: null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    return {
      user,
      accessToken: this.signAccessToken({ sub: user.id, role: user.role }),
      expiresIn: this.config.ACCESS_TOKEN_TTL_MINUTES * 60,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
