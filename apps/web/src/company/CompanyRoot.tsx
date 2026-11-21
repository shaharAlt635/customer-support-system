import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { companiesApi } from '../api/endpoints';
import { AuthProvider } from '../auth/AuthProvider';
import { FullPageSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { CompanyContext, type CompanyContextValue } from './company-context';

/**
 * Route element for `/:slug/*`. Loads the company, then mounts a session scoped to it —
 * accounts are per company, so switching companies means a different session.
 */
export function CompanyRoot() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const normalized = slug.toLowerCase();

  const {
    data: company,
    error,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ['company', normalized],
    queryFn: () => companiesApi.getPublic(normalized),
    staleTime: 5 * 60_000,
  });

  const value = useMemo<CompanyContextValue | null>(
    () =>
      company ? { company, path: (to: string) => `/${company.slug}${to === '/' ? '' : to}` } : null,
    [company],
  );

  if (slug !== normalized) {
    const rest = location.pathname.slice(slug.length + 1);
    return <Navigate to={`/${normalized}${rest}${location.search}`} replace />;
  }
  if (isPending) return <FullPageSpinner />;
  if (error || !value) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="flex min-h-dvh items-center justify-center px-4">
          <EmptyState
            icon={Building2}
            title="Company not found"
            description={`There is no company at “/${normalized}”. Check the address or create a new company.`}
            action={
              <Link
                to="/"
                className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Go to the home page
              </Link>
            }
          />
        </div>
      );
    }
    return <ErrorState error={error} onRetry={() => void refetch()} className="min-h-dvh" />;
  }

  return (
    <CompanyContext.Provider value={value}>
      <AuthProvider key={value.company.slug} companySlug={value.company.slug}>
        <Outlet />
      </AuthProvider>
    </CompanyContext.Provider>
  );
}
