import { useQuery } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../api/client';
import { authApi, portalApi } from '../api/endpoints';
import { AuthLayout } from '../features/auth/AuthLayout';
import { useDocumentTitle } from '../lib/hooks';

const isObjectId = (value: string | null): value is string =>
  !!value && /^[a-f\d]{24}$/i.test(value);

function LinkFailed({ title, error, hint }: { title: string; error: unknown; hint: string }) {
  return (
    <AuthLayout title={title}>
      <div className="rounded-xl bg-red-50 p-5 ring-1 ring-red-200">
        <CircleAlert className="size-7 text-red-500" aria-hidden />
        <p className="mt-3 text-sm text-red-800">
          {error ? getErrorMessage(error) : 'This link is missing its token.'}
        </p>
        <p className="mt-2 text-sm text-slate-600">{hint}</p>
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

function Working({ title, text }: { title: string; text: string }) {
  return (
    <AuthLayout title={title}>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden />
        {text}
      </div>
    </AuthLayout>
  );
}

/** Link from the "confirm your request" email: creates the ticket and signs the guest in. */
export function ConfirmRequestPage() {
  useDocumentTitle('Confirm your request');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  // A query (not an effect) so React StrictMode can't spend the single-use token twice.
  const { data, error } = useQuery({
    queryKey: ['confirm-request', token],
    queryFn: () => portalApi.confirm(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (!data) return;
    toast.success('Your request was sent to the team');
    navigate(`/${data.company.slug}/tickets/${data.ticketId}`, { replace: true });
  }, [data, navigate]);

  if (!token || error) {
    return (
      <LinkFailed
        title="We couldn't confirm your request"
        error={error}
        hint="Confirmation links work once and expire after 24 hours. Please submit your request again."
      />
    );
  }
  return <Working title="Sending your request…" text="Confirming your email address." />;
}

/** Link from a sign-in or reply email: signs the user in, optionally straight to a ticket. */
export function SignInLinkPage() {
  useDocumentTitle('Signing you in');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const ticket = params.get('ticket');
  const navigate = useNavigate();

  const { data, error } = useQuery({
    queryKey: ['magic-login', token],
    queryFn: () => authApi.magicLogin(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (!data) return;
    const target = isObjectId(ticket) ? `/tickets/${ticket}` : '/tickets';
    navigate(`/${data.company.slug}${target}`, { replace: true });
  }, [data, ticket, navigate]);

  if (!token || error) {
    return (
      <LinkFailed
        title="This sign-in link didn't work"
        error={error}
        hint="Sign-in links work once. Request a new one from the company's support page."
      />
    );
  }
  return <Working title="Signing you in…" text="One moment." />;
}
