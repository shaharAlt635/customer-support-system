import { zodResolver } from '@hookform/resolvers/zod';
import {
  type ChangePasswordInput,
  ROLE_LABELS,
  type UpdateProfileInput,
  changePasswordSchema,
  passwordSchema,
  updateProfileSchema,
} from '@support-desk/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { authApi } from '../api/endpoints';
import { useAuth, useCurrentUser } from '../auth/auth-context';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { PasswordInput } from '../features/auth/PasswordInput';
import { handleFormError } from '../lib/form-errors';
import { formatDate } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function ProfileForm() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user.name },
  });

  const onSubmit = async (values: UpdateProfileInput) => {
    try {
      const { user: updated } = await authApi.updateProfile(values);
      setUser(updated);
      reset({ name: updated.name });
      toast.success('Profile updated');
    } catch (error) {
      handleFormError(error, setError, ['name']);
    }
  };

  return (
    <Card>
      <CardHeader title="Profile" description="How you appear to others on tickets." />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} size="md" />
            <div>
              <p className="text-sm font-medium text-slate-900">{user.email}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <Badge tone="indigo">
                  {user.role === 'AGENT' && user.group ? user.group.name : ROLE_LABELS[user.role]}
                </Badge>
                Member since {formatDate(user.createdAt)}
              </p>
            </div>
          </div>
          <Field label="Full name" htmlFor="profile-name" error={errors.name?.message}>
            <Input id="profile-name" invalid={Boolean(errors.name)} {...register('name')} />
          </Field>
        </CardContent>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

const setPasswordFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((data) => data.password === data.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type SetPasswordValues = z.infer<typeof setPasswordFormSchema>;

/** Guests sign in with email links; this lets them add a password too. */
function SetPasswordForm() {
  const { refreshUser } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordFormSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async ({ password }: SetPasswordValues) => {
    try {
      await authApi.setPassword(password);
      await refreshUser();
      toast.success('Password set. You can now sign in with your email and password.');
    } catch (error) {
      handleFormError(error, setError, ['password']);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Set a password"
        description="You've been signing in with email links. Add a password to sign in directly."
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-5">
          <Field
            label="Password"
            htmlFor="set-password"
            error={errors.password?.message}
            hint="At least 8 characters, including a letter and a number."
          >
            <PasswordInput
              id="set-password"
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              {...register('password')}
            />
          </Field>
          <Field
            label="Confirm password"
            htmlFor="set-password-confirm"
            error={errors.confirm?.message}
          >
            <PasswordInput
              id="set-password-confirm"
              autoComplete="new-password"
              invalid={Boolean(errors.confirm)}
              {...register('confirm')}
            />
          </Field>
        </CardContent>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={isSubmitting}>
            Set password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = async (values: ChangePasswordInput) => {
    try {
      await authApi.changePassword(values);
      reset();
      toast.success('Password changed. Other sessions have been signed out.');
    } catch (error) {
      handleFormError(error, setError, ['currentPassword', 'newPassword']);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Change password"
        description="Changing your password signs you out on every other device."
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-5">
          <Field
            label="Current password"
            htmlFor="current-password"
            error={errors.currentPassword?.message}
          >
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              invalid={Boolean(errors.currentPassword)}
              {...register('currentPassword')}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="new-password"
            error={errors.newPassword?.message}
            hint="At least 8 characters, including a letter and a number."
          >
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              invalid={Boolean(errors.newPassword)}
              {...register('newPassword')}
            />
          </Field>
        </CardContent>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  useDocumentTitle('Profile');
  const user = useCurrentUser();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Profile & security"
        description="Manage your personal details and password."
      />
      <div className="space-y-6">
        <ProfileForm />
        {user.hasPassword ? <PasswordForm /> : <SetPasswordForm />}
      </div>
    </div>
  );
}
