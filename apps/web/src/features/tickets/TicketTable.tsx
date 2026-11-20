import type { TicketSummaryDTO } from '@support-desk/shared';
import { MessageSquare } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../../components/ui/Avatar';
import { formatRelative } from '../../lib/format';
import { CategoryTag, PriorityBadge, StatusBadge } from './badges';

interface TicketTableProps {
  tickets: TicketSummaryDTO[];
  showCustomer: boolean;
}

function Assignee({ ticket }: { ticket: TicketSummaryDTO }) {
  if (!ticket.assignee) return <span className="text-xs text-slate-400 italic">Unassigned</span>;
  return (
    <span className="flex items-center gap-2 text-sm text-slate-700">
      <Avatar name={ticket.assignee.name} size="xs" />
      <span className="truncate">{ticket.assignee.name}</span>
    </span>
  );
}

export function TicketTable({ tickets, showCustomer }: TicketTableProps) {
  const navigate = useNavigate();

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs font-medium text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Ticket
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Priority
              </th>
              <th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">
                Category
              </th>
              {showCustomer && (
                <th scope="col" className="px-4 py-3 font-medium">
                  Assignee
                </th>
              )}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="max-w-md px-4 py-3">
                  <Link
                    to={`/tickets/${ticket.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-medium text-slate-900 hover:text-brand-700"
                  >
                    {ticket.subject}
                  </Link>
                  <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-slate-500">
                    <span className="font-mono">#{ticket.number}</span>
                    {showCustomer && <span className="truncate">· {ticket.customer.name}</span>}
                    {ticket.messageCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        · <MessageSquare className="size-3" aria-hidden /> {ticket.messageCount}
                      </span>
                    )}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={ticket.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="hidden px-4 py-3 xl:table-cell">
                  {ticket.category ? (
                    <CategoryTag name={ticket.category.name} color={ticket.category.color} />
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                {showCustomer && (
                  <td className="max-w-[12rem] px-4 py-3">
                    <Assignee ticket={ticket} />
                  </td>
                )}
                <td className="px-4 py-3 text-right text-xs whitespace-nowrap text-slate-500">
                  <time dateTime={ticket.lastActivityAt}>
                    {formatRelative(ticket.lastActivityAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <Link to={`/tickets/${ticket.id}`} className="block px-4 py-3.5 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-slate-900">{ticket.subject}</p>
                <StatusBadge status={ticket.status} className="shrink-0" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="font-mono">#{ticket.number}</span>
                <PriorityBadge priority={ticket.priority} />
                {ticket.category && (
                  <CategoryTag name={ticket.category.name} color={ticket.category.color} />
                )}
                <span className="ml-auto">{formatRelative(ticket.lastActivityAt)}</span>
              </div>
              {showCustomer && (
                <p className="mt-1 truncate text-xs text-slate-500">
                  {ticket.customer.name} → {ticket.assignee?.name ?? 'Unassigned'}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
