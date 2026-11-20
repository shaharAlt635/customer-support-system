import {
  type AuthResponse,
  type Permission,
  type UserDTO,
  hasPermission,
} from '@support-desk/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { onSessionExpired, refreshSession, setAccessToken } from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<UserDTO | null>(null);
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
    queryClient.clear();
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
      login: async (input) => startSession(await authApi.login(input)),
      register: async (input) => startSession(await authApi.register(input)),
      signedOut,
      logout: async () => {
        await authApi.logout().catch(() => undefined);
        setSignedOut(true);
        endSession();
      },
      setUser: setUserState,
      can: (permission: Permission) => (user ? hasPermission(user.role, permission) : false),
    }),
    [status, user, signedOut, startSession, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
