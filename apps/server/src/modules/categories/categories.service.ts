import type { PrismaClient } from '@prisma/client';
import type { CategoryDTO, CategoryInput, UpdateCategoryInput } from '@support-desk/shared';
import { Errors } from '../../lib/errors';
import { toCategoryDTO } from '../../serializers';

/** Categories belong to a company; every method is scoped by `companyId`. */
export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(companyId: string, includeInactive: boolean): Promise<CategoryDTO[]> {
    const [categories, counts] = await Promise.all([
      this.prisma.category.findMany({
        where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ticket.groupBy({
        by: ['categoryId'],
        where: { companyId },
        _count: { _all: true },
      }),
    ]);

    const countById = new Map(counts.map((row) => [row.categoryId, row._count._all]));
    return categories.map((category) => toCategoryDTO(category, countById.get(category.id) ?? 0));
  }

  async create(companyId: string, input: CategoryInput): Promise<CategoryDTO> {
    await this.assertNameAvailable(companyId, input.name);
    const category = await this.prisma.category.create({
      data: {
        companyId,
        name: input.name,
        description: input.description ?? null,
        color: input.color,
        isActive: input.isActive ?? true,
      },
    });
    return toCategoryDTO(category);
  }

  async update(companyId: string, id: string, input: UpdateCategoryInput): Promise<CategoryDTO> {
    const existing = await this.findInCompany(companyId, id);
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameAvailable(companyId, input.name);
    }

    const [category, ticketCount] = await Promise.all([
      this.prisma.category.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          color: input.color,
          isActive: input.isActive,
        },
      }),
      this.prisma.ticket.count({ where: { companyId, categoryId: id } }),
    ]);
    return toCategoryDTO(category, ticketCount);
  }

  /** Categories in use are kept for reporting history; deactivate them instead. */
  async remove(companyId: string, id: string): Promise<void> {
    await this.findInCompany(companyId, id);
    const ticketCount = await this.prisma.ticket.count({ where: { companyId, categoryId: id } });
    if (ticketCount > 0) {
      throw Errors.conflict(
        `This category is used by ${ticketCount} ticket(s). Deactivate it instead of deleting it.`,
        'CATEGORY_IN_USE',
      );
    }
    await this.prisma.category.delete({ where: { id } });
  }

  private async findInCompany(companyId: string, id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || category.companyId !== companyId) throw Errors.notFound('Category');
    return category;
  }

  /** Case-insensitive uniqueness within the company (category lists are small). */
  private async assertNameAvailable(companyId: string, name: string): Promise<void> {
    const existing = await this.prisma.category.findMany({
      where: { companyId },
      select: { name: true },
    });
    const wanted = name.toLowerCase();
    if (existing.some((category) => category.name.toLowerCase() === wanted)) {
      throw Errors.conflict('A category with this name already exists', 'CATEGORY_EXISTS');
    }
  }
}
