import type { Role, TicketStatus } from './constants';

/**
 * Fine-grained permissions a company grants to agents through permission groups.
 * The owner always has every permission; customers have none (they can still open,
 * follow, reply to, close and reopen their own tickets).
 */
export const PERMISSIONS = {
  TICKETS_VIEW_ALL: 'tickets.view_all',
  TICKETS_REPLY: 'tickets.reply',
  TICKETS_INTERNAL_NOTES: 'tickets.internal_notes',
  TICKETS_CHANGE_STATUS: 'tickets.change_status',
  TICKETS_CHANGE_PRIORITY: 'tickets.change_priority',
  TICKETS_EDIT_DETAILS: 'tickets.edit_details',
  TICKETS_ASSIGN_SELF: 'tickets.assign_self',
  TICKETS_ASSIGN_OTHERS: 'tickets.assign_others',
  TICKETS_DELETE: 'tickets.delete',
  CUSTOMERS_MANAGE: 'customers.manage',
  REPORTS_VIEW: 'reports.view',
  CATEGORIES_MANAGE: 'categories.manage',
  TEAM_INVITE: 'team.invite',
  TEAM_MANAGE: 'team.manage',
  GROUPS_MANAGE: 'groups.manage',
  COMPANY_SETTINGS: 'company.settings',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export interface PermissionInfo {
  key: Permission;
  label: string;
  description: string;
}

/** Human-readable catalogue, grouped for the permission-group editor. */
export const PERMISSION_CATALOG: { category: string; permissions: PermissionInfo[] }[] = [
  {
    category: 'Tickets',
    permissions: [
      {
        key: PERMISSIONS.TICKETS_VIEW_ALL,
        label: 'See all tickets',
        description:
          'Without this, agents only see unassigned tickets and tickets assigned to them.',
      },
      {
        key: PERMISSIONS.TICKETS_REPLY,
        label: 'Reply to customers',
        description: 'Send public replies on tickets.',
      },
      {
        key: PERMISSIONS.TICKETS_INTERNAL_NOTES,
        label: 'Internal notes',
        description: 'Read and write notes that customers never see.',
      },
      {
        key: PERMISSIONS.TICKETS_CHANGE_STATUS,
        label: 'Change status',
        description: 'Move tickets between Open, In progress, Waiting, Resolved and Closed.',
      },
      {
        key: PERMISSIONS.TICKETS_CHANGE_PRIORITY,
        label: 'Change priority',
        description: 'Raise or lower ticket priority.',
      },
      {
        key: PERMISSIONS.TICKETS_EDIT_DETAILS,
        label: 'Edit subject & category',
        description: 'Rename tickets and change their category.',
      },
      {
        key: PERMISSIONS.TICKETS_ASSIGN_SELF,
        label: 'Assign to themselves',
        description: 'Pick up unassigned tickets and drop their own.',
      },
      {
        key: PERMISSIONS.TICKETS_ASSIGN_OTHERS,
        label: 'Assign to others',
        description: 'Assign or reassign tickets to any agent.',
      },
      {
        key: PERMISSIONS.TICKETS_DELETE,
        label: 'Delete tickets',
        description: 'Permanently delete tickets, their conversation and files.',
      },
    ],
  },
  {
    category: 'Customers & reports',
    permissions: [
      {
        key: PERMISSIONS.CUSTOMERS_MANAGE,
        label: 'Manage customers',
        description: 'View the customer list and deactivate or reactivate customer accounts.',
      },
      {
        key: PERMISSIONS.REPORTS_VIEW,
        label: 'Company-wide reports',
        description: 'Dashboard numbers for the whole company instead of only their own tickets.',
      },
    ],
  },
  {
    category: 'Administration',
    permissions: [
      {
        key: PERMISSIONS.CATEGORIES_MANAGE,
        label: 'Manage categories',
        description: 'Create, edit, deactivate and delete ticket categories.',
      },
      {
        key: PERMISSIONS.TEAM_INVITE,
        label: 'Invite agents',
        description: 'Send, resend and cancel team invitations.',
      },
      {
        key: PERMISSIONS.TEAM_MANAGE,
        label: 'Manage agents',
        description: "Change agents' permission groups and remove agents from the team.",
      },
      {
        key: PERMISSIONS.GROUPS_MANAGE,
        label: 'Manage permission groups',
        description: 'Create, edit and delete permission groups.',
      },
      {
        key: PERMISSIONS.COMPANY_SETTINGS,
        label: 'Company settings',
        description: "Edit the company's profile.",
      },
    ],
  },
];

/** Groups every new company starts with. */
export const DEFAULT_GROUPS: {
  name: string;
  description: string;
  permissions: readonly Permission[];
  isDefault: boolean;
}[] = [
  {
    name: 'Administrator',
    description: 'Full access, including team and company settings.',
    permissions: ALL_PERMISSIONS,
    isDefault: false,
  },
  {
    name: 'Agent',
    description: 'Works tickets end to end.',
    permissions: [
      PERMISSIONS.TICKETS_VIEW_ALL,
      PERMISSIONS.TICKETS_REPLY,
      PERMISSIONS.TICKETS_INTERNAL_NOTES,
      PERMISSIONS.TICKETS_CHANGE_STATUS,
      PERMISSIONS.TICKETS_CHANGE_PRIORITY,
      PERMISSIONS.TICKETS_EDIT_DETAILS,
      PERMISSIONS.TICKETS_ASSIGN_SELF,
      PERMISSIONS.TICKETS_ASSIGN_OTHERS,
      PERMISSIONS.REPORTS_VIEW,
    ],
    isDefault: true,
  },
  {
    name: 'Read-only',
    description: 'Can follow tickets and reports but not change anything.',
    permissions: [PERMISSIONS.TICKETS_VIEW_ALL, PERMISSIONS.REPORTS_VIEW],
    isDefault: false,
  },
];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** What a member can do: owners everything, agents their group's permissions, customers nothing. */
export function effectivePermissions(
  role: Role,
  groupPermissions: readonly string[] | null | undefined,
): Permission[] {
  if (role === 'OWNER') return [...ALL_PERMISSIONS];
  if (role === 'AGENT') return (groupPermissions ?? []).filter(isPermission);
  return [];
}

/** Owners and agents are staff; customers are not. */
export function isStaff(role: Role): boolean {
  return role === 'OWNER' || role === 'AGENT';
}

/**
 * Requesters may close their own ticket at any time and reopen it once it has been
 * resolved or closed. Every other status change needs the change-status permission.
 */
export function customerCanSetStatus(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  if (to === 'CLOSED') return true;
  if (to === 'OPEN') return from === 'RESOLVED' || from === 'CLOSED';
  return false;
}

export function hasPermission(permissions: readonly Permission[], permission: Permission): boolean {
  return permissions.includes(permission);
}
