import {
  PERMISSIONS,
  STATUS_LABELS,
  TICKET_STATUSES,
  type TicketDetailDTO,
  type TicketStatus,
} from '@support-desk/shared';
import { Lock, MessageSquareReply, RotateCcw, Send } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, getErrorMessage } from '../../api/client';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FilePicker } from '../../components/ui/FilePicker';
import { Select } from '../../components/ui/Input';
import { cn } from '../../lib/cn';
import { useReplyToTicket, useUpdateTicket } from './hooks';

type Mode = 'reply' | 'note';
const KEEP = 'keep';

export function ReplyComposer({ ticket }: { ticket: TicketDetailDTO }) {
  const { can } = useAuth();
  const canWriteNotes = can(PERMISSIONS.NOTE_INTERNAL);
  const canChangeStatus = can(PERMISSIONS.TICKET_UPDATE);
  const isClosed = ticket.status === 'CLOSED';

  const [mode, setMode] = useState<Mode>('reply');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedStatus, setNextStatus] = useState<string>(KEEP);
  // Staff replying to a closed ticket must pick a status that reopens it.
  const nextStatus = isClosed && selectedStatus === KEEP ? 'IN_PROGRESS' : selectedStatus;
  const [error, setError] = useState<string>();

  const reply = useReplyToTicket(ticket.id);
  const reopen = useUpdateTicket(ticket.id);

  if (isClosed && !canChangeStatus) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">This ticket is closed</p>
          <p className="text-sm text-slate-500">
            Still need help? Reopen it to continue the conversation.
          </p>
        </div>
        <Button
          variant="secondary"
          loading={reopen.isPending}
          onClick={() =>
            reopen.mutate({ status: 'OPEN' }, { onSuccess: () => toast.success('Ticket reopened') })
          }
        >
          <RotateCcw className="size-4" /> Reopen ticket
        </Button>
      </Card>
    );
  }

  const isNote = mode === 'note';

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text) {
      setError('Write a message before sending');
      return;
    }
    setError(undefined);
    reply.mutate(
      {
        input: {
          body: text,
          isInternal: isNote || undefined,
          status: canChangeStatus && nextStatus !== KEEP ? (nextStatus as TicketStatus) : undefined,
        },
        files,
      },
      {
        onSuccess: () => {
          setBody('');
          setFiles([]);
          setNextStatus(KEEP);
          toast.success(isNote ? 'Internal note added' : 'Reply sent');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details[0]) setError(err.details[0].message);
          else toast.error(getErrorMessage(err, 'Could not send your message'));
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  };

  const statusOptions = TICKET_STATUSES.filter((status) => !(isClosed && status === 'CLOSED'));

  return (
    <Card className={cn('overflow-hidden', isNote && 'ring-amber-300')}>
      <form onSubmit={submit}>
        {canWriteNotes && (
          <div
            role="tablist"
            className="flex border-b border-slate-100 px-2"
            aria-label="Message type"
          >
            {(
              [
                { id: 'reply', label: 'Reply to customer', icon: MessageSquareReply },
                { id: 'note', label: 'Internal note', icon: Lock },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition',
                  mode === id
                    ? id === 'note'
                      ? 'border-amber-500 text-amber-700'
                      : 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}

        <div className={cn('p-4', isNote && 'bg-amber-50/60')}>
          {isClosed && (
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
              This ticket is closed. Sending a message will reopen it with the status selected
              below.
            </p>
          )}
          <label htmlFor="reply-body" className="sr-only">
            {isNote ? 'Internal note' : 'Reply'}
          </label>
          <textarea
            id="reply-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            rows={4}
            maxLength={10_000}
            placeholder={
              isNote
                ? 'Share context with your team — customers never see internal notes…'
                : 'Write your reply…'
            }
            aria-invalid={Boolean(error) || undefined}
            className="block w-full resize-y rounded-lg border-0 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
          {error && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <FilePicker
              files={files}
              onChange={setFiles}
              variant="compact"
              disabled={reply.isPending}
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {canChangeStatus && (
                <Select
                  aria-label="Status after sending"
                  value={nextStatus}
                  onChange={(event) => setNextStatus(event.target.value)}
                  className="sm:w-56"
                >
                  {!isClosed && (
                    <option value={KEEP}>Keep status ({STATUS_LABELS[ticket.status]})</option>
                  )}
                  {statusOptions
                    .filter((status) => status !== ticket.status)
                    .map((status) => (
                      <option key={status} value={status}>
                        Set to {STATUS_LABELS[status]}
                      </option>
                    ))}
                </Select>
              )}
              <Button
                type="submit"
                loading={reply.isPending}
                className={cn(isNote && 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800')}
              >
                {!reply.isPending && <Send className="size-4" />}
                {isNote ? 'Add note' : 'Send reply'}
              </Button>
            </div>
          </div>
          <p className="mt-2 hidden text-[11px] text-slate-400 sm:block">
            Press Ctrl + Enter to send
          </p>
        </div>
      </form>
    </Card>
  );
}
