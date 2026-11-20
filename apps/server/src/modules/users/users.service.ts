import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  type CreateUserInput,
  type Paginated,
  type UpdateUserInput,
  type UserDTO,
  type UserSummaryDTO,
  isStaff,
  type userListQuerySchema,
} from '@support-desk/shared';
import type { z } from 'zod';
import { Errors } from '../../lib/errors';
import { paginated, paginationArgs } from '../../lib/pagination';
import { hashPassword } from '../../lib/password';
import { containsInsensitive } from '../../lib/search';
import { toUserDTO, toUserSummaryDTO, userSelect, userSummarySelect } from '../../serializers';
import type { AuthUser } from '../../types';

type ParsedUserListQuery = z.output<typeof userListQuerySchema>;

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: ParsedUserListQuery): Promise<Paginated<UserDTO>> {
    const { q, role, status, page, pageSize } = query;
    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}),
      ...(status ? { isActive: status === 'active' } : {}),
      ...(q
        ? {
            OR: [{ name: containsInsensitive(q) }, { email: containsInsensitive(q) }],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paginationArgs(page, pageSize),
      }),
    ]);
    return paginated(users.map(toUserDTO), total, page, pageSize);
  }

  /** Active staff members tickets can be assigned to. */
  async listAssignable(): Promise<UserSummaryDTO[]> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'AGENT'] }, isActive: true },
      select: userSummarySelect,
      orderBy: { name: 'asc' },
    });
    return users.map(toUserSummaryDTO);
  }

  async create(input: CreateUserInput): Promise<UserDTO> {
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
        role: input.role,
        passwordHash: await hashPassword(input.password),
        lastLoginAt: null,
      },
      select: userSelect,
    });
    return toUserDTO(user);
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput): Promise<UserDTO> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw Errors.notFound('User');

    if (actor.id === id) {
      if (input.role && input.role !== target.role) {
        throw Errors.badRequest('You cannot change your own role', 'SELF_ROLE_CHANGE');
      }
      if (input.isActive === false) {
        throw Errors.badRequest('You cannot deactivate your own account', 'SELF_DEACTIVATION');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.role !== undefined) data.role = input.role;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);

    const deactivated = input.isActive === false && target.isActive;
    const losesStaffAccess =
      isStaff(target.role) && input.role !== undefined && !isStaff(input.role);
    const now = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data, select: userSelect });

      // Sign the user out everywhere when access is removed or the password is reset.
      if (deactivated || input.password !== undefined || input.role !== undefined) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      // Return their open work to the queue so nothing gets stuck on an inactive agent.
      if (deactivated || losesStaffAccess) {
        await tx.ticket.updateMany({
          where: { assigneeId: id, status: { in: [...ACTIVE_STATUSES] } },
          data: { assigneeId: null },
        });
      }
      return updated;
    });

    return toUserDTO(user);
  }
}
