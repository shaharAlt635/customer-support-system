import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateUserInput,
  ROLES,
  ROLE_LABELS,
  type Role,
  type UserDTO,
  createUserSchema,
  nameSchema,
  passwordSchema,
} from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { usersApi } from '../api/endpoints';
import { useUsers } from '../api/queries';
import { useCurrentUser } from '../auth/auth-context';
import { Avatar } from '../components/ui/Avatar';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input, Select } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { PasswordInput } from '../features/auth/PasswordInput';
import { handleFormError } from '../lib/form-errors';
import { formatDate, formatRelative } from '../lib/format';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks';

const ROLE_TONES: Record<Role, BadgeTone> = { ADMIN: 'violet', AGENT: 'blue', CUSTOMER: 'slate' };

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invalidate = useInvalidateUsers();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'AGENT' },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (values: CreateUserInput) => {
    try {
      const user = await usersApi.create(values);
      invalidate();
      toast.success(`${user.name} can now sign in`);
      close();
    } catch (error) {
      handleFormError(error, setError, ['name', 'email', 'password', 'role']);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a user"
      description="Create an account for a teammate or a customer. Share the password with them securely."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="create-user-form" loading={isSubmitting}>
            Create user
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4"
      >
        <Field label="Full name" htmlFor="new-user-name" error={errors.name?.message}>
          <Input id="new-user-name" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="Email" htmlFor="new-user-email" error={errors.email?.message}>
          <Input
            id="new-user-email"
            type="email"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>
        <Field
          label="Temporary password"
          htmlFor="new-user-password"
          error={errors.password?.message}
          hint="At least 8 characters, including a letter and a number."
        >
          <PasswordInput
            id="new-user-password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>
        <Field label="Role" htmlFor="new-user-role" error={errors.role?.message}>
          <Select id="new-user-role" {...register('role')}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

const editSchema = z.object({
  name: nameSchema,
  role: z.enum(ROLES),
  isActive: z.boolean(),
  password: z.union([z.literal(''), passwordSchema]),
});
type EditValues = z.infer<typeof editSchema>;

function EditUserModal({ user, onClose }: { user: UserDTO; onClose: () => void }) {
  const currentUser = useCurrentUser();
  const isSelf = currentUser.id === user.id;
  const invalidate = useInvalidateUsers();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: user.name, role: user.role, isActive: user.isActive, password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: EditValues) =>
      usersApi.update(user.id, {
        name: dirtyFields.name ? values.name : undefined,
        role: dirtyFields.role ? values.role : undefined,
        isActive: dirtyFields.isActive ? values.isActive : undefined,
        password: values.password || undefined,
      }),
    onSuccess: (updated) => {
      invalidate();
      toast.success(`${updated.name} updated`);
      onClose();
    },
    onError: (error) => handleFormError(error, setError, ['name', 'role', 'isActive', 'password']),
  });

  const nothingChanged = Object.keys(dirtyFields).length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      description={user.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-user-form"
            loading={isSubmitting || mutation.isPending}
            disabled={nothingChanged}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="edit-user-form"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        noValidate
        className="space-y-4"
      >
        <Field label="Full name" htmlFor="edit-user-name" error={errors.name?.message}>
          <Input id="edit-user-name" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field
          label="Role"
          htmlFor="edit-user-role"
          error={errors.role?.message}
          hint={
            isSelf ? 'You cannot change your own role.' : 'Changing the role signs the user out.'
          }
        >
          <Select id="edit-user-role" disabled={isSelf} {...register('role')}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Reset password"
          htmlFor="edit-user-password"
          optional
          error={errors.password?.message}
          hint="Leave empty to keep the current password."
        >
          <PasswordInput
            id="edit-user-password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            disabled={isSelf}
            className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            {...register('isActive')}
          />
          <span>
            <span className="font-medium text-slate-800">Account active</span>
            <span className="block text-xs text-slate-500">
              {isSelf
                ? 'You cannot deactivate your own account.'
                : 'Inactive users cannot sign in. Their open tickets are returned to the queue.'}
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  useDocumentTitle('Users');
  const currentUser = useCurrentUser();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<'active' | 'inactive' | ''>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const q = useDebouncedValue(search.trim(), 300);

  const { data, isPending, isError, error, refetch } = useUsers({
    q: q || undefined,
    role: role || undefined,
    status: status || undefined,
    page,
    pageSize: 15,
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage staff and customer accounts and their access."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="size-4" /> Add user
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or email…"
              aria-label="Search users"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select
              aria-label="Filter by role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as Role | '');
                setPage(1);
              }}
              className="sm:w-36"
            >
              <option value="">All roles</option>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as 'active' | 'inactive' | '');
                setPage(1);
              }}
              className="sm:w-36"
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </div>

        {isPending ? (
          <SectionSpinner />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users found"
            description="Try a different search or filter."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      User
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Last sign-in
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                      Joined
                    </th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.data.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={user.name} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {user.name}
                              {user.id === currentUser.id && (
                                <span className="ml-1.5 text-xs font-normal text-slate-400">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-slate-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {user.isActive ? (
                          <Badge tone="green">Active</Badge>
                        ) : (
                          <Badge tone="red">Inactive</Badge>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditing(user)}
                          aria-label={`Edit ${user.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={data.meta} noun="users" onPageChange={setPage} />
          </>
        )}
      </Card>

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <EditUserModal key={editing.id} user={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
