/**
 * OWNER: created the company, has every permission and can't be removed.
 * AGENT: team member whose permissions come from their permission group.
 * CUSTOMER: opens and follows their own tickets.
 */
export const ROLES = ['OWNER', 'AGENT', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['OWNER', 'AGENT'];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  AGENT: 'Agent',
  CUSTOMER: 'Customer',
};

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'INVITATION',
  'TICKET_ASSIGNED',
  'TICKET_REPLY',
  'TICKET_NOTE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses that still need attention from someone. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Numeric weight stored alongside the priority so tickets can be sorted by urgency. */
export const PRIORITY_RANK: Record<TicketPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};

export const TICKET_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'CATEGORY_CHANGED',
  'ASSIGNEE_CHANGED',
  'SUBJECT_CHANGED',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

/** Event types a customer is allowed to see on their own tickets. */
export const CUSTOMER_VISIBLE_EVENTS: readonly TicketEventType[] = ['CREATED', 'STATUS_CHANGED'];

export const TICKET_SORTS = ['updated', 'newest', 'oldest', 'priority'] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];

/**
 * Allowed attachment types, keyed by lowercase extension. The server derives the stored
 * MIME type from the extension and never trusts the type sent by the client.
 */
export const ATTACHMENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Company slugs that would collide with app routes. */
export const RESERVED_SLUGS: readonly string[] = [
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'companies',
  'dashboard',
  'dev',
  'docs',
  'find',
  'forgot-password',
  'help',
  'login',
  'logout',
  'new',
  'pricing',
  'privacy',
  'register',
  'reset-password',
  'settings',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'verify-email',
  'www',
];

export const DEFAULT_MAX_UPLOAD_SIZE_MB = 10;
export const DEFAULT_MAX_FILES_PER_UPLOAD = 5;
