import { zodResolver } from '@hookform/resolvers/zod';
import { type FindCompanyInput, findCompanySchema } from '@support-desk/shared';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { companiesApi } from '../api/endpoints';
import { usePublicConfig } from '../api/queries';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { useCaptcha } from '../features/captcha/useCaptcha';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';

/** "Find my company": for people who don't remember their company's address. */
export default function FindCompanyPage() {
  useDocumentTitle('Find your company');
  const { data: config } = usePublicConfig();
  const [sentTo, setSentTo] = useState<string>();
  const captcha = useCaptcha();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FindCompanyInput>({
    resolver: zodResolver(findCompanySchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: FindCompanyInput) => {
    try {
      await companiesApi.find(email, captcha.token);
      setSentTo(email);
    } catch (error) {
      handleFormError(error, setError, ['email']);
      captcha.reset();
    }
  };

  const homeLink = (
    <>
      Know the address?{' '}
      <Link to="/" className="font-medium text-brand-600 hover:text-brand-800">
        Enter it on the home page
      </Link>
    </>
  );

  return (
    <AuthLayout title="Find your company" subtitle={homeLink}>
      {sentTo ? (
        <div className="rounded-xl bg-brand-50 p-5 ring-1 ring-brand-100">
          <MailCheck className="size-8 text-brand-600" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-slate-900">Check your inbox</h2>
          <p className="mt-1 text-sm text-slate-600">
            If <strong className="font-medium text-slate-900">{sentTo}</strong> has an account with
            any company on Support Desk, we sent it a list of them with a sign-in link for each.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {config?.devMailbox && (
              <Link to="/dev/mailbox" className="font-medium text-brand-700 hover:text-brand-900">
                Open dev mailbox →
              </Link>
            )}
            <button
              type="button"
              onClick={() => setSentTo(undefined)}
              className="font-medium text-slate-600 hover:text-slate-900"
            >
              Try another email
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <p className="text-sm text-slate-600">
            Enter your email and we&apos;ll send you the companies where you have an account. For
            privacy, the list is only sent by email.
          </p>
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
          {captcha.widget}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={isSubmitting}
            disabled={!captcha.ready}
          >
            Email me my companies
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
