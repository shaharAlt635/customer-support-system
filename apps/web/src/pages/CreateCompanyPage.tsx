import { zodResolver } from '@hookform/resolvers/zod';
import { type CreateCompanyInput, createCompanySchema } from '@support-desk/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { companiesApi } from '../api/endpoints';
import { usePublicConfig } from '../api/queries';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../features/auth/AuthLayout';
import { CheckEmailNotice } from '../features/auth/CheckEmailNotice';
import { PasswordInput } from '../features/auth/PasswordInput';
import { useCaptcha } from '../features/captcha/useCaptcha';
import { handleFormError } from '../lib/form-errors';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks';

/** "Acme Inc." → "acme-inc" */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function SlugStatus({ slug }: { slug: string }) {
  const debounced = useDebouncedValue(slug.trim().toLowerCase(), 350);
  const { data, isFetching } = useQuery({
    queryKey: ['check-slug', debounced],
    queryFn: ({ signal }) => companiesApi.checkSlug(debounced, signal),
    enabled: debounced.length >= 3,
    staleTime: 30_000,
  });

  if (debounced.length < 3) return null;
  if (isFetching || debounced !== slug.trim().toLowerCase()) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-500">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Checking…
      </span>
    );
  }
  if (!data) return null;
  return data.available ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <CircleCheck className="size-3.5" aria-hidden /> Available
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-600">
      <CircleAlert className="size-3.5" aria-hidden /> {data.reason ?? 'Not available'}
    </span>
  );
}

export default function CreateCompanyPage() {
  useDocumentTitle('Create your company');
  const { data: config } = usePublicConfig();
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState<{ email: string; slug: string }>();
  const captcha = useCaptcha();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { companyName: '', slug: '', name: '', email: '', password: '' },
  });
  const slug = useWatch({ control, name: 'slug' });

  const companyNameField = register('companyName', {
    onChange: (event: { target: { value: string } }) => {
      if (!slugEdited) setValue('slug', slugify(event.target.value));
    },
  });
  const slugField = register('slug', { onChange: () => setSlugEdited(true) });

  const onSubmit = async (values: CreateCompanyInput) => {
    try {
      const result = await companiesApi.create(values, captcha.token);
      setPending({ email: result.email, slug: result.company.slug });
    } catch (error) {
      handleFormError(error, setError, ['companyName', 'slug', 'name', 'email', 'password']);
      captcha.reset();
    }
  };

  const signInHint = (
    <>
      Already have a company?{' '}
      <Link to="/find" className="font-medium text-brand-600 hover:text-brand-800">
        Find its sign-in page
      </Link>
    </>
  );

  if (pending) {
    return (
      <AuthLayout title="Confirm your email" subtitle={signInHint}>
        <CheckEmailNotice
          email={pending.email}
          companySlug={pending.slug}
          message="Your company is ready. To activate it, click the link we sent to"
        />
        <p className="mt-6 text-sm text-slate-500">
          After confirming, your help desk lives at{' '}
          <span className="font-medium text-slate-800">
            {window.location.host}/{pending.slug}
          </span>
          .
        </p>
      </AuthLayout>
    );
  }

  if (config && !config.allowCompanySignup) {
    return (
      <AuthLayout title="Sign-ups are closed" subtitle={signInHint}>
        <p className="text-sm text-slate-600">
          Creating new companies is currently disabled on this installation.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your company"
      subtitle="Set up a help desk for your team in under a minute. You'll be its manager."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Field label="Company name" htmlFor="companyName" error={errors.companyName?.message}>
          <Input
            id="companyName"
            autoFocus
            placeholder="Acme Inc."
            invalid={Boolean(errors.companyName)}
            {...companyNameField}
          />
        </Field>

        <Field
          label="Company address"
          htmlFor="slug"
          error={errors.slug?.message}
          hint={<SlugStatus slug={slug} />}
        >
          <div className="flex rounded-lg shadow-sm">
            <span className="inline-flex items-center rounded-l-lg bg-slate-50 px-3 text-sm text-slate-500 ring-1 ring-slate-300 ring-inset">
              {window.location.host}/
            </span>
            <Input
              id="slug"
              placeholder="acme"
              autoCapitalize="none"
              spellCheck={false}
              invalid={Boolean(errors.slug)}
              className="-ml-px rounded-l-none shadow-none"
              {...slugField}
            />
          </div>
        </Field>

        <div className="border-t border-slate-100 pt-5">
          <p className="mb-4 text-sm font-medium text-slate-900">Your manager account</p>
          <div className="space-y-5">
            <Field label="Full name" htmlFor="name" error={errors.name?.message}>
              <Input
                id="name"
                autoComplete="name"
                invalid={Boolean(errors.name)}
                {...register('name')}
              />
            </Field>
            <Field label="Work email" htmlFor="email" error={errors.email?.message}>
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
          </div>
        </div>

        {captcha.widget}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={isSubmitting}
          disabled={!captcha.ready}
        >
          Create company
        </Button>
      </form>
    </AuthLayout>
  );
}
