import type { Prisma, PrismaClient } from '@prisma/client';
import type { Paginated, UserDTO, customerListQuerySchema } from '@support-desk/shared';
import type { z } from 'zod';
import { Errors } from '../../lib/errors';
import { paginated, paginationArgs } from '../../lib/pagination';
import { containsInsensitive } from '../../lib/search';
import { toUserDTO, userSelect } from '../../serializers';

type CustomerListQuery = z.output<typeof customerListQuerySchema>;

/** A company's customer accounts. */
export class CustomerService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(companyId: string, query: CustomerListQuery): Promise<Paginated<UserDTO>> {
    const { q, status, page, pageSize } = query;
    const where: Prisma.UserWhereInput = {
      companyId,
      role: 'CUSTOMER',
      ...(status ? { isActive: status === 'active' } : {}),
      ...(q ? { OR: [{ name: containsInsensitive(q) }, { email: containsInsensitive(q) }] } : {}),
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

  /** Deactivated customers can't sign in, and their sessions end immediately. */
  async setActive(companyId: string, id: string, isActive: boolean): Promise<UserDTO> {
    const customer = await this.prisma.user.findUnique({ where: { id } });
    if (!customer || customer.companyId !== companyId || customer.role !== 'CUSTOMER') {
      throw Errors.notFound('Customer');
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { isActive }, select: userSelect }),
      ...(isActive
        ? []
        : [
            this.prisma.refreshToken.updateMany({
              where: { userId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]),
    ]);
    return toUserDTO(updated);
  }
}
