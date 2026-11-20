import type { Permission } from '@support-desk/shared';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/ui/Spinner';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './auth-context';

export function RequireAuth() {
  const { status, signedOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'unauthenticated') {
    // Remember where the user was so they return there after signing in — unless they
    // signed out on purpose, in which case the next person should start fresh.
    const from = signedOut ? undefined : location.pathname + location.search;
    return <Navigate to="/login" replace state={from ? { from } : undefined} />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to={from ?? '/'} replace />;
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth();
  return can(permission) ? <Outlet /> : <ForbiddenPage />;
}
