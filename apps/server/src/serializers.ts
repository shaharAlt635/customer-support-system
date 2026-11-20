import type { Prisma } from '@prisma/client';
import type {
  AttachmentDTO,
  CategoryDTO,
  MessageDTO,
  TicketDetailDTO,
  TicketEventDTO,
  TicketSummaryDTO,
  UserDTO,
  UserSummaryDTO,
} from '@support-desk/shared';
import { CUSTOMER_VISIBLE_EVENTS } from '@support-desk/shared';

// ---------------------------------------------------------------------------
// Prisma selections — one place that decides what each API shape loads.
// ---------------------------------------------------------------------------

export const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

export const userSelect = {
  ...userSummarySelect,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const categorySummarySelect = { id: true, name: true, color: true } satisfies Prisma.CategorySelect;

const attachmentInclude = {
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.AttachmentInclude;

export const messageInclude = {
  author: { select: userSummarySelect },
  attachments: { include: attachmentInclude, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.MessageInclude;

export function ticketSummaryInclude(includeInternal: boolean) {
  return {
    category: { select: categorySummarySelect },
    customer: { select: userSummarySelect },
    assignee: { select: userSummarySelect },
    _count: {
      select: { messages: includeInternal ? true : { where: { isInternal: false } } },
    },
  } satisfies Prisma.TicketInclude;
}

export function ticketDetailInclude(includeInternal: boolean) {
  return {
    ...ticketSummaryInclude(includeInternal),
    attachments: {
      where: { messageId: null },
      include: attachmentInclude,
      orderBy: { createdAt: 'asc' },
    },
    messages: {
      where: includeInternal ? undefined : { isInternal: false },
      include: messageInclude,
      orderBy: { createdAt: 'asc' },
    },
    events: {
      where: includeInternal ? undefined : { type: { in: [...CUSTOMER_VISIBLE_EVENTS] } },
      include: { actor: { select: userSummarySelect } },
      orderBy: { createdAt: 'asc' },
    },
  } satisfies Prisma.TicketInclude;
}

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
type UserSummaryRow = Prisma.UserGetPayload<{ select: typeof userSummarySelect }>;
type AttachmentRow = Prisma.AttachmentGetPayload<{ include: typeof attachmentInclude }>;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
type TicketSummaryRow = Prisma.TicketGetPayload<{
  include: ReturnType<typeof ticketSummaryInclude>;
}>;
type TicketDetailRow = Prisma.TicketGetPayload<{ include: ReturnType<typeof ticketDetailInclude> }>;
type EventRow = TicketDetailRow['events'][number];
type CategoryRow = Prisma.CategoryGetPayload<object>;

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null | undefined) => (date ? date.toISOString() : null);

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function toUserSummaryDTO(user: UserSummaryRow): UserSummaryDTO {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function toUserDTO(user: UserRow): UserDTO {
  return {
    ...toUserSummaryDTO(user),
    isActive: user.isActive,
    lastLoginAt: isoOrNull(user.lastLoginAt),
    createdAt: iso(user.createdAt),
  };
}

export function toCategoryDTO(category: CategoryRow, ticketCount = 0): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    description: category.description ?? null,
    isActive: category.isActive,
    ticketCount,
    createdAt: iso(category.createdAt),
  };
}

export function toAttachmentDTO(attachment: AttachmentRow): AttachmentDTO {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    messageId: attachment.messageId ?? null,
    uploadedBy: { id: attachment.uploader.id, name: attachment.uploader.name },
    createdAt: iso(attachment.createdAt),
  };
}

export function toMessageDTO(message: MessageRow): MessageDTO {
  return {
    id: message.id,
    body: message.body,
    isInternal: message.isInternal,
    author: toUserSummaryDTO(message.author),
    attachments: message.attachments.map(toAttachmentDTO),
    createdAt: iso(message.createdAt),
  };
}

function toEventDTO(event: EventRow): TicketEventDTO {
  return {
    id: event.id,
    type: event.type,
    fromValue: event.fromValue ?? null,
    toValue: event.toValue ?? null,
    actor: toUserSummaryDTO(event.actor),
    createdAt: iso(event.createdAt),
  };
}

export function toTicketSummaryDTO(ticket: TicketSummaryRow): TicketSummaryDTO {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    customer: toUserSummaryDTO(ticket.customer),
    assignee: ticket.assignee ? toUserSummaryDTO(ticket.assignee) : null,
    messageCount: ticket._count.messages,
    lastActivityAt: iso(ticket.lastActivityAt),
    createdAt: iso(ticket.createdAt),
    updatedAt: iso(ticket.updatedAt),
  };
}

export function toTicketDetailDTO(ticket: TicketDetailRow): TicketDetailDTO {
  return {
    ...toTicketSummaryDTO(ticket),
    description: ticket.description,
    firstResponseAt: isoOrNull(ticket.firstResponseAt),
    resolvedAt: isoOrNull(ticket.resolvedAt),
    closedAt: isoOrNull(ticket.closedAt),
    attachments: ticket.attachments.map(toAttachmentDTO),
    messages: ticket.messages.map(toMessageDTO),
    events: ticket.events.map(toEventDTO),
  };
}
