import type { Prisma, PrismaClient, Ticket, TicketEventType } from '@prisma/client';
import {
  type CreateMessageInput,
  type CreateTicketInput,
  type MessageDTO,
  PERMISSIONS,
  PRIORITY_RANK,
  type Paginated,
  type TicketDetailDTO,
  type TicketListQuery,
  type TicketSort,
  type TicketStatus,
  type TicketSummaryDTO,
  type UpdateTicketInput,
  customerCanSetStatus,
  hasPermission,
  isStaff,
} from '@support-desk/shared';
import { Errors } from '../../lib/errors';
import type { StoredFile } from '../../lib/multipart';
import { paginated, paginationArgs } from '../../lib/pagination';
import { containsInsensitive } from '../../lib/search';
import {
  messageInclude,
  ticketDetailInclude,
  ticketSummaryInclude,
  toMessageDTO,
  toTicketDetailDTO,
  toTicketSummaryDTO,
} from '../../serializers';
import type { FileStorage } from '../../storage/file-storage';
import type { AuthUser } from '../../types';
import { nextTicketNumber } from './ticket-number';
import { canSeeInternal, canViewTicket } from './ticket.policy';

interface EventDraft {
  type: TicketEventType;
  fromValue: string | null;
  toValue: string | null;
}

const TICKET_ORDER: Record<TicketSort, Prisma.TicketOrderByWithRelationInput[]> = {
  updated: [{ lastActivityAt: 'desc' }, { number: 'desc' }],
  newest: [{ createdAt: 'desc' }, { number: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { number: 'asc' }],
  priority: [{ priorityRank: 'desc' }, { createdAt: 'asc' }],
};

/** Keep resolution/closure timestamps consistent with the status. */
function statusChangeData(
  ticket: Pick<Ticket, 'resolvedAt'>,
  next: TicketStatus,
  now: Date,
): Pick<Prisma.TicketUncheckedUpdateInput, 'status' | 'resolvedAt' | 'closedAt'> {
  switch (next) {
    case 'RESOLVED':
      return { status: next, resolvedAt: now, closedAt: null };
    case 'CLOSED':
      return { status: next, resolvedAt: ticket.resolvedAt ?? now, closedAt: now };
    default:
      return { status: next, resolvedAt: null, closedAt: null };
  }
}

export class TicketService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: FileStorage,
  ) {}

  async list(user: AuthUser, query: TicketListQuery): Promise<Paginated<TicketSummaryDTO>> {
    const where = this.buildListFilter(user, query);
    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: ticketSummaryInclude(canSeeInternal(user)),
        orderBy: TICKET_ORDER[query.sort],
        ...paginationArgs(query.page, query.pageSize),
      }),
    ]);
    return paginated(tickets.map(toTicketSummaryDTO), total, query.page, query.pageSize);
  }

  async getDetail(user: AuthUser, id: string): Promise<TicketDetailDTO> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: ticketDetailInclude(canSeeInternal(user)),
    });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');
    return toTicketDetailDTO(ticket);
  }

  async create(
    user: AuthUser,
    input: CreateTicketInput,
    files: StoredFile[],
  ): Promise<TicketDetailDTO> {
    const categoryId = input.categoryId ?? null;
    if (categoryId) await this.findActiveCategory(categoryId);

    const priority = input.priority ?? 'MEDIUM';
    const number = await nextTicketNumber(this.prisma);

    // Nullable fields are written explicitly so `field: null` filters match in MongoDB.
    const ticket = await this.prisma.ticket.create({
      data: {
        number,
        subject: input.subject,
        description: input.description,
        priority,
        priorityRank: PRIORITY_RANK[priority],
        categoryId,
        customerId: user.id,
        assigneeId: null,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
        attachments: {
          create: files.map((file) => ({ ...file, messageId: null, uploaderId: user.id })),
        },
        events: {
          create: [{ type: 'CREATED', actorId: user.id, fromValue: null, toValue: null }],
        },
      },
      select: { id: true },
    });

    return this.getDetail(user, ticket.id);
  }

  async update(user: AuthUser, id: string, input: UpdateTicketInput): Promise<TicketDetailDTO> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { category: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');

    const canUpdate = hasPermission(user.role, PERMISSIONS.TICKET_UPDATE);
    const requireStaff = (field: string) => {
      if (!canUpdate) throw Errors.forbidden(`Only support staff can change the ${field}`);
    };

    const now = new Date();
    const data: Prisma.TicketUncheckedUpdateInput = {};
    const events: EventDraft[] = [];

    if (input.subject !== undefined && input.subject !== ticket.subject) {
      requireStaff('subject');
      data.subject = input.subject;
      events.push({ type: 'SUBJECT_CHANGED', fromValue: ticket.subject, toValue: input.subject });
    }

    if (input.status !== undefined && input.status !== ticket.status) {
      const isRequester = ticket.customerId === user.id;
      if (!canUpdate && !(isRequester && customerCanSetStatus(ticket.status, input.status))) {
        throw Errors.forbidden('You cannot move this ticket to that status');
      }
      Object.assign(data, statusChangeData(ticket, input.status, now));
      events.push({ type: 'STATUS_CHANGED', fromValue: ticket.status, toValue: input.status });
    }

    if (input.priority !== undefined && input.priority !== ticket.priority) {
      requireStaff('priority');
      data.priority = input.priority;
      data.priorityRank = PRIORITY_RANK[input.priority];
      events.push({
        type: 'PRIORITY_CHANGED',
        fromValue: ticket.priority,
        toValue: input.priority,
      });
    }

    if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
      requireStaff('category');
      const category = input.categoryId ? await this.findActiveCategory(input.categoryId) : null;
      data.categoryId = input.categoryId;
      events.push({
        type: 'CATEGORY_CHANGED',
        fromValue: ticket.category?.name ?? null,
        toValue: category?.name ?? null,
      });
    }

    if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
      if (!hasPermission(user.role, PERMISSIONS.TICKET_ASSIGN)) {
        throw Errors.forbidden('You cannot assign tickets');
      }
      const assignee = input.assigneeId ? await this.findAssignableUser(input.assigneeId) : null;
      data.assigneeId = input.assigneeId;
      events.push({
        type: 'ASSIGNEE_CHANGED',
        fromValue: ticket.assignee?.name ?? null,
        toValue: assignee?.name ?? null,
      });
    }

    if (events.length > 0) {
      data.lastActivityAt = now;
      await this.prisma.$transaction([
        this.prisma.ticket.update({ where: { id }, data }),
        this.prisma.ticketEvent.createMany({
          data: events.map((event) => ({
            ...event,
            ticketId: id,
            actorId: user.id,
            createdAt: now,
          })),
        }),
      ]);
    }

    return this.getDetail(user, id);
  }

  async addMessage(
    user: AuthUser,
    ticketId: string,
    input: CreateMessageInput,
    files: StoredFile[],
  ): Promise<MessageDTO> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || !canViewTicket(user, ticket)) throw Errors.notFound('Ticket');

    const isInternal = input.isInternal ?? false;
    if (isInternal && !canSeeInternal(user)) {
      throw Errors.forbidden('Only support staff can add internal notes');
    }
    if (input.status && !hasPermission(user.role, PERMISSIONS.TICKET_UPDATE)) {
      throw Errors.forbidden('Only support staff can change the status while replying');
    }
    const reopening = input.status !== undefined && input.status !== 'CLOSED';
    if (ticket.status === 'CLOSED' && !reopening) {
      throw Errors.conflict('This ticket is closed. Reopen it before replying.', 'TICKET_CLOSED');
    }

    const now = new Date();
    const isRequester = ticket.customerId === user.id;
    const authorIsStaff = isStaff(user.role);

    let nextStatus = input.status;
    // A customer replying to a ticket that was waiting on them (or resolved) reopens it.
    if (
      !nextStatus &&
      isRequester &&
      !authorIsStaff &&
      (ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED')
    ) {
      nextStatus = 'OPEN';
    }

    const ticketData: Prisma.TicketUncheckedUpdateInput = { lastActivityAt: now };
    if (!isInternal && authorIsStaff && !isRequester && !ticket.firstResponseAt) {
      ticketData.firstResponseAt = now;
    }
    const statusChanged = nextStatus !== undefined && nextStatus !== ticket.status;
    if (statusChanged && nextStatus) {
      Object.assign(ticketData, statusChangeData(ticket, nextStatus, now));
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          ticketId,
          authorId: user.id,
          body: input.body,
          isInternal,
          createdAt: now,
          attachments: {
            create: files.map((file) => ({ ...file, ticketId, uploaderId: user.id })),
          },
        },
        include: messageInclude,
      });
      await tx.ticket.update({ where: { id: ticketId }, data: ticketData });
      if (statusChanged) {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            type: 'STATUS_CHANGED',
            fromValue: ticket.status,
            toValue: nextStatus ?? null,
            createdAt: now,
          },
        });
      }
      return created;
    });

    return toMessageDTO(message);
  }

  /** Permanently delete a ticket, its conversation, history and stored files. */
  async remove(id: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true, attachments: { select: { storageKey: true } } },
    });
    if (!ticket) throw Errors.notFound('Ticket');

    await this.prisma.$transaction([
      this.prisma.attachment.deleteMany({ where: { ticketId: id } }),
      this.prisma.ticketEvent.deleteMany({ where: { ticketId: id } }),
      this.prisma.message.deleteMany({ where: { ticketId: id } }),
      this.prisma.ticket.delete({ where: { id } }),
    ]);
    await Promise.allSettled(ticket.attachments.map((a) => this.storage.remove(a.storageKey)));
  }

  private buildListFilter(user: AuthUser, query: TicketListQuery): Prisma.TicketWhereInput {
    const canViewAll = hasPermission(user.role, PERMISSIONS.TICKET_VIEW_ALL);
    const where: Prisma.TicketWhereInput = {};

    if (!canViewAll) where.customerId = user.id;
    else if (query.customerId) where.customerId = query.customerId;

    if (query.status?.length) where.status = { in: query.status };
    if (query.priority?.length) where.priority = { in: query.priority };
    if (query.categoryId) where.categoryId = query.categoryId;

    if (query.assigneeId === 'me') where.assigneeId = user.id;
    else if (query.assigneeId === 'unassigned') where.assigneeId = null;
    else if (query.assigneeId) where.assigneeId = query.assigneeId;

    if (query.q) {
      const contains = containsInsensitive(query.q);
      const or: Prisma.TicketWhereInput[] = [{ subject: contains }, { description: contains }];
      const numberMatch = /^#?(\d{1,9})$/.exec(query.q);
      if (numberMatch) or.push({ number: Number(numberMatch[1]) });
      if (canViewAll) {
        or.push({ customer: { is: { OR: [{ name: contains }, { email: contains }] } } });
      }
      where.OR = or;
    }

    return where;
  }

  private async findActiveCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || !category.isActive) {
      throw Errors.validation([{ path: 'categoryId', message: 'Select a valid category' }]);
    }
    return category;
  }

  private async findAssignableUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive || !isStaff(user.role)) {
      throw Errors.validation([
        { path: 'assigneeId', message: 'Tickets can only be assigned to active staff members' },
      ]);
    }
    return user;
  }
}
