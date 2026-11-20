import type { Role } from '@support-desk/shared';

/** The authenticated user attached to `request.user` by the `authenticate` hook. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Claims carried by the short-lived access token. */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
}
