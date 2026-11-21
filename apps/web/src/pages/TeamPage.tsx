import { zodResolver } from '@hookform/resolvers/zod';
import {
  type InvitationDTO,
  type InviteInput,
  PERMISSIONS,
  type UserDTO,
  inviteSchema,
} from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, MailPlus, RotateCw, Send, UserMinus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../api/client';
import { teamApi } from '../api/endpoints';
import { queryKeys, useGroups, useTeamInvitations, useTeamMembers } from '../api/queries';
import { useAuth, useCurrentUser } from '../auth/auth-context';
import { useCompanyPath } from '../company/company-context';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input, Select } from '../components/ui/Input';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { handleFormError } from '../lib/form-errors';
import { formatDate, formatRelative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function useInvalidateTeam() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['team'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
  };
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: groups = [] } = useGroups();
  const invalidate = useInvalidateTeam();
  const defaultGroup = groups.find((group) => group.isDefault) ?? groups[0];
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    values: { email: '', groupId: defaultGroup?.id ?? '' },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (values: InviteInput) => {
    try {
      const invitation = await teamApi.invite(values);
      invalidate();
      toast.success(`Invitation sent to ${invitation.email}`);
      close();
    } catch (error) {
      handleFormError(error, setError, ['email', 'groupId']);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite an agent"
      description="They'll get an email and can accept from their account. If they don't have an account yet, they'll be asked to create one with this email."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            <Send className="size-4" /> Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Email" htmlFor="invite-email" error={errors.email?.message}>
          <Input
            id="invite-email"
            type="email"
            placeholder="teammate@company.com"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>
        <Field
          label="Permission group"
          htmlFor="invite-group"
          error={errors.groupId?.message}
          hint="Decides what they can do. You can change it at any time."
        >
          <Select id="invite-group" {...register('groupId')}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
                {group.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function MembersCard() {
  const me = useCurrentUser();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.TEAM_MANAGE);
  const companyPath = useCompanyPath();
  const invalidate = useInvalidateTeam();
  const { data: members, isPending, isError, error, refetch } = useTeamMembers();
  const { data: groups = [] } = useGroups();
  const [removing, setRemoving] = useState<UserDTO | null>(null);

  const changeGroup = useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string }) =>
      teamApi.changeGroup(id, groupId),
    onSuccess: (member) => {
      invalidate();
      toast.success(`${member.name} is now in ${member.group?.name}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => teamApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success(`${removing?.name} was removed from the team`);
      setRemoving(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Members"
        description="The owner has full access. Agents get the permissions of their group."
        actions={
          can(PERMISSIONS.GROUPS_MANAGE) && (
            <Link
              to={companyPath('/settings/groups')}
              className="text-xs font-medium text-brand-600 hover:text-brand-800"
            >
              Manage groups
            </Link>
          )
        }
      />
      {isPending ? (
        <SectionSpinner />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {members.map((member) => {
            const isOwner = member.role === 'OWNER';
            const isMe = member.id === me.id;
            const editable = canManage && !isOwner && !isMe;
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {member.name}
                    {isMe && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                </div>
                {!member.isActive && <Badge tone="red">Deactivated</Badge>}
                {isOwner ? (
                  <Badge tone="amber">Owner · full access</Badge>
                ) : editable ? (
                  <Select
                    aria-label={`Permission group for ${member.name}`}
                    value={member.group?.id ?? ''}
                    disabled={changeGroup.isPending}
                    onChange={(event) =>
                      changeGroup.mutate({ id: member.id, groupId: event.target.value })
                    }
                    className="w-44"
                  >
                    {!member.group && <option value="">No group</option>}
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone="indigo">{member.group?.name ?? 'No group'}</Badge>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRemoving(member)}
                    aria-label={`Remove ${member.name} from the team`}
                  >
                    <UserMinus className="size-4 text-red-600" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name} from the team?`}
        description="They keep their account as a customer but lose access to other people's tickets. Their open tickets go back to the unassigned queue."
        confirmLabel="Remove from team"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function InvitationsCard() {
  const { can } = useAuth();
  const canInvite = can(PERMISSIONS.TEAM_INVITE);
  const invalidate = useInvalidateTeam();
  const { data: invitations, isPending, isError, error, refetch } = useTeamInvitations();
  const [revoking, setRevoking] = useState<InvitationDTO | null>(null);
  const [now] = useState(() => Date.now());

  const resend = useMutation({
    mutationFn: (id: string) => teamApi.resend(id),
    onSuccess: (invitation) => {
      invalidate();
      toast.success(`Invitation resent to ${invitation.email}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => teamApi.revoke(id),
    onSuccess: () => {
      invalidate();
      toast.success('Invitation cancelled');
      setRevoking(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Pending invitations" description="Invitations expire after 14 days." />
      {isPending ? (
        <SectionSpinner />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : invitations.length === 0 ? (
        <EmptyState
          icon={MailPlus}
          title="No pending invitations"
          description="Invite people by email — they accept from their own account."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {invitations.map((invitation) => {
            const expired = new Date(invitation.expiresAt).getTime() < now;
            return (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-slate-100">
                  <Clock className="size-4 text-slate-400" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{invitation.email}</p>
                  <p className="text-xs text-slate-500">
                    {invitation.group.name} · invited by {invitation.invitedBy.name}{' '}
                    {formatRelative(invitation.createdAt)}
                  </p>
                </div>
                {expired ? (
                  <Badge tone="red">Expired</Badge>
                ) : (
                  <Badge tone="slate">Expires {formatDate(invitation.expiresAt)}</Badge>
                )}
                <Badge tone={invitation.hasAccount ? 'green' : 'blue'}>
                  {invitation.hasAccount ? 'Has an account' : 'Needs to sign up'}
                </Badge>
                {canInvite && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resend.mutate(invitation.id)}
                      loading={resend.isPending && resend.variables === invitation.id}
                    >
                      <RotateCw className="size-3.5" /> Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRevoking(invitation)}
                      aria-label={`Cancel invitation for ${invitation.email}`}
                    >
                      <X className="size-4 text-red-600" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title="Cancel this invitation?"
        description={`${revoking?.email} will no longer be able to join with it.`}
        confirmLabel="Cancel invitation"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Card>
  );
}

export default function TeamPage() {
  useDocumentTitle('Team');
  const { can } = useAuth();
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone who works on your support tickets. There's no limit on the number of agents."
        actions={
          can(PERMISSIONS.TEAM_INVITE) && (
            <Button onClick={() => setInviting(true)}>
              <Users className="size-4" /> Invite agent
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <MembersCard />
        <InvitationsCard />
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}
