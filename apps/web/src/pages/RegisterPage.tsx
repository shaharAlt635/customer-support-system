import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterInput, registerSchema } from '@support-desk/shared';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router';
import { usePublicConfig } from '../api/queries';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { FullPageSpinner } from '../components/ui/Spinner';
import { AuthLayout } from '../features/auth/AuthLayout';
import { PasswordInput } from '../features/auth/PasswordInput';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';

export default function RegisterPage() {
  useDocumentTitle('Create account');
  const { register: signUp } = useAuth();
  const { data: config, isPending } = usePublicConfig();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  if (isPending) return <FullPageSpinner />;
  if (config && !config.allowRegistration) return <Navigate to="/login" replace />;

  const onSubmit = async (values: RegisterInput) => {
    try {
      await signUp(values);
    } catch (error) {
      handleFormError(error, setError, ['name', 'email', 'password']);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-800">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            autoComplete="name"
            autoFocus
            invalid={Boolean(errors.name)}
            {...register('name')}
          />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint="At least 8 characters, including a letter and a number."
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
