import { zodResolver } from '@hookform/resolvers/zod';
import { type CategoryDTO, categorySchema } from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { getErrorMessage } from '../api/client';
import { categoriesApi } from '../api/endpoints';
import { useCategories } from '../api/queries';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input, Textarea } from '../components/ui/Input';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { handleFormError } from '../lib/form-errors';
import { pluralize } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const SWATCHES = [
  '#6366f1',
  '#3b82f6',
  '#06b6d4',
  '#22c55e',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#64748b',
];

const formSchema = categorySchema.extend({
  description: z.string().trim().max(200, 'Description must be at most 200 characters'),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };
}

function CategoryModal({
  category,
  onClose,
}: {
  category: CategoryDTO | null;
  onClose: () => void;
}) {
  const invalidate = useInvalidateCategories();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: category?.name ?? '',
      description: category?.description ?? '',
      color: category?.color ?? SWATCHES[0],
      isActive: category?.isActive ?? true,
    },
  });
  const color = useWatch({ control, name: 'color' });

  const onSubmit = async (values: FormValues) => {
    const input = { ...values, description: values.description || null };
    try {
      if (category) await categoriesApi.update(category.id, input);
      else await categoriesApi.create(input);
      invalidate();
      toast.success(category ? 'Category updated' : 'Category created');
      onClose();
    } catch (error) {
      handleFormError(error, setError, ['name', 'description', 'color', 'isActive']);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={isSubmitting}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Name" htmlFor="category-name" error={errors.name?.message}>
          <Input id="category-name" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field
          label="Description"
          htmlFor="category-description"
          optional
          error={errors.description?.message}
        >
          <Textarea id="category-description" rows={2} {...register('description')} />
        </Field>
        <Field label="Colour" htmlFor="category-color" error={errors.color?.message}>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() =>
                  setValue('color', swatch, { shouldDirty: true, shouldValidate: true })
                }
                className="size-7 rounded-full ring-offset-2 transition data-[selected=true]:ring-2 data-[selected=true]:ring-slate-900"
                data-selected={color.toLowerCase() === swatch}
                style={{ backgroundColor: swatch }}
                aria-label={`Use colour ${swatch}`}
              />
            ))}
            <Input
              id="category-color"
              className="ml-1 w-28 font-mono"
              invalid={Boolean(errors.color)}
              {...register('color')}
            />
          </div>
        </Field>
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            {...register('isActive')}
          />
          <span>
            <span className="font-medium text-slate-800">Active</span>
            <span className="block text-xs text-slate-500">
              Inactive categories stay on existing tickets but can't be chosen for new ones.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

export default function CategoriesPage() {
  useDocumentTitle('Categories');
  const { data: categories, isPending, isError, error, refetch } = useCategories(true);
  const invalidate = useInvalidateCategories();
  const [editing, setEditing] = useState<CategoryDTO | null | 'new'>(null);
  const [deleting, setDeleting] = useState<CategoryDTO | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Category deleted');
      setDeleting(null);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
      setDeleting(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Categories"
        description="Organise tickets so they reach the right people and show up in reports."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> New category
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {isPending ? (
          <SectionSpinner />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create categories like Billing or Technical Support to organise incoming tickets."
            action={
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" /> New category
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center gap-4 px-5 py-4">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {category.name}
                    {!category.isActive && <Badge>Inactive</Badge>}
                  </p>
                  {category.description && (
                    <p className="truncate text-xs text-slate-500">{category.description}</p>
                  )}
                </div>
                <span className="hidden text-xs text-slate-500 sm:block">
                  {pluralize(category.ticketCount, 'ticket')}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditing(category)}
                    aria-label={`Edit ${category.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleting(category)}
                    aria-label={`Delete ${category.name}`}
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <CategoryModal
          key={editing === 'new' ? 'new' : editing.id}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description={
          deleting?.ticketCount
            ? `This category is used by ${pluralize(deleting.ticketCount, 'ticket')}, so it can't be deleted. Deactivate it instead to hide it from new tickets.`
            : 'This permanently removes the category.'
        }
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
