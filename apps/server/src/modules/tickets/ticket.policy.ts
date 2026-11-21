import { PERMISSIONS, isStaff } from '@support-desk/shared';
import type { AuthUser } from '../../types';

export const can = (user: AuthUser, permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
  user.permissions.includes(permission);

/**
 * Tickets never cross company boundaries. Within a company:
 * - everyone sees the tickets they requested;
 * - agents with "see all tickets" see everything;
 * - other agents see unassigned tickets and tickets assigned to them.
 */
export function canViewTicket(
  user: AuthUser,
  ticket: { companyId: string; customerId: string; assigneeId: string | null },
): boolean {
  if (ticket.companyId !== user.companyId) return false;
  if (ticket.customerId === user.id) return true;
  if (!isStaff(user.role)) return false;
  if (can(user, PERMISSIONS.TICKETS_VIEW_ALL)) return true;
  return ticket.assigneeId === null || ticket.assigneeId === user.id;
}

/** Whether the user may read internal notes (and their attachments). */
export function canSeeInternal(user: AuthUser): boolean {
  return can(user, PERMISSIONS.TICKETS_INTERNAL_NOTES);
}
