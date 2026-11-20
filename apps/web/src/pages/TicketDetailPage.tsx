import { ArrowLeft, SearchX } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useTicket } from '../api/queries';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { Conversation } from '../features/tickets/Conversation';
import { ReplyComposer } from '../features/tickets/ReplyComposer';
import { TicketProperties } from '../features/tickets/TicketProperties';
import { CategoryTag, PriorityBadge, StatusBadge } from '../features/tickets/badges';
import { formatRelative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

export default function TicketDetailPage() {
  const { id = '' } = useParams();
  const { data: ticket, isPending, isError, error, refetch } = useTicket(id);
  useDocumentTitle(ticket ? `#${ticket.number} ${ticket.subject}` : 'Ticket');

  const backLink = (
    <Link
      to="/tickets"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft className="size-4" aria-hidden /> All tickets
    </Link>
  );

  if (isPending) return <SectionSpinner className="py-32" />;

  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <>
          {backLink}
          <EmptyState
            icon={SearchX}
            title="Ticket not found"
            description="It may have been deleted, or you might not have access to it."
          />
        </>
      );
    }
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  return (
    <>
      {backLink}
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-sm text-slate-500">#{ticket.number}</span>
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          {ticket.category && (
            <CategoryTag name={ticket.category.name} color={ticket.category.color} />
          )}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight break-words text-slate-900 sm:text-2xl">
          {ticket.subject}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Opened by {ticket.customer.name} · {formatRelative(ticket.createdAt)} · last activity{' '}
          {formatRelative(ticket.lastActivityAt)}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Conversation" className="min-w-0 space-y-6">
          <Conversation ticket={ticket} />
          <ReplyComposer key={ticket.id} ticket={ticket} />
        </section>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <TicketProperties ticket={ticket} />
        </aside>
      </div>
    </>
  );
}
