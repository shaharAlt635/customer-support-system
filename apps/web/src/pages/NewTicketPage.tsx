import { zodResolver } from '@hookform/resolvers/zod';
import {
  PRIORITY_LABELS,
  TICKET_PRIORITIES,
  createTicketSchema,
  isStaff,
} from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ticketsApi } from '../api/endpoints';
import { useCategories } from '../api/queries';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { FilePicker } from '../components/ui/FilePicker';
import { Input, Select, Textarea } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { handleFormError } from '../lib/form-errors';
import { useDocumentTitle } from '../lib/hooks';
import { useCurrentUser } from '../auth/auth-context';
import { useCompany, useCompanyPath } from '../company/company-context';

// Same rules as the API, adapted to form controls (selects always produce strings).
const formSchema = createTicketSchema.extend({
  priority: z.enum(TICKET_PRIORITIES),
  categoryId: z.string(),
  isAnonymous: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const PRIORITY_HINTS: Record<(typeof TICKET_PRIORITIES)[number], string> = {
  LOW: 'General question, no time pressure',
  MEDIUM: 'Something is not working as expected',
  HIGH: 'Important functionality is affected',
  URGENT: 'Business is blocked — needs immediate attention',
};

export default function NewTicketPage() {
  const companyPath = useCompanyPath();
  const company = useCompany();
  const user = useCurrentUser();
  const customer = !isStaff(user.role);
  useDocumentTitle('New ticket');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: categories = [] } = useCategories();
  const [files, setFiles] = useState<File[]>([]);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: '',
      description: '',
      priority: 'MEDIUM',
      categoryId: '',
      isAnonymous: false,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      ticketsApi.create(
        {
          ...values,
          categoryId: values.categoryId || undefined,
          isAnonymous: values.isAnonymous || undefined,
        },
        files,
      ),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast.success(`Ticket #${ticket.number} created`);
      navigate(companyPath(`/tickets/${ticket.id}`));
    },
    onError: (error) =>
      handleFormError(error, setError, ['subject', 'description', 'priority', 'categoryId']),
  });

  const priority = useWatch({ control, name: 'priority' });

  const description = useWatch({ control, name: 'description' });

  if (customer && !company.allowAccountTickets) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Create a ticket"
          description={`${company.name} isn't taking new requests online right now. You can still follow your existing tickets.`}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={companyPath('/tickets')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to tickets
      </Link>
      <PageHeader
        title="Create a ticket"
        description="Describe the problem in as much detail as you can — it helps us help you faster."
      />

      <Card>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
          <CardContent className="space-y-5 py-6">
            <Field label="Subject" htmlFor="subject" error={errors.subject?.message}>
              <Input
                id="subject"
                placeholder="e.g. Unable to download my invoice"
                invalid={Boolean(errors.subject)}
                autoFocus
                {...register('subject')}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Category"
                htmlFor="categoryId"
                optional
                error={errors.categoryId?.message}
              >
                <Select id="categoryId" {...register('categoryId')}>
                  <option value="">Choose a category…</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Priority"
                htmlFor="priority"
                hint={PRIORITY_HINTS[priority]}
                error={errors.priority?.message}
              >
                <Select id="priority" {...register('priority')}>
                  {TICKET_PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Description"
              htmlFor="description"
              error={errors.description?.message}
              hint={`${description.length.toLocaleString()} / 10,000 · Include steps to reproduce, what you expected and what happened.`}
            >
              <Textarea
                id="description"
                rows={8}
                placeholder="What happened? When did it start?"
                invalid={Boolean(errors.description)}
                {...register('description')}
              />
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Attachments</p>
              <FilePicker files={files} onChange={setFiles} disabled={mutation.isPending} />
            </div>

            {customer && company.allowAnonymousTickets && (
              <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-slate-300"
                  {...register('isAnonymous')}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">
                    <EyeOff className="size-4 text-slate-400" aria-hidden /> Submit anonymously
                  </span>
                  <span className="block text-xs text-slate-500">
                    The {company.name} team won&apos;t see your name or email.
                  </span>
                </span>
              </label>
            )}
          </CardContent>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:justify-end sm:rounded-b-xl">
            <Button variant="secondary" onClick={() => navigate(-1)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Submit ticket
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
