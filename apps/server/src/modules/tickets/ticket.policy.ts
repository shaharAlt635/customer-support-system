import { PERMISSIONS, hasPermission } from '@support-desk/shared';
import type { AuthUser } from '../../types';

/** Staff see every ticket; customers only see the tickets they requested. */
export function canViewTicket(user: AuthUser, ticket: { customerId: string }): boolean {
  return hasPermission(user.role, PERMISSIONS.TICKET_VIEW_ALL) || ticket.customerId === user.id;
}

/** Whether the user may read internal notes (and their attachments). */
export function canSeeInternal(user: AuthUser): boolean {
  return hasPermission(user.role, PERMISSIONS.NOTE_INTERNAL);
}
