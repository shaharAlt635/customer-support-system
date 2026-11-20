import type { Role, TicketStatus } from './constants';

export const PERMISSIONS = {
  TICKET_CREATE: 'ticket:create',
  /** See every ticket, not just the ones you requested. */
  TICKET_VIEW_ALL: 'ticket:view_all',
  /** Change status, priority, category and subject of any ticket. */
  TICKET_UPDATE: 'ticket:update',
  TICKET_ASSIGN: 'ticket:assign',
  TICKET_DELETE: 'ticket:delete',
  /** Read and write internal notes that customers never see. */
  NOTE_INTERNAL: 'note:internal',
  USER_MANAGE: 'user:manage',
  CATEGORY_MANAGE: 'category:manage',
  /** Organisation-wide statistics (customers only see stats for their own tickets). */
  STATS_VIEW_ALL: 'stats:view_all',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  AGENT: [
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_VIEW_ALL,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_ASSIGN,
    PERMISSIONS.NOTE_INTERNAL,
    PERMISSIONS.STATS_VIEW_ALL,
  ],
  CUSTOMER: [PERMISSIONS.TICKET_CREATE],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaff(role: Role): boolean {
  return role === 'ADMIN' || role === 'AGENT';
}

/**
 * Customers may close their own ticket at any time and reopen it once it has been
 * resolved or closed. Every other status change is reserved for support staff.
 */
export function customerCanSetStatus(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  if (to === 'CLOSED') return true;
  if (to === 'OPEN') return from === 'RESOLVED' || from === 'CLOSED';
  return false;
}
