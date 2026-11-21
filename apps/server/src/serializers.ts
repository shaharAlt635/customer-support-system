import type { Prisma } from '@prisma/client';
import type {
  AttachmentDTO,
  CategoryDTO,
  CurrentUserDTO,
  GroupDTO,
  InvitationDTO,
  MessageDTO,
  NotificationDTO,
  TicketDetailDTO,
  TicketEventDTO,
  TicketSummaryDTO,
  UserDTO,
  UserSummaryDTO,
} from '@support-desk/shared';
import { CUSTOMER_VISIBLE_EVENTS, effectivePermissions, isPermission } from '@support-desk/shared';

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
  companyId: true,
  // Only used to derive `hasPassword`; never serialized.
  passwordHash: true,
  group: { select: { id: true, name: true } },
  isActive: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/** The signed-in user, including what their group allows. */
export const currentUserSelect = {
  ...userSelect,
  group: { select: { id: true, name: true, permissions: true } },
} satisfies Prisma.UserSelect;

export const companySummarySelect = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.CompanySelect;

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
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    group: user.group ? { id: user.group.id, name: user.group.name } : null,
    emailVerified: user.emailVerifiedAt !== null && user.emailVerifiedAt !== undefined,
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

/** Stand-in for the requester of an anonymous ticket, as seen by anyone but the requester. */
export const ANONYMOUS_REQUESTER: UserSummaryDTO = {
  id: 'anonymous',
  name: 'Anonymous',
  email: null,
  role: 'CUSTOMER',
};

/**
 * On anonymous tickets, replace every trace of the requester (as requester, message author,
 * event actor or uploader) unless the viewer *is* the requester.
 */
function maskRequester<T extends TicketSummaryDTO>(
  dto: T,
  requesterId: string,
  viewerId: string | undefined,
): T {
  if (!dto.isAnonymous || viewerId === requesterId) return dto;
  const masked: TicketSummaryDTO = { ...dto, customer: ANONYMOUS_REQUESTER };
  if (!('messages' in dto)) return masked as T;

  const detail = dto as unknown as TicketDetailDTO;
  const isRequester = (id: string) => id === requesterId;
  const maskAttachment = (a: AttachmentDTO): AttachmentDTO =>
    isRequester(a.uploadedBy.id) ? { ...a, uploadedBy: { id: 'anonymous', name: 'Anonymous' } } : a;
  return {
    ...detail,
    customer: ANONYMOUS_REQUESTER,
    attachments: detail.attachments.map(maskAttachment),
    messages: detail.messages.map((m) => ({
      ...m,
      author: isRequester(m.author.id) ? ANONYMOUS_REQUESTER : m.author,
      attachments: m.attachments.map(maskAttachment),
    })),
    events: detail.events.map((e) => ({
      ...e,
      actor: isRequester(e.actor.id) ? ANONYMOUS_REQUESTER : e.actor,
    })),
  } as unknown as T;
}

export function toTicketSummaryDTO(ticket: TicketSummaryRow, viewerId?: string): TicketSummaryDTO {
  return maskRequester(baseTicketSummary(ticket), ticket.customerId, viewerId);
}

function baseTicketSummary(ticket: TicketSummaryRow): TicketSummaryDTO {
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
    isAnonymous: ticket.isAnonymous,
    lastActivityAt: iso(ticket.lastActivityAt),
    createdAt: iso(ticket.createdAt),
    updatedAt: iso(ticket.updatedAt),
  };
}

/** Message as seen by `viewerId` (masks the requester on anonymous tickets). */
export function toMessageDTOFor(
  message: MessageRow,
  ticket: { isAnonymous: boolean; customerId: string },
  viewerId: string,
): MessageDTO {
  const dto = toMessageDTO(message);
  if (!ticket.isAnonymous || viewerId === ticket.customerId) return dto;
  if (dto.author.id !== ticket.customerId) return dto;
  return {
    ...dto,
    author: ANONYMOUS_REQUESTER,
    attachments: dto.attachments.map((a) => ({
      ...a,
      uploadedBy: { id: 'anonymous', name: 'Anonymous' },
    })),
  };
}

export function toTicketDetailDTO(ticket: TicketDetailRow, viewerId?: string): TicketDetailDTO {
  const detail: TicketDetailDTO = {
    ...baseTicketSummary(ticket),
    description: ticket.description,
    firstResponseAt: isoOrNull(ticket.firstResponseAt),
    resolvedAt: isoOrNull(ticket.resolvedAt),
    closedAt: isoOrNull(ticket.closedAt),
    attachments: ticket.attachments.map(toAttachmentDTO),
    messages: ticket.messages.map(toMessageDTO),
    events: ticket.events.map(toEventDTO),
  };
  return maskRequester(detail, ticket.customerId, viewerId);
}

type CurrentUserRow = Prisma.UserGetPayload<{ select: typeof currentUserSelect }>;

export function toCurrentUserDTO(user: CurrentUserRow): CurrentUserDTO {
  return {
    ...toUserDTO(user),
    permissions: effectivePermissions(user.role, user.group?.permissions),
  };
}

export function toGroupDTO(
  group: Prisma.PermissionGroupGetPayload<object>,
  memberCount = 0,
): GroupDTO {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    permissions: group.permissions.filter(isPermission),
    isDefault: group.isDefault,
    memberCount,
    createdAt: iso(group.createdAt),
  };
}

export const invitationInclude = {
  group: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvitationInclude;

export function toInvitationDTO(
  invitation: Prisma.InvitationGetPayload<{ include: typeof invitationInclude }>,
  hasAccount: boolean,
): InvitationDTO {
  return {
    id: invitation.id,
    email: invitation.email,
    group: invitation.group,
    invitedBy: invitation.invitedBy,
    status: invitation.status,
    hasAccount,
    createdAt: iso(invitation.createdAt),
    expiresAt: iso(invitation.expiresAt),
  };
}

export function toNotificationDTO(
  notification: Prisma.NotificationGetPayload<object>,
): NotificationDTO {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body ?? null,
    link: notification.link ?? null,
    readAt: isoOrNull(notification.readAt),
    createdAt: iso(notification.createdAt),
  };
}
