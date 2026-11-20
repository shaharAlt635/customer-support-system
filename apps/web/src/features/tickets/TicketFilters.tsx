import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketSort,
} from '@support-desk/shared';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAssignableUsers, useCategories } from '../../api/queries';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { useDebouncedValue } from '../../lib/hooks';

export interface TicketFilterState {
  q: string;
  status: string;
  priority: string;
  categoryId: string;
  assigneeId: string;
  sort: TicketSort;
}

export const DEFAULT_FILTERS: TicketFilterState = {
  q: '',
  status: '',
  priority: '',
  categoryId: '',
  assigneeId: '',
  sort: 'updated',
};

const SORT_LABELS: Record<TicketSort, string> = {
  updated: 'Recently updated',
  newest: 'Newest first',
  oldest: 'Oldest first',
  priority: 'Highest priority',
};

interface TicketFiltersProps {
  value: TicketFilterState;
  onChange: (patch: Partial<TicketFilterState>) => void;
  onReset: () => void;
}

export function TicketFilters({ value, onChange, onReset }: TicketFiltersProps) {
  const { user } = useAuth();
  const isStaff = user?.role !== 'CUSTOMER';
  const { data: categories = [] } = useCategories();
  const { data: assignees = [] } = useAssignableUsers();

  // Local search state so typing feels instant; the URL updates after a short pause.
  const [search, setSearch] = useState(value.q);
  const debouncedSearch = useDebouncedValue(search, 350);
  // Adopt external changes to `q` (e.g. "Clear" or the global search box) during render.
  const [syncedQ, setSyncedQ] = useState(value.q);
  if (value.q !== syncedQ) {
    setSyncedQ(value.q);
    setSearch(value.q);
  }
  useEffect(() => {
    if (debouncedSearch !== value.q) onChange({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debouncedSearch]);

  const isFiltered =
    value.q || value.status || value.priority || value.categoryId || value.assigneeId;

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={isStaff ? 'Search subject, #number, customer…' : 'Search your tickets…'}
          aria-label="Search tickets"
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select
          aria-label="Filter by status"
          value={value.status}
          onChange={(event) => onChange({ status: event.target.value })}
          className="sm:w-48"
        >
          <option value="">All statuses</option>
          <option value="active">Active (unresolved)</option>
          {TICKET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by priority"
          value={value.priority}
          onChange={(event) => onChange({ priority: event.target.value })}
          className="sm:w-36"
        >
          <option value="">All priorities</option>
          {TICKET_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by category"
          value={value.categoryId}
          onChange={(event) => onChange({ categoryId: event.target.value })}
          className="sm:w-40"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>

        {isStaff && (
          <Select
            aria-label="Filter by assignee"
            value={value.assigneeId}
            onChange={(event) => onChange({ assigneeId: event.target.value })}
            className="sm:w-40"
          >
            <option value="">Any assignee</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        )}

        <Select
          aria-label="Sort tickets"
          value={value.sort}
          onChange={(event) => onChange({ sort: event.target.value as TicketSort })}
          className="sm:w-44"
        >
          {(Object.keys(SORT_LABELS) as TicketSort[]).map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </Select>

        {isFiltered && (
          <Button variant="ghost" onClick={onReset} className="col-span-2 sm:col-span-1">
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
