import type { MyInvitationDTO } from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, MailOpen, UserPlus, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../api/client';
import { meApi } from '../api/endpoints';
import { queryKeys, useMyInvitations } from '../api/queries';
import { useAuth, useCurrentUser } from '../auth/auth-context';
import { useCompanyPath } from '../company/company-context';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { formatDate, formatRelative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function InvitationCard({ invitation }: { invitation: MyInvitationDTO }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const companyPath = useCompanyPath();
  const { setUser } = useAuth();

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.myInvitations });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  };

  const accept = useMutation({
    mutationFn: () => meApi.accept(invitation.id),
    onSuccess: ({ user }) => {
      setUser(user);
      // Role and permissions changed: everything visible may be different now.
      void queryClient.invalidateQueries();
      toast.success(`Welcome to the ${invitation.company.name} team!`);
      navigate(companyPath('/dashboard'));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const decline = useMutation({
    mutationFn: () => meApi.decline(invitation.id),
    onSuccess: () => {
      refreshAll();
      toast.success('Invitation declined');
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50">
          <UserPlus className="size-5 text-brand-600" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Join the {invitation.company.name} support team
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {invitation.invitedBy.name} invited you {formatRelative(invitation.createdAt)} as a
            member of the{' '}
            <strong className="font-medium text-slate-700">{invitation.group.name}</strong> group.
            Expires {formatDate(invitation.expiresAt)}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => decline.mutate()}
            loading={decline.isPending}
            disabled={accept.isPending}
          >
            <X className="size-4" /> Decline
          </Button>
          <Button
            onClick={() => accept.mutate()}
            loading={accept.isPending}
            disabled={decline.isPending}
          >
            <Check className="size-4" /> Accept
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function InvitationsPage() {
  useDocumentTitle('Invitations');
  const user = useCurrentUser();
  const { data, isPending, isError, error, refetch } = useMyInvitations();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Invitations" description="Team invitations sent to your email address." />
      {isPending ? (
        <SectionSpinner />
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={MailOpen}
            title="No pending invitations"
            description={
              user.role === 'CUSTOMER'
                ? 'When a team manager invites you to help with support, the invitation will show up here.'
                : "You're already on the team."
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((invitation) => (
            <InvitationCard key={invitation.id} invitation={invitation} />
          ))}
          <p className="text-xs text-slate-500">
            Accepting gives you access to the company&apos;s tickets with the permissions of the
            chosen group. You can keep using the same sign-in.
          </p>
        </div>
      )}
    </div>
  );
}
