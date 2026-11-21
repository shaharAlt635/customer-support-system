import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@support-desk/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError, getErrorMessage } from '../api/client';
import { authApi } from '../api/endpoints';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { AuthLayout } from '../features/auth/AuthLayout';
import { PasswordInput } from '../features/auth/PasswordInput';
import { useDocumentTitle } from '../lib/hooks';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((data) => data.password === data.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async ({ password }: FormValues) => {
    try {
      const { company } = await authApi.resetPassword({ token, password });
      toast.success('Password updated. Sign in with your new password.');
      navigate(`/${company.slug}/login`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_TOKEN') {
        setError('root', { message: error.message });
      } else if (error instanceof ApiError && error.details[0]?.path === 'password') {
        setError('password', { message: error.details[0].message });
      } else {
        toast.error(getErrorMessage(error));
      }
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Signing in with the new password will sign you out everywhere else."
    >
      {!token || errors.root ? (
        <div className="rounded-xl bg-red-50 p-5 text-sm text-red-800 ring-1 ring-red-200">
          {errors.root?.message ?? 'This link is missing its token.'} Request a new link from your
          company&apos;s sign-in page.
          <div className="mt-3">
            <Link to="/" className="font-medium text-red-900 underline">
              Go to the home page
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <Field
            label="New password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 8 characters, including a letter and a number."
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              autoFocus
              invalid={Boolean(errors.password)}
              {...register('password')}
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              invalid={Boolean(errors.confirm)}
              {...register('confirm')}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
