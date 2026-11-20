import {
  ACTIVE_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type StatsOverviewDTO,
} from '@support-desk/shared';
import {
  CircleCheck,
  Clock,
  Flame,
  Inbox,
  type LucideIcon,
  Plus,
  Timer,
  TrendingUp,
  UserX,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useStats, useTickets } from '../api/queries';
import { useCurrentUser } from '../auth/auth-context';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { BarList, TrendChart } from '../features/dashboard/charts';
import { PriorityBadge, StatusBadge } from '../features/tickets/badges';
import { cn } from '../lib/cn';
import { formatDuration, formatRelative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const PERIODS = [7, 30, 90] as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  to,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  to?: string;
}) {
  const content = (
    <Card className={cn('h-full p-5', to && 'transition hover:ring-brand-300')}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="size-4 text-slate-400" aria-hidden />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl">
      {content}
    </Link>
  ) : (
    content
  );
}

function PeriodPicker({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Time period"
      className="inline-flex rounded-lg bg-slate-200/60 p-0.5"
    >
      {PERIODS.map((days) => (
        <button
          key={days}
          role="radio"
          aria-checked={value === days}
          onClick={() => onChange(days)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            value === days
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function RecentTickets({ isStaff }: { isStaff: boolean }) {
  const { data, isPending } = useTickets(
    isStaff
      ? { assigneeId: 'me', status: [...ACTIVE_STATUSES], sort: 'priority', pageSize: 6 }
      : { sort: 'updated', pageSize: 6 },
  );

  return (
    <Card>
      <CardHeader
        title={isStaff ? 'Your queue' : 'Recent tickets'}
        description={
          isStaff ? 'Active tickets assigned to you, most urgent first' : 'Your latest requests'
        }
        actions={
          <Link
            to={isStaff ? '/tickets?assigneeId=me&status=active&sort=priority' : '/tickets'}
            className="text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            View all
          </Link>
        }
      />
      {isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={Inbox}
          title={isStaff ? 'Your queue is empty' : 'No tickets yet'}
          description={
            isStaff
              ? 'Pick up an unassigned ticket to get started.'
              : 'Create a ticket whenever you need help.'
          }
          action={
            <Link
              to={isStaff ? '/tickets?assigneeId=unassigned&status=active' : '/tickets/new'}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-50 px-3 text-xs font-medium text-brand-700 hover:bg-brand-100"
            >
              {isStaff ? (
                'Browse unassigned'
              ) : (
                <>
                  <Plus className="size-3.5" /> New ticket
                </>
              )}
            </Link>
          }
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.data.map((ticket) => (
            <li key={ticket.id}>
              <Link
                to={`/tickets/${ticket.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{ticket.subject}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">#{ticket.number}</span>
                    <PriorityBadge priority={ticket.priority} />
                    <span>· {formatRelative(ticket.lastActivityAt)}</span>
                  </p>
                </div>
                <StatusBadge status={ticket.status} className="hidden sm:inline-flex" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AgentWorkload({ stats }: { stats: StatsOverviewDTO }) {
  return (
    <Card>
      <CardHeader
        title="Team workload"
        description={`Active tickets and resolutions in the last ${stats.periodDays} days`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th scope="col" className="px-5 py-2.5 text-left font-medium">
                Agent
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Active
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Resolved
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.agentWorkload.map((agent) => (
              <tr key={agent.id}>
                <td className="px-5 py-2.5">
                  <span className="flex items-center gap-2.5 text-slate-800">
                    <Avatar name={agent.name} size="xs" />
                    {agent.name}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                  <Link
                    to={`/tickets?assigneeId=${agent.id}&status=active`}
                    className="hover:text-brand-700"
                  >
                    {agent.active}
                  </Link>
                </td>
                <td className="px-5 py-2.5 text-right text-slate-600 tabular-nums">
                  {agent.resolvedInPeriod}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const user = useCurrentUser();
  const isStaff = user.role !== 'CUSTOMER';
  const [days, setDays] = useState<number>(30);
  const { data: stats, isPending, isError, error, refetch } = useStats(days);
  useDocumentTitle('Dashboard');

  const firstName = user.name.split(' ')[0];
  const waitingOnMe = stats?.byStatus.find((s) => s.key === 'WAITING_ON_CUSTOMER')?.count ?? 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          isStaff
            ? "Here's what's happening across the help desk."
            : 'An overview of your support requests.'
        }
        actions={<PeriodPicker value={days} onChange={setDays} />}
      />

      {isPending ? (
        <DashboardSkeleton />
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Active tickets"
              value={stats.totals.active}
              icon={Inbox}
              hint={`${stats.totals.total} total`}
              to="/tickets?status=active"
            />
            {isStaff ? (
              <StatTile
                label="Unassigned"
                value={stats.totals.unassigned}
                icon={UserX}
                hint="Active tickets without an owner"
                to="/tickets?assigneeId=unassigned&status=active"
              />
            ) : (
              <StatTile
                label="Awaiting your reply"
                value={waitingOnMe}
                icon={Clock}
                hint="Our team needs more information"
                to="/tickets?status=WAITING_ON_CUSTOMER"
              />
            )}
            <StatTile
              label="Created"
              value={stats.totals.createdInPeriod}
              icon={TrendingUp}
              hint={`Last ${days} days`}
            />
            <StatTile
              label="Resolved"
              value={stats.totals.resolvedInPeriod}
              icon={CircleCheck}
              hint={`Last ${days} days`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Ticket volume"
                description={`Created vs. resolved per day (UTC), last ${days} days`}
              />
              <CardContent>
                <TrendChart data={stats.trend} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                title="Response times"
                description={`Tickets opened in the last ${days} days`}
              />
              <CardContent className="space-y-5">
                {[
                  {
                    label: 'Avg. first response',
                    value: formatDuration(stats.avgFirstResponseMinutes),
                    icon: Timer,
                  },
                  {
                    label: 'Avg. time to resolution',
                    value: formatDuration(stats.avgResolutionMinutes),
                    icon: CircleCheck,
                  },
                  {
                    label: 'Urgent & unresolved',
                    value: String(stats.totals.urgentActive),
                    icon: Flame,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-center gap-4">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-slate-100">
                      <Icon className="size-5 text-slate-500" aria-hidden />
                    </span>
                    <div>
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader title="By status" description="All tickets" />
              <CardContent>
                <BarList
                  data={stats.byStatus.map((row) => ({
                    key: row.key,
                    label: STATUS_LABELS[row.key],
                    value: row.count,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="By priority" description="All tickets" />
              <CardContent>
                <BarList
                  data={[...stats.byPriority].reverse().map((row) => ({
                    key: row.key,
                    label: PRIORITY_LABELS[row.key],
                    value: row.count,
                  }))}
                />
              </CardContent>
            </Card>
            <Card className="md:col-span-2 xl:col-span-1">
              <CardHeader title="By category" description="All tickets" />
              <CardContent>
                <BarList
                  data={stats.byCategory.map((row) => ({
                    key: row.id ?? 'none',
                    label: (
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: row.color }}
                          aria-hidden
                        />
                        {row.name}
                      </span>
                    ),
                    value: row.count,
                  }))}
                />
              </CardContent>
            </Card>
          </div>

          <div className={cn('grid gap-6', isStaff && 'xl:grid-cols-2')}>
            <RecentTickets isStaff={isStaff} />
            {isStaff && stats.agentWorkload.length > 0 && <AgentWorkload stats={stats} />}
          </div>
        </div>
      )}
    </>
  );
}
