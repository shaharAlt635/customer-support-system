import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterInput, registerSchema } from '@support-desk/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { useCompany, useCompanyPath } from '../company/company-context';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { CheckEmailNotice } from '../features/auth/CheckEmailNotice';
import { PasswordInput } from '../features/auth/PasswordInput';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';

export default function RegisterPage() {
  const company = useCompany();
  const [params] = useSearchParams();
  const companyPath = useCompanyPath();
  const { register: signUp } = useAuth();
  const [pendingEmail, setPendingEmail] = useState<string>();
  useDocumentTitle(`Create a ${company.name} account`);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // Invitation emails link here with ?email= so the invited address is pre-filled.
    defaultValues: { name: '', email: params.get('email') ?? '', password: '' },
  });

  if (!company.allowRegistration) return <Navigate to={companyPath('/login')} replace />;

  const onSubmit = async (values: RegisterInput) => {
    try {
      const result = await signUp(values);
      setPendingEmail(result.email);
    } catch (error) {
      handleFormError(error, setError, ['name', 'email', 'password']);
    }
  };

  const signInLink = (
    <>
      Already have an account?{' '}
      <Link to={companyPath('/login')} className="font-medium text-brand-600 hover:text-brand-800">
        Sign in
      </Link>
    </>
  );

  if (pendingEmail) {
    return (
      <AuthLayout brand={company.name} title="Almost there" subtitle={signInLink}>
        <CheckEmailNotice email={pendingEmail} companySlug={company.slug} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      brand={company.name}
      title={`Create your ${company.name} account`}
      subtitle={signInLink}
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
