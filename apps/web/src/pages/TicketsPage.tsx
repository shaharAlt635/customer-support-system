import {
  ACTIVE_STATUSES,
  TICKET_PRIORITIES,
  TICKET_SORTS,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketSort,
  type TicketStatus,
} from '@support-desk/shared';
import { Inbox, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { TicketListParams } from '../api/endpoints';
import { useTickets } from '../api/queries';
import { useCurrentUser } from '../auth/auth-context';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import {
  DEFAULT_FILTERS,
  TicketFilters,
  type TicketFilterState,
} from '../features/tickets/TicketFilters';
import { TicketTable } from '../features/tickets/TicketTable';
import { useDocumentTitle } from '../lib/hooks';
import { useCompanyPath } from '../company/company-context';

const PAGE_SIZE = 15;

function readFilters(params: URLSearchParams): TicketFilterState & { page: number } {
  const sort = params.get('sort') as TicketSort | null;
  return {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    priority: params.get('priority') ?? '',
    categoryId: params.get('categoryId') ?? '',
    assigneeId: params.get('assigneeId') ?? '',
    sort: sort && TICKET_SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

function toApiParams(filters: ReturnType<typeof readFilters>): TicketListParams {
  const status: TicketStatus[] | undefined =
    filters.status === 'active'
      ? [...ACTIVE_STATUSES]
      : TICKET_STATUSES.includes(filters.status as TicketStatus)
        ? [filters.status as TicketStatus]
        : undefined;
  const priority = TICKET_PRIORITIES.includes(filters.priority as TicketPriority)
    ? [filters.priority as TicketPriority]
    : undefined;

  return {
    q: filters.q || undefined,
    status,
    priority,
    categoryId: filters.categoryId || undefined,
    assigneeId: filters.assigneeId || undefined,
    sort: filters.sort,
    page: filters.page,
    pageSize: PAGE_SIZE,
  };
}

export default function TicketsPage() {
  const companyPath = useCompanyPath();
  const user = useCurrentUser();
  const isStaff = user.role !== 'CUSTOMER';
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useTickets(
    toApiParams(filters),
  );
  useDocumentTitle(isStaff ? 'Tickets' : 'My tickets');

  const updateParams = (patch: Partial<TicketFilterState> & { page?: number }) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      const isDefault =
        value === '' ||
        (key === 'sort' && value === DEFAULT_FILTERS.sort) ||
        (key === 'page' && value === 1);
      if (isDefault || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    // Any filter change starts over at the first page.
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const hasFilters = Boolean(
    filters.q || filters.status || filters.priority || filters.categoryId || filters.assigneeId,
  );

  return (
    <>
      <PageHeader
        title={isStaff ? 'Tickets' : 'My tickets'}
        description={
          isStaff
            ? 'Triage, assign and resolve customer requests.'
            : 'Track the status of your support requests.'
        }
        actions={
          <Link
            to={companyPath('/tickets/new')}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <Plus className="size-4" aria-hidden />
            New ticket
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <TicketFilters
          value={filters}
          onChange={updateParams}
          onReset={() => setSearchParams({}, { replace: true })}
        />

        {isPending ? (
          <SectionSpinner />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={hasFilters ? 'No tickets match these filters' : 'No tickets yet'}
            description={
              hasFilters
                ? 'Try a different search term or clear the filters.'
                : isStaff
                  ? 'New customer requests will show up here.'
                  : 'Need help with something? Open a ticket and our team will get back to you.'
            }
            action={
              !hasFilters && (
                <Link
                  to={companyPath('/tickets/new')}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  <Plus className="size-4" aria-hidden /> Create a ticket
                </Link>
              )
            }
          />
        ) : (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <TicketTable tickets={data.data} showCustomer={isStaff} />
            <Pagination
              meta={data.meta}
              noun="tickets"
              onPageChange={(page) => updateParams({ page })}
            />
          </div>
        )}
      </Card>
    </>
  );
}
