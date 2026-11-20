import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@support-desk/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { ApiError, getErrorMessage } from '../api/client';
import { usePublicConfig } from '../api/queries';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { PasswordInput } from '../features/auth/PasswordInput';
import { useDocumentTitle } from '../lib/hooks';

const SHOW_DEMO_ACCOUNTS =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@example.com', password: 'Admin123!' },
  { label: 'Agent', email: 'agent@example.com', password: 'Agent123!' },
  { label: 'Customer', email: 'customer@example.com', password: 'Customer123!' },
];

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const { data: config } = usePublicConfig();
  const [formError, setFormError] = useState<string>();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    setFormError(undefined);
    try {
      await login(values);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.code === 'RATE_LIMITED'
          ? 'Too many attempts. Please wait a minute and try again.'
          : getErrorMessage(error),
      );
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={
        config?.allowRegistration ? (
          <>
            New here?{' '}
            <Link to="/register" className="font-medium text-brand-600 hover:text-brand-800">
              Create a customer account
            </Link>
          </>
        ) : (
          'Sign in to your account to continue.'
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
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      {SHOW_DEMO_ACCOUNTS && (
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
