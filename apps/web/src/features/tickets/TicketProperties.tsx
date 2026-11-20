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

function StaffControls({ ticket }: { ticket: TicketDetailDTO }) {
  const user = useCurrentUser();
  const { can } = useAuth();
  const update = useUpdateTicket(ticket.id);
  const { data: categories = [] } = useCategories();
  const { data: assignees = [] } = useAssignableUsers();
  const canAssign = can(PERMISSIONS.TICKET_ASSIGN);

  const save = (input: UpdateTicketInput, message = 'Ticket updated') =>
    update.mutate(input, { onSuccess: () => toast.success(message) });

  // Keep the current (possibly deactivated) category selectable so the select stays truthful.
  const categoryOptions =
    ticket.category && !categories.some((c) => c.id === ticket.category?.id)
      ? [...categories, { ...ticket.category, isActive: false }]
      : categories;

  return (
    <div className="space-y-4">
      <Property label="Status" htmlFor="ticket-status">
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
      </Property>

      <Property label="Priority" htmlFor="ticket-priority">
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
      </Property>

      <Property label="Category" htmlFor="ticket-category">
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
      </Property>

      {canAssign && (
        <Property label="Assignee" htmlFor="ticket-assignee">
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
          {ticket.assignee?.id !== user.id && (
            <button
              type="button"
              onClick={() => save({ assigneeId: user.id }, 'Assigned to you')}
              disabled={update.isPending}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
            >
              <UserPlus className="size-3.5" aria-hidden /> Assign to me
            </button>
          )}
        </Property>
      )}
    </div>
  );
}

function CustomerControls({ ticket }: { ticket: TicketDetailDTO }) {
  const update = useUpdateTicket(ticket.id);
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <div className="space-y-4">
      <Property label="Status">
        <div>
          <StatusBadge status={ticket.status} />
        </div>
      </Property>
      <Property label="Priority">
        <div>
          <PriorityBadge priority={ticket.priority} />
        </div>
      </Property>
      <Property label="Category">
        <div>
          {ticket.category ? (
            <CategoryTag name={ticket.category.name} color={ticket.category.color} />
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </div>
      </Property>
      <Property label="Assigned agent">
        <p className="text-sm text-slate-700">{ticket.assignee?.name ?? 'Awaiting an agent'}</p>
      </Property>

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
  const { can } = useAuth();
  const navigate = useNavigate();
  const remove = useDeleteTicket(ticket.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isStaffView = can(PERMISSIONS.TICKET_UPDATE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Properties" />
        <CardContent>
          {isStaffView ? <StaffControls ticket={ticket} /> : <CustomerControls ticket={ticket} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={ticket.customer.name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{ticket.customer.name}</p>
              <p className="truncate text-xs text-slate-500">{ticket.customer.email}</p>
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

      {can(PERMISSIONS.TICKET_DELETE) && (
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
              navigate('/tickets', { replace: true });
            },
          })
        }
      />
    </div>
  );
}
