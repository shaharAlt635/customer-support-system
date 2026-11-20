import type { PrismaClient } from '@prisma/client';
import type { CategoryDTO, CategoryInput, UpdateCategoryInput } from '@support-desk/shared';
import { Errors } from '../../lib/errors';
import { toCategoryDTO } from '../../serializers';

export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(includeInactive: boolean): Promise<CategoryDTO[]> {
    const [categories, counts] = await Promise.all([
      this.prisma.category.findMany({
        where: includeInactive ? undefined : { isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ticket.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
      }),
    ]);

    const countById = new Map(counts.map((row) => [row.categoryId, row._count._all]));
    return categories.map((category) => toCategoryDTO(category, countById.get(category.id) ?? 0));
  }

  async create(input: CategoryInput): Promise<CategoryDTO> {
    await this.assertNameAvailable(input.name);
    const category = await this.prisma.category.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        color: input.color,
        isActive: input.isActive ?? true,
      },
    });
    return toCategoryDTO(category);
  }

  async update(id: string, input: UpdateCategoryInput): Promise<CategoryDTO> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Category');
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameAvailable(input.name);
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
      this.prisma.ticket.count({ where: { categoryId: id } }),
    ]);
    return toCategoryDTO(category, ticketCount);
  }

  /** Categories in use are kept for reporting history; deactivate them instead. */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Category');

    const ticketCount = await this.prisma.ticket.count({ where: { categoryId: id } });
    if (ticketCount > 0) {
      throw Errors.conflict(
        `This category is used by ${ticketCount} ticket(s). Deactivate it instead of deleting it.`,
        'CATEGORY_IN_USE',
      );
    }
    await this.prisma.category.delete({ where: { id } });
  }

  /** Case-insensitive uniqueness check (the category list is small, so compare in memory). */
  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.prisma.category.findMany({ select: { name: true } });
    const wanted = name.toLowerCase();
    if (existing.some((category) => category.name.toLowerCase() === wanted)) {
      throw Errors.conflict('A category with this name already exists', 'CATEGORY_EXISTS');
    }
  }
}
