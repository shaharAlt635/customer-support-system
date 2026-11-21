import { zodResolver } from '@hookform/resolvers/zod';
import { companySettingsSchema } from '@support-desk/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { companyApi } from '../api/endpoints';
import { useCompany, useCompanyPath } from '../company/company-context';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input, Textarea } from '../components/ui/Input';
import { textColorOn } from '../lib/color';
import { PageHeader } from '../components/ui/PageHeader';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';

const formSchema = companySettingsSchema.extend({
  allowAccountTickets: z.boolean(),
  allowGuestTickets: z.boolean(),
  allowAnonymousTickets: z.boolean(),
  portalTitle: z.string().trim().max(100, 'Keep the title under 100 characters'),
  portalMessage: z.string().trim().max(1000, 'Keep the message under 1,000 characters'),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour such as #4f46e5'),
});
type FormValues = z.infer<typeof formSchema>;

const SUBMISSION_OPTIONS: {
  name: 'allowAccountTickets' | 'allowGuestTickets' | 'allowAnonymousTickets';
  label: string;
  description: string;
}[] = [
  {
    name: 'allowAccountTickets',
    label: 'Registered customers',
    description: 'Visitors can create an account and open tickets while signed in.',
  },
  {
    name: 'allowGuestTickets',
    label: 'Guests',
    description:
      'Anyone can send a request with their name and email. It reaches you after they confirm the email.',
  },
  {
    name: 'allowAnonymousTickets',
    label: 'Anonymous requests',
    description:
      "Submitters can tick “Submit anonymously”. You'll see “Anonymous” instead of their name and email; they still confirm their email and get replies.",
  },
];

export default function CompanySettingsPage() {
  useDocumentTitle('Company settings');
  const company = useCompany();
  const companyPath = useCompanyPath();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
    control,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: company.name,
      allowAccountTickets: company.allowAccountTickets,
      allowGuestTickets: company.allowGuestTickets,
      allowAnonymousTickets: company.allowAnonymousTickets,
      portalTitle: company.portalTitle ?? '',
      portalMessage: company.portalMessage ?? '',
      brandColor: company.brandColor,
    },
  });
  const brandColor = useWatch({ control, name: 'brandColor' });
  const validColor = /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : company.brandColor;

  const onSubmit = async (values: FormValues) => {
    try {
      const updated = await companyApi.update({
        ...values,
        portalTitle: values.portalTitle || null,
        portalMessage: values.portalMessage || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['company', company.slug] });
      reset({
        name: updated.name,
        allowAccountTickets: updated.allowAccountTickets,
        allowGuestTickets: updated.allowGuestTickets,
        allowAnonymousTickets: updated.allowAnonymousTickets,
        portalTitle: updated.portalTitle ?? '',
        portalMessage: updated.portalMessage ?? '',
        brandColor: updated.brandColor,
      });
      toast.success('Company updated');
    } catch (error) {
      handleFormError(error, setError, ['name', 'portalTitle', 'portalMessage', 'brandColor']);
    }
  };

  const publicUrl = `${window.location.origin}/${company.slug}`;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Company" description="How your company appears to customers and agents." />
      <Card>
        <CardHeader title="Profile" />
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-5">
            <Field label="Company name" htmlFor="company-name" error={errors.name?.message}>
              <Input id="company-name" invalid={Boolean(errors.name)} {...register('name')} />
            </Field>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Address</p>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
                <span className="truncate font-mono text-slate-700">{publicUrl}</span>
                <Link
                  to={companyPath('/')}
                  target="_blank"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
                >
                  Open <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                Share this link with customers. The address can&apos;t be changed.
              </p>
            </div>
          </CardContent>

          <div className="border-t border-slate-100">
            <CardHeader
              title="Ticket page"
              description="Who can open tickets on your public page, and how it looks."
            />
            <CardContent className="space-y-5">
              <div className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {SUBMISSION_OPTIONS.map((option) => (
                  <label key={option.name} className="flex items-start gap-3 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 rounded border-slate-300"
                      {...register(option.name)}
                    />
                    <span>
                      <span className="font-medium text-slate-800">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Field
                label="Headline"
                htmlFor="portal-title"
                optional
                error={errors.portalTitle?.message}
              >
                <Input
                  id="portal-title"
                  placeholder="How can we help?"
                  {...register('portalTitle')}
                />
              </Field>
              <Field
                label="Welcome message"
                htmlFor="portal-message"
                optional
                error={errors.portalMessage?.message}
              >
                <Textarea
                  id="portal-message"
                  rows={3}
                  placeholder={`Send a request to the ${company.name} support team and we'll get back to you by email.`}
                  {...register('portalMessage')}
                />
              </Field>
              <Field label="Brand colour" htmlFor="brand-color" error={errors.brandColor?.message}>
                <div className="flex items-center gap-3">
                  <Input id="brand-color" className="w-32 font-mono" {...register('brandColor')} />
                  <span
                    className="inline-flex h-9 flex-1 items-center rounded-lg px-3 text-sm font-medium"
                    style={{ backgroundColor: validColor, color: textColorOn(validColor) }}
                  >
                    Preview — {company.name}
                  </span>
                </div>
              </Field>
            </CardContent>
          </div>
          <div className="flex justify-end border-t border-slate-100 px-5 py-3">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
