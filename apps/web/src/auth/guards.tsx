import type { Permission } from '@support-desk/shared';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/ui/Spinner';
import { useCompanyPath } from '../company/company-context';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './auth-context';

export function RequireAuth() {
  const { status, signedOut } = useAuth();
  const location = useLocation();
  const companyPath = useCompanyPath();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'unauthenticated') {
    // Remember where the user was so they return there after signing in — unless they
    // signed out on purpose, in which case the next person should start fresh.
    const from = signedOut ? undefined : location.pathname + location.search;
    return <Navigate to={companyPath('/login')} replace state={from ? { from } : undefined} />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  const companyPath = useCompanyPath();
  const from = (location.state as { from?: string } | null)?.from;

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated')
    return <Navigate to={from ?? companyPath('/dashboard')} replace />;
  return <Outlet />;
}

/** Renders the route if the user has at least one of the listed permissions. */
export function RequirePermission({ anyOf }: { anyOf: Permission[] }) {
  const { canAny } = useAuth();
  return canAny(...anyOf) ? <Outlet /> : <ForbiddenPage />;
}
