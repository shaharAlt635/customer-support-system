import { zodResolver } from '@hookform/resolvers/zod';
import {
  PRIORITY_LABELS,
  type PublicCompanyDTO,
  TICKET_PRIORITIES,
  createTicketSchema,
  emailSchema,
} from '@support-desk/shared';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { portalApi, ticketsApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { FilePicker } from '../../components/ui/FilePicker';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { textColorOn } from '../../lib/color';
import { handleFormError } from '../../lib/form-errors';
import { useCaptcha } from '../captcha/useCaptcha';

const baseSchema = createTicketSchema.extend({
  priority: z.enum(TICKET_PRIORITIES),
  categoryId: z.string(),
  isAnonymous: z.boolean(),
  name: z.string().trim().max(80, 'Name must be at most 80 characters'),
  email: z.string(),
  website: z.string(),
});
type FormValues = z.infer<typeof baseSchema>;

/** Guests must give an email (and a name unless they stay anonymous). */
const guestSchema = baseSchema
  .extend({ email: emailSchema })
  .refine((values) => values.isAnonymous || values.name.length >= 2, {
    path: ['name'],
    message: 'Please tell us your name',
  });

interface TicketRequestFormProps {
  company: PublicCompanyDTO;
  /** `guest`: not signed in, confirmed by email. `account`: signed in. */
  mode: 'guest' | 'account';
  onGuestSubmitted?: (email: string) => void;
  onAccountSubmitted?: (ticketId: string) => void;
}

export function TicketRequestForm({
  company,
  mode,
  onGuestSubmitted,
  onAccountSubmitted,
}: TicketRequestFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const { data: categories = [] } = useQuery({
    queryKey: ['portal-categories', company.slug],
    queryFn: async () => (await portalApi.categories(company.slug)).data,
    staleTime: 5 * 60_000,
  });

  // Guests may only stay anonymous when the company allows it; if it allows *only*
  // anonymous requests, anonymity is the only option.
  const anonymousOnly = mode === 'guest' && !company.allowGuestTickets;
  const canChooseAnonymous = company.allowAnonymousTickets && !anonymousOnly;

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'guest' ? guestSchema : baseSchema),
    defaultValues: {
      subject: '',
      description: '',
      priority: 'MEDIUM',
      categoryId: '',
      isAnonymous: anonymousOnly,
      name: '',
      email: '',
      website: '',
    },
  });
  const isAnonymous = useWatch({ control, name: 'isAnonymous' });
  // Only visitors who aren't signed in go through the human check.
  const captcha = useCaptcha();
  const guestCaptcha = mode === 'guest';

  const onSubmit = async (values: FormValues) => {
    const ticket = {
      subject: values.subject,
      description: values.description,
      priority: values.priority,
      categoryId: values.categoryId || undefined,
      isAnonymous: values.isAnonymous || undefined,
    };
    try {
      if (mode === 'guest') {
        const result = await portalApi.submit(
          company.slug,
          {
            ...ticket,
            email: values.email,
            name: values.isAnonymous ? undefined : values.name || undefined,
            website: values.website || undefined,
          },
          files,
          captcha.token,
        );
        onGuestSubmitted?.(result.email);
      } else {
        const created = await ticketsApi.create(ticket, files);
        onAccountSubmitted?.(created.id);
      }
    } catch (error) {
      handleFormError(error, setError, [
        'subject',
        'description',
        'priority',
        'categoryId',
        'name',
        'email',
      ]);
      if (guestCaptcha) captcha.reset();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {mode === 'guest' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!isAnonymous && (
            <Field label="Your name" htmlFor="request-name" error={errors.name?.message}>
              <Input
                id="request-name"
                autoComplete="name"
                invalid={Boolean(errors.name)}
                {...register('name')}
              />
            </Field>
          )}
          <Field
            label="Email"
            htmlFor="request-email"
            error={errors.email?.message}
            hint="We'll send a link to confirm and follow your request."
            className={isAnonymous ? 'sm:col-span-2' : undefined}
          >
            <Input
              id="request-email"
              type="email"
              autoComplete="email"
              invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </Field>
        </div>
      )}

      {(canChooseAnonymous || anonymousOnly) && (
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            disabled={anonymousOnly}
            {...register('isAnonymous')}
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-slate-800">
              <EyeOff className="size-4 text-slate-400" aria-hidden /> Submit anonymously
            </span>
            <span className="block text-xs text-slate-500">
              The {company.name} team won&apos;t see your name or email. Your email is only used to{' '}
              {mode === 'guest' ? 'confirm the request and ' : ''}let you follow it.
            </span>
          </span>
        </label>
      )}

      <Field label="Subject" htmlFor="request-subject" error={errors.subject?.message}>
        <Input
          id="request-subject"
          placeholder="Summarise the problem in a few words"
          invalid={Boolean(errors.subject)}
          {...register('subject')}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="request-category" optional>
          <Select id="request-category" {...register('categoryId')}>
            <option value="">Choose a category…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="request-priority">
          <Select id="request-priority" {...register('priority')}>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="How can we help?"
        htmlFor="request-description"
        error={errors.description?.message}
      >
        <Textarea
          id="request-description"
          rows={6}
          placeholder="What happened, and what did you expect?"
          invalid={Boolean(errors.description)}
          {...register('description')}
        />
      </Field>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-700">Attachments</p>
        <FilePicker files={files} onChange={setFiles} disabled={isSubmitting} />
      </div>

      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" {...register('website')} />
        </label>
      </div>

      {guestCaptcha && captcha.widget}

      <Button
        type="submit"
        size="lg"
        loading={isSubmitting}
        disabled={guestCaptcha && !captcha.ready}
        className="w-full sm:w-auto"
        style={{ backgroundColor: company.brandColor, color: textColorOn(company.brandColor) }}
      >
        {!isSubmitting && <Send className="size-4" />}
        {mode === 'guest' ? 'Send request' : 'Submit ticket'}
      </Button>
    </form>
  );
}
