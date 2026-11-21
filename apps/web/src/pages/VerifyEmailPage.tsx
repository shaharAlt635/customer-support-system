import { useQuery } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { getErrorMessage } from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthLayout } from '../features/auth/AuthLayout';
import { useDocumentTitle } from '../lib/hooks';

/**
 * Landing page for the link in confirmation emails. The API confirms the address, starts a
 * session (refresh cookie) and we hand over to the company's app.
 */
export default function VerifyEmailPage() {
  useDocumentTitle('Confirm your email');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  // A query (not an effect) so React StrictMode can't spend the single-use token twice.
  const { data, error } = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => authApi.verifyEmail(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (data) navigate(`/${data.company.slug}/dashboard`, { replace: true });
  }, [data, navigate]);

  if (!token || error) {
    return (
      <AuthLayout title="We couldn't confirm your email">
        <div className="rounded-xl bg-red-50 p-5 ring-1 ring-red-200">
          <CircleAlert className="size-7 text-red-500" aria-hidden />
          <p className="mt-3 text-sm text-red-800">
            {error ? getErrorMessage(error) : 'This link is missing its token.'}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Links expire after 24 hours and work once. Try signing in — you can request a fresh link
            from the sign-in page.
          </p>
        </div>
        <Link
          to="/"
          className="mt-6 inline-block text-sm font-medium text-brand-600 hover:text-brand-800"
        >
          Go to the home page
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Confirming your email…">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden />
        One moment while we activate your account.
      </div>
    </AuthLayout>
  );
}
