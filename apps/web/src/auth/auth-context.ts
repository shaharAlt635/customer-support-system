import type {
  CurrentUserDTO,
  LoginInput,
  Permission,
  RegisterInput,
  VerificationPendingDTO,
} from '@support-desk/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUserDTO | null;
  /** True after an explicit sign-out (as opposed to an expired session). */
  signedOut: boolean;
  login: (input: LoginInput) => Promise<void>;
  /** Creates the account; the user must confirm their email before signing in. */
  register: (input: RegisterInput) => Promise<VerificationPendingDTO>;
  logout: () => Promise<void>;
  setUser: (user: CurrentUserDTO) => void;
  /** Re-read the signed-in user (role, group and permissions) from the API. */
  refreshUser: () => Promise<void>;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** For components that only render inside authenticated routes. */
export function useCurrentUser(): CurrentUserDTO {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser called without an authenticated user');
  return user;
}
