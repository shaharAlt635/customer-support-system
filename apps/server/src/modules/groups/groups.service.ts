import type { PrismaClient } from '@prisma/client';
import type { GroupDTO, GroupInput, UpdateGroupInput } from '@support-desk/shared';
import { Errors } from '../../lib/errors';
import { toGroupDTO } from '../../serializers';

/** Permission groups of one company; every method is scoped by `companyId`. */
export class GroupService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(companyId: string): Promise<GroupDTO[]> {
    const [groups, counts] = await Promise.all([
      this.prisma.permissionGroup.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.user.groupBy({
        by: ['groupId'],
        where: { companyId, role: 'AGENT', groupId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const countById = new Map(counts.map((row) => [row.groupId, row._count._all]));
    return groups.map((group) => toGroupDTO(group, countById.get(group.id) ?? 0));
  }

  async create(companyId: string, input: GroupInput): Promise<GroupDTO> {
    await this.assertNameAvailable(companyId, input.name);
    const group = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.permissionGroup.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.permissionGroup.create({
        data: {
          companyId,
          name: input.name,
          description: input.description ?? null,
          permissions: [...new Set(input.permissions)],
          isDefault: input.isDefault ?? false,
        },
      });
    });
    return toGroupDTO(group);
  }

  /** Changes apply to every member immediately (permissions are read on each request). */
  async update(companyId: string, id: string, input: UpdateGroupInput): Promise<GroupDTO> {
    const existing = await this.findInCompany(companyId, id);
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameAvailable(companyId, input.name);
    }
    if (input.isDefault === false && existing.isDefault) {
      throw Errors.badRequest(
        'Choose another group as the default instead of unsetting it',
        'DEFAULT_GROUP_REQUIRED',
      );
    }

    const group = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault && !existing.isDefault) {
        await tx.permissionGroup.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.permissionGroup.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          permissions: input.permissions ? [...new Set(input.permissions)] : undefined,
          isDefault: input.isDefault,
        },
      });
    });
    const memberCount = await this.prisma.user.count({
      where: { companyId, role: 'AGENT', groupId: id },
    });
    return toGroupDTO(group, memberCount);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const group = await this.findInCompany(companyId, id);
    if (group.isDefault) {
      throw Errors.conflict(
        'This is the default group. Make another group the default first.',
        'DEFAULT_GROUP',
      );
    }
    const [members, invitations] = await Promise.all([
      this.prisma.user.count({ where: { companyId, role: 'AGENT', groupId: id } }),
      this.prisma.invitation.count({ where: { companyId, groupId: id, status: 'PENDING' } }),
    ]);
    if (members > 0 || invitations > 0) {
      throw Errors.conflict(
        `This group is used by ${members} agent(s) and ${invitations} pending invitation(s). Move them to another group first.`,
        'GROUP_IN_USE',
      );
    }
    await this.prisma.permissionGroup.delete({ where: { id } });
  }

  async findInCompany(companyId: string, id: string) {
    const group = await this.prisma.permissionGroup.findUnique({ where: { id } });
    if (!group || group.companyId !== companyId) throw Errors.notFound('Permission group');
    return group;
  }

  private async assertNameAvailable(companyId: string, name: string) {
    const groups = await this.prisma.permissionGroup.findMany({
      where: { companyId },
      select: { name: true },
    });
    if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      throw Errors.conflict('A group with this name already exists', 'GROUP_EXISTS');
    }
  }
}
