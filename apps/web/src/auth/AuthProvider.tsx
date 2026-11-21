import type { AuthResponse, CurrentUserDTO, Permission } from '@support-desk/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { onSessionExpired, refreshSession, setAccessToken, setCompanySlug } from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

/** Data that doesn't depend on who is signed in survives sign-out. */
const PUBLIC_QUERY_KEYS = new Set(['company', 'config']);

/**
 * Session for one company. Mounted (and keyed) per company by `CompanyRoot`, since each
 * company has its own accounts and refresh cookie.
 */
export function AuthProvider({
  companySlug,
  children,
}: {
  companySlug: string;
  children: ReactNode;
}) {
  // Point the API client at this company before any child request runs (idempotent).
  setCompanySlug(companySlug);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<CurrentUserDTO | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const startSession = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setUserState(session.user);
    setSignedOut(false);
    setStatus('authenticated');
  }, []);

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setStatus('unauthenticated');
    queryClient.removeQueries({
      predicate: (query) => !PUBLIC_QUERY_KEYS.has(String(query.queryKey[0])),
    });
  }, [queryClient]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (session) startSession(session);
        else setStatus('unauthenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [startSession]);

  useEffect(() => {
    onSessionExpired(() => {
      endSession();
      toast.info('Your session has expired. Please sign in again.');
    });
    return () => onSessionExpired(null);
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (input) => startSession(await authApi.login({ ...input, companySlug })),
      register: (input, captchaToken) => authApi.register({ ...input, companySlug }, captchaToken),
      signedOut,
      logout: async () => {
        await authApi.logout(companySlug).catch(() => undefined);
        setSignedOut(true);
        endSession();
      },
      setUser: setUserState,
      refreshUser: async () => setUserState((await authApi.me()).user),
      can: (permission: Permission) => user?.permissions.includes(permission) ?? false,
      canAny: (...permissions: Permission[]) =>
        permissions.some((permission) => user?.permissions.includes(permission) ?? false),
    }),
    [status, user, signedOut, companySlug, startSession, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
