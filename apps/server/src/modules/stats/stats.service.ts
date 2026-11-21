import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  PERMISSIONS,
  type StatsOverviewDTO,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isStaff,
} from '@support-desk/shared';
import { ejsonDate, ejsonNumber, ejsonObjectId } from '../../lib/ejson';
import type { AuthUser } from '../../types';
import { can } from '../tickets/ticket.policy';

const DAY_MS = 24 * 60 * 60 * 1000;
const UNCATEGORIZED_COLOR = '#94a3b8';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const toMinutes = (ms: number | null) => (ms === null ? null : Math.round(ms / 60_000));

export class StatsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Dashboard numbers for the user's company. With "company-wide reports" the whole
   * company; otherwise agents see the tickets assigned to them and customers the tickets
   * they opened. Day buckets are calculated in UTC.
   */
  async overview(user: AuthUser, days: number): Promise<StatsOverviewDTO> {
    const organization = can(user, PERMISSIONS.REPORTS_VIEW);
    const personalField = isStaff(user.role) ? 'assigneeId' : 'customerId';
    const scope: Prisma.TicketWhereInput = {
      companyId: user.companyId,
      ...(organization ? {} : { [personalField]: user.id }),
    };
    const rawScope: Prisma.InputJsonObject = {
      companyId: ejsonObjectId(user.companyId),
      ...(organization ? {} : { [personalField]: ejsonObjectId(user.id) }),
    };
    const since = startOfUtcDay(new Date(Date.now() - (days - 1) * DAY_MS));
    const activeStatus = { in: [...ACTIVE_STATUSES] };

    const [
      total,
      active,
      unassigned,
      urgentActive,
      createdInPeriod,
      resolvedInPeriod,
      byStatusRows,
      byPriorityRows,
      byCategory,
      createdByDay,
      resolvedByDay,
      timing,
      agentWorkload,
    ] = await Promise.all([
      this.prisma.ticket.count({ where: scope }),
      this.prisma.ticket.count({ where: { ...scope, status: activeStatus } }),
      this.prisma.ticket.count({ where: { ...scope, status: activeStatus, assigneeId: null } }),
      this.prisma.ticket.count({ where: { ...scope, status: activeStatus, priority: 'URGENT' } }),
      this.prisma.ticket.count({ where: { ...scope, createdAt: { gte: since } } }),
      this.prisma.ticket.count({ where: { ...scope, resolvedAt: { gte: since } } }),
      this.prisma.ticket.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['priority'], where: scope, _count: { _all: true } }),
      this.countByCategory(scope),
      this.dailyCounts('createdAt', since, rawScope),
      this.dailyCounts('resolvedAt', since, rawScope),
      this.averageTimings(since, rawScope),
      organization ? this.agentWorkload(user.companyId, since) : Promise.resolve([]),
    ]);

    const statusCounts = new Map(byStatusRows.map((row) => [row.status, row._count._all]));
    const priorityCounts = new Map(byPriorityRows.map((row) => [row.priority, row._count._all]));

    const trend = Array.from({ length: days }, (_, index) => {
      const date = new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10);
      return {
        date,
        created: createdByDay.get(date) ?? 0,
        resolved: resolvedByDay.get(date) ?? 0,
      };
    });

    return {
      scope: organization ? 'organization' : 'personal',
      periodDays: days,
      totals: { total, active, unassigned, urgentActive, createdInPeriod, resolvedInPeriod },
      byStatus: TICKET_STATUSES.map((key) => ({ key, count: statusCounts.get(key) ?? 0 })),
      byPriority: TICKET_PRIORITIES.map((key) => ({ key, count: priorityCounts.get(key) ?? 0 })),
      byCategory,
      trend,
      avgFirstResponseMinutes: toMinutes(timing.firstResponseMs),
      avgResolutionMinutes: toMinutes(timing.resolutionMs),
      agentWorkload,
    };
  }

  private async countByCategory(scope: Prisma.TicketWhereInput) {
    const rows = await this.prisma.ticket.groupBy({
      by: ['categoryId'],
      where: scope,
      _count: { _all: true },
    });
    const ids = rows.map((row) => row.categoryId).filter((id): id is string => Boolean(id));
    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, color: true },
    });
    const byId = new Map(categories.map((category) => [category.id, category]));

    return rows
      .map((row) => {
        const category = row.categoryId ? byId.get(row.categoryId) : undefined;
        return {
          id: category?.id ?? null,
          name: category?.name ?? 'Uncategorized',
          color: category?.color ?? UNCATEGORIZED_COLOR,
          count: row._count._all,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /** Tickets per UTC day for a date field, using a native aggregation pipeline. */
  private async dailyCounts(
    field: 'createdAt' | 'resolvedAt',
    since: Date,
    rawScope: Prisma.InputJsonObject,
  ): Promise<Map<string, number>> {
    const rows = (await this.prisma.ticket.aggregateRaw({
      pipeline: [
        { $match: { ...rawScope, [field]: { $gte: ejsonDate(since) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}` } },
            count: { $sum: 1 },
          },
        },
      ],
    })) as unknown as { _id: string; count: unknown }[];

    return new Map(rows.map((row) => [row._id, ejsonNumber(row.count) ?? 0]));
  }

  /** Average time to first staff response and to resolution, for tickets opened in the period. */
  private async averageTimings(since: Date, rawScope: Prisma.InputJsonObject) {
    const averageOf = (field: string) => [
      { $match: { [field]: { $type: 'date' } } },
      { $group: { _id: null, avg: { $avg: { $subtract: [`$${field}`, '$createdAt'] } } } },
    ];

    const [result] = (await this.prisma.ticket.aggregateRaw({
      pipeline: [
        { $match: { ...rawScope, createdAt: { $gte: ejsonDate(since) } } },
        {
          $facet: {
            firstResponse: averageOf('firstResponseAt'),
            resolution: averageOf('resolvedAt'),
          },
        },
      ],
    })) as unknown as { firstResponse: { avg: unknown }[]; resolution: { avg: unknown }[] }[];

    return {
      firstResponseMs: ejsonNumber(result?.firstResponse[0]?.avg),
      resolutionMs: ejsonNumber(result?.resolution[0]?.avg),
    };
  }

  private async agentWorkload(companyId: string, since: Date) {
    const [activeRows, resolvedRows, staff] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { companyId, status: { in: [...ACTIVE_STATUSES] }, assigneeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { companyId, resolvedAt: { gte: since }, assigneeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { companyId, role: { in: ['OWNER', 'AGENT'] }, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const activeById = new Map(activeRows.map((row) => [row.assigneeId, row._count._all]));
    const resolvedById = new Map(resolvedRows.map((row) => [row.assigneeId, row._count._all]));

    return staff
      .map((member) => ({
        id: member.id,
        name: member.name,
        active: activeById.get(member.id) ?? 0,
        resolvedInPeriod: resolvedById.get(member.id) ?? 0,
      }))
      .sort((a, b) => b.active - a.active || b.resolvedInPeriod - a.resolvedInPeriod);
  }
}
