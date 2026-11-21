import { zodResolver } from '@hookform/resolvers/zod';
import { emailSchema } from '@support-desk/shared';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { authApi } from '../api/endpoints';
import { usePublicConfig } from '../api/queries';
import { useCompany, useCompanyPath } from '../company/company-context';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { useCaptcha } from '../features/captcha/useCaptcha';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';

const formSchema = z.object({ email: emailSchema });
type FormValues = z.infer<typeof formSchema>;

export default function ForgotPasswordPage() {
  const company = useCompany();
  const companyPath = useCompanyPath();
  const { data: config } = usePublicConfig();
  const [sentTo, setSentTo] = useState<string>();
  const captcha = useCaptcha();
  useDocumentTitle('Reset your password');

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { email: '' } });

  const onSubmit = async ({ email }: FormValues) => {
    try {
      await authApi.forgotPassword({ companySlug: company.slug, email }, captcha.token);
      setSentTo(email);
    } catch (error) {
      handleFormError(error, setError, ['email']);
      captcha.reset();
    }
  };

  const backLink = (
    <Link to={companyPath('/login')} className="font-medium text-brand-600 hover:text-brand-800">
      Back to sign in
    </Link>
  );

  return (
    <AuthLayout brand={company.name} title="Reset your password" subtitle={backLink}>
      {sentTo ? (
        <div className="rounded-xl bg-brand-50 p-5 ring-1 ring-brand-100">
          <MailCheck className="size-8 text-brand-600" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-slate-900">Check your inbox</h2>
          <p className="mt-1 text-sm text-slate-600">
            If <strong className="font-medium text-slate-900">{sentTo}</strong> has a {company.name}{' '}
            account, we sent it a link to choose a new password. The link is valid for 1 hour.
          </p>
          {config?.devMailbox && (
            <Link
              to="/dev/mailbox"
              className="mt-4 inline-block text-sm font-medium text-brand-700 hover:text-brand-900"
            >
              Open dev mailbox →
            </Link>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <p className="text-sm text-slate-600">
            Enter the email you use for {company.name} and we&apos;ll send you a reset link.
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
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
