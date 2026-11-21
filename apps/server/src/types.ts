import type { Permission, Role } from '@support-desk/shared';

/** The authenticated user attached to `request.user` by the `authenticate` hook. */
export interface AuthUser {
  id: string;
  companyId: string;
  email: string;
  name: string;
  role: Role;
  /** Effective permissions: everything for owners, the group's for agents, none for customers. */
  permissions: Permission[];
}

/** Claims carried by the short-lived access token. */
export interface AccessTokenPayload {
  sub: string;
  /** Company the session belongs to (accounts are company-scoped). */
  cid: string;
}
