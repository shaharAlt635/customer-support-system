import {
  PERMISSIONS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketDetailDTO,
  type TicketPriority,
  type TicketStatus,
  type UpdateTicketInput,
  customerCanSetStatus,
} from '@support-desk/shared';
import { CircleCheck, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAssignableUsers, useCategories } from '../../api/queries';
import { useAuth, useCurrentUser } from '../../auth/auth-context';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/Modal';
import { formatDateTime, formatDuration } from '../../lib/format';
import { CategoryTag, PriorityBadge, StatusBadge } from './badges';
import { useDeleteTicket, useUpdateTicket } from './hooks';
import { useCompanyPath } from '../../company/company-context';

function Property({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{value}</dd>
    </div>
  );
}

const minutesBetween = (from: string, to: string | null) =>
  to ? (new Date(to).getTime() - new Date(from).getTime()) / 60_000 : null;

/**
 * One control per property. Each becomes editable only if the user's permission group
 * allows it; otherwise the current value is shown read-only.
 */
function PropertyControls({ ticket }: { ticket: TicketDetailDTO }) {
  const user = useCurrentUser();
  const { can } = useAuth();
  const update = useUpdateTicket(ticket.id);
  const { data: categories = [] } = useCategories();
  const { data: assignees = [] } = useAssignableUsers();
  const [confirmClose, setConfirmClose] = useState(false);

  const isRequester = ticket.customer.id === user.id;
  const canStatus = can(PERMISSIONS.TICKETS_CHANGE_STATUS);
  const canPriority = can(PERMISSIONS.TICKETS_CHANGE_PRIORITY);
  const canCategory = can(PERMISSIONS.TICKETS_EDIT_DETAILS);
  const canAssignOthers = can(PERMISSIONS.TICKETS_ASSIGN_OTHERS);
  const canAssignSelf = can(PERMISSIONS.TICKETS_ASSIGN_SELF) || canAssignOthers;
  const assignedToMe = ticket.assignee?.id === user.id;

  const save = (input: UpdateTicketInput, message = 'Ticket updated') =>
    update.mutate(input, { onSuccess: () => toast.success(message) });

  // Keep the current (possibly deactivated) category selectable so the select stays truthful.
  const categoryOptions =
    ticket.category && !categories.some((c) => c.id === ticket.category?.id)
      ? [...categories, { ...ticket.category, isActive: false }]
      : categories;

  return (
    <div className="space-y-4">
      <Property label="Status" htmlFor={canStatus ? 'ticket-status' : undefined}>
        {canStatus ? (
          <Select
            id="ticket-status"
            value={ticket.status}
            disabled={update.isPending}
            onChange={(event) => save({ status: event.target.value as TicketStatus })}
          >
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        ) : (
          <div>
            <StatusBadge status={ticket.status} />
          </div>
        )}
      </Property>

      <Property label="Priority" htmlFor={canPriority ? 'ticket-priority' : undefined}>
        {canPriority ? (
          <Select
            id="ticket-priority"
            value={ticket.priority}
            disabled={update.isPending}
            onChange={(event) => save({ priority: event.target.value as TicketPriority })}
          >
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        ) : (
          <div>
            <PriorityBadge priority={ticket.priority} />
          </div>
        )}
      </Property>

      <Property label="Category" htmlFor={canCategory ? 'ticket-category' : undefined}>
        {canCategory ? (
          <Select
            id="ticket-category"
            value={ticket.category?.id ?? ''}
            disabled={update.isPending}
            onChange={(event) => save({ categoryId: event.target.value || null })}
          >
            <option value="">No category</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        ) : (
          <div>
            {ticket.category ? (
              <CategoryTag name={ticket.category.name} color={ticket.category.color} />
            ) : (
              <span className="text-sm text-slate-400">—</span>
            )}
          </div>
        )}
      </Property>

      <Property label="Assignee" htmlFor={canAssignOthers ? 'ticket-assignee' : undefined}>
        {canAssignOthers ? (
          <Select
            id="ticket-assignee"
            value={ticket.assignee?.id ?? ''}
            disabled={update.isPending}
            onChange={(event) =>
              save({ assigneeId: event.target.value || null }, 'Assignment updated')
            }
          >
            <option value="">Unassigned</option>
            {ticket.assignee && !assignees.some((a) => a.id === ticket.assignee?.id) && (
              <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
            )}
            {assignees.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === user.id ? ' (you)' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm text-slate-700">
            {ticket.assignee?.name ?? (isRequester ? 'Awaiting an agent' : 'Unassigned')}
          </p>
        )}
        {canAssignSelf && !assignedToMe && (canAssignOthers || !ticket.assignee) && (
          <button
            type="button"
            onClick={() => save({ assigneeId: user.id }, 'Assigned to you')}
            disabled={update.isPending}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            <UserPlus className="size-3.5" aria-hidden /> Assign to me
          </button>
        )}
        {canAssignSelf && assignedToMe && !canAssignOthers && (
          <button
            type="button"
            onClick={() => save({ assigneeId: null }, 'Ticket returned to the queue')}
            disabled={update.isPending}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Unassign me
          </button>
        )}
      </Property>

      {isRequester && !canStatus && (
        <div className="flex flex-col gap-2 pt-1">
          {customerCanSetStatus(ticket.status, 'CLOSED') && (
            <Button variant="secondary" onClick={() => setConfirmClose(true)}>
              <CircleCheck className="size-4" /> My issue is solved — close ticket
            </Button>
          )}
          {customerCanSetStatus(ticket.status, 'OPEN') && (
            <Button
              variant="secondary"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { status: 'OPEN' },
                  { onSuccess: () => toast.success('Ticket reopened') },
                )
              }
            >
              <RotateCcw className="size-4" /> Reopen ticket
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close this ticket?"
        description="We'll mark your request as done. You can reopen it later if the problem comes back."
        confirmLabel="Close ticket"
        tone="primary"
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { status: 'CLOSED' },
            {
              onSuccess: () => {
                setConfirmClose(false);
                toast.success('Ticket closed');
              },
            },
          )
        }
      />
    </div>
  );
}

export function TicketProperties({ ticket }: { ticket: TicketDetailDTO }) {
  const companyPath = useCompanyPath();
  const { can } = useAuth();
  const navigate = useNavigate();
  const remove = useDeleteTicket(ticket.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Properties" />
        <CardContent>
          <PropertyControls ticket={ticket} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={ticket.customer.name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{ticket.customer.name}</p>
              <p className="truncate text-xs text-slate-500">
                {ticket.customer.email ?? 'Identity hidden'}
              </p>
            </div>
          </div>
          <dl className="space-y-2 border-t border-slate-100 pt-4">
            <Detail label="Created" value={formatDateTime(ticket.createdAt)} />
            <Detail
              label="First response"
              value={
                ticket.firstResponseAt
                  ? `after ${formatDuration(minutesBetween(ticket.createdAt, ticket.firstResponseAt))}`
                  : 'Pending'
              }
            />
            {ticket.resolvedAt && (
              <Detail
                label="Resolved"
                value={`after ${formatDuration(minutesBetween(ticket.createdAt, ticket.resolvedAt))}`}
              />
            )}
            {ticket.closedAt && <Detail label="Closed" value={formatDateTime(ticket.closedAt)} />}
          </dl>
        </CardContent>
      </Card>

      {can(PERMISSIONS.TICKETS_DELETE) && (
        <Card className="ring-red-200">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Delete ticket</p>
              <p className="text-xs text-slate-500">
                Removes the conversation and files permanently.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete ticket"
            >
              <Trash2 className="size-4 text-red-600" />
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ticket #${ticket.number}?`}
        description="The ticket, its replies, internal notes, history and attachments will be permanently deleted. This cannot be undone."
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success(`Ticket #${ticket.number} deleted`);
              navigate(companyPath('/tickets'), { replace: true });
            },
          })
        }
      />
    </div>
  );
}
