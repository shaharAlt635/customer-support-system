import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@support-desk/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { toast } from 'sonner';
import { ApiError, getErrorMessage } from '../api/client';
import { authApi } from '../api/endpoints';
import { usePublicConfig } from '../api/queries';
import { useAuth } from '../auth/auth-context';
import { useCompany, useCompanyPath } from '../company/company-context';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { SignInLinkForm } from '../features/portal/SignInLinkForm';
import { PasswordInput } from '../features/auth/PasswordInput';
import { useDocumentTitle } from '../lib/hooks';

const SHOW_DEMO_ACCOUNTS =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

/** The seed script creates these accounts in every demo company. */
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@example.com', password: 'Admin123!' },
  { label: 'Agent', email: 'agent@example.com', password: 'Agent123!' },
  { label: 'Customer', email: 'customer@example.com', password: 'Customer123!' },
];

export default function LoginPage() {
  const company = useCompany();
  const companyPath = useCompanyPath();
  const location = useLocation();
  const { login } = useAuth();
  const [formError, setFormError] = useState<string>();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>();
  useDocumentTitle(`Sign in to ${company.name}`);
  const { data: config } = usePublicConfig();
  const showDemoAccounts = SHOW_DEMO_ACCOUNTS || config?.demo === true;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: (location.state as { email?: string } | null)?.email ?? '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginInput) => {
    setFormError(undefined);
    setUnverifiedEmail(undefined);
    try {
      await login(values);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(values.email);
      } else if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setFormError('Too many attempts. Please wait a minute and try again.');
      } else {
        setFormError(getErrorMessage(error));
      }
    }
  };

  const resend = async () => {
    if (!unverifiedEmail) return;
    try {
      await authApi.resendVerification({ companySlug: company.slug, email: unverifiedEmail });
      toast.success(`We sent a new confirmation link to ${unverifiedEmail}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AuthLayout
      brand={company.name}
      title="Sign in"
      subtitle={
        company.allowRegistration ? (
          <>
            New to {company.name}?{' '}
            <Link
              to={companyPath('/register')}
              className="font-medium text-brand-600 hover:text-brand-800"
            >
              Create an account
            </Link>
          </>
        ) : (
          `Use your ${company.name} account.`
        )
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {formError && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            {formError}
          </div>
        )}
        {unverifiedEmail && (
          <div
            role="alert"
            className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200"
          >
            Please confirm your email address first — check your inbox for the link.{' '}
            <button type="button" onClick={resend} className="font-medium underline">
              Send a new link
            </button>
          </div>
        )}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>
        <div className="-mt-2 text-right">
          <Link
            to={companyPath('/forgot-password')}
            className="text-sm font-medium text-brand-600 hover:text-brand-800"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <details className="group mt-6 rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-700 marker:text-slate-400">
          No password? Get a sign-in link by email
        </summary>
        <div className="mt-3">
          <SignInLinkForm companySlug={company.slug} companyName={company.name} />
        </div>
      </details>

      <p className="mt-4 text-center text-sm text-slate-500">
        Not your company?{' '}
        <Link to="/find" className="font-medium text-brand-600 hover:text-brand-800">
          Find your company
        </Link>
      </p>

      {showDemoAccounts && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4">
          <p className="text-xs font-medium text-slate-500">Demo accounts (from the seed script)</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setValue('email', account.email, { shouldValidate: true });
                  setValue('password', account.password, { shouldValidate: true });
                }}
              >
                {account.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
