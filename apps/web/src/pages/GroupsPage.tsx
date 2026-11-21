import { zodResolver } from '@hookform/resolvers/zod';
import {
  ALL_PERMISSIONS,
  type GroupDTO,
  PERMISSION_CATALOG,
  type Permission,
  groupSchema,
} from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { getErrorMessage } from '../api/client';
import { groupsApi } from '../api/endpoints';
import { queryKeys, useGroups } from '../api/queries';
import { useCurrentUser } from '../auth/auth-context';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input, Textarea } from '../components/ui/Input';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { cn } from '../lib/cn';
import { handleFormError } from '../lib/form-errors';
import { pluralize } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const formSchema = groupSchema.extend({
  description: z.string().trim().max(200, 'Description must be at most 200 characters'),
  isDefault: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const LABELS = new Map(
  PERMISSION_CATALOG.flatMap((category) => category.permissions).map((p) => [p.key, p.label]),
);

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function GroupEditor({ group, onClose }: { group: GroupDTO | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: group?.name ?? '',
      description: group?.description ?? '',
      permissions: group?.permissions ?? [],
      isDefault: group?.isDefault ?? false,
    },
  });
  const permissions = useWatch({ control, name: 'permissions' });
  const selected = new Set<Permission>(permissions);

  const setPermissions = (next: Set<Permission>) =>
    setValue(
      'permissions',
      ALL_PERMISSIONS.filter((p) => next.has(p)),
      { shouldDirty: true },
    );
  const toggle = (permission: Permission, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(permission);
    else next.delete(permission);
    setPermissions(next);
  };

  const onSubmit = async (values: FormValues) => {
    const input = { ...values, description: values.description || null };
    try {
      if (group) await groupsApi.update(group.id, input);
      else await groupsApi.create(input);
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      void queryClient.invalidateQueries({ queryKey: ['team'] });
      toast.success(group ? 'Group updated' : 'Group created');
      onClose();
    } catch (error) {
      handleFormError(error, setError, ['name', 'description', 'permissions', 'isDefault']);
    }
  };

  const isMyGroup = group && me.group?.id === group.id;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={group ? `Edit “${group.name}”` : 'New permission group'}
      description="Changes apply to every member of the group right away."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="group-form" loading={isSubmitting}>
            {group ? 'Save changes' : 'Create group'}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="group-name" error={errors.name?.message}>
            <Input id="group-name" invalid={Boolean(errors.name)} {...register('name')} />
          </Field>
          <Field
            label="Description"
            htmlFor="group-description"
            optional
            error={errors.description?.message}
          >
            <Textarea id="group-description" rows={1} {...register('description')} />
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            disabled={group?.isDefault}
            className="mt-0.5 size-4 rounded border-slate-300"
            {...register('isDefault')}
          />
          <span>
            <span className="font-medium text-slate-800">Default for new invitations</span>
            <span className="block text-xs text-slate-500">
              {group?.isDefault
                ? 'To change the default, edit another group and make it the default.'
                : 'Pre-selected when inviting agents.'}
            </span>
          </span>
        </label>

        {isMyGroup && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            You are a member of this group — removing permissions here also removes them from you.
          </p>
        )}

        {PERMISSION_CATALOG.map((category) => {
          const all = category.permissions.every((p) => selected.has(p.key));
          return (
            <section key={category.category}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  {category.category}
                </h3>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:text-brand-800"
                  onClick={() => {
                    const next = new Set(selected);
                    for (const p of category.permissions) {
                      if (all) next.delete(p.key);
                      else next.add(p.key);
                    }
                    setPermissions(next);
                  }}
                >
                  {all ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="divide-y divide-slate-50">
                {category.permissions.map((permission) => (
                  <Toggle
                    key={permission.key}
                    checked={selected.has(permission.key)}
                    onChange={(on) => toggle(permission.key, on)}
                    label={permission.label}
                    description={permission.description}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </form>
    </Modal>
  );
}

export default function GroupsPage() {
  useDocumentTitle('Permission groups');
  const queryClient = useQueryClient();
  const { data: groups, isPending, isError, error, refetch } = useGroups();
  const [editing, setEditing] = useState<GroupDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GroupDTO | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => groupsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      toast.success('Group deleted');
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
        title="Permission groups"
        description="Bundle permissions into groups and give each agent the group that fits their job."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> New group
          </Button>
        }
      />

      {isPending ? (
        <SectionSpinner />
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="No groups yet" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {group.name}
                    {group.isDefault && <Badge tone="indigo">Default</Badge>}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {pluralize(group.memberCount, 'member')} ·{' '}
                    {group.permissions.length === ALL_PERMISSIONS.length
                      ? 'All permissions'
                      : pluralize(group.permissions.length, 'permission')}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditing(group)}
                    aria-label={`Edit ${group.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleting(group)}
                    aria-label={`Delete ${group.name}`}
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
              </div>
              {group.description && (
                <p className="mt-3 text-sm text-slate-600">{group.description}</p>
              )}
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {group.permissions.length === 0 ? (
                  <li className="text-xs text-slate-400">No permissions</li>
                ) : (
                  group.permissions.map((permission) => (
                    <li
                      key={permission}
                      className={cn(
                        'rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600',
                      )}
                    >
                      {LABELS.get(permission) ?? permission}
                    </li>
                  ))
                )}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <GroupEditor
          key={editing === 'new' ? 'new' : editing.id}
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description={
          deleting?.memberCount
            ? `${pluralize(deleting.memberCount, 'agent')} still use this group. Move them to another group first.`
            : 'This permanently removes the group.'
        }
        confirmLabel="Delete group"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
