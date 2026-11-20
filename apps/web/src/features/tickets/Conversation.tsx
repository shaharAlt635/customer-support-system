import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TicketDetailDTO,
  type TicketEventDTO,
  type TicketPriority,
  type TicketStatus,
  type UserSummaryDTO,
  isStaff,
} from '@support-desk/shared';
import { History, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';
import { formatDateTime, formatRelative } from '../../lib/format';
import { AttachmentList } from './Attachments';

type TimelineItem =
  | {
      kind: 'message';
      id: string;
      at: string;
      author: UserSummaryDTO;
      body: string;
      isInternal: boolean;
      attachments: TicketDetailDTO['attachments'];
      isOriginal?: boolean;
    }
  | { kind: 'event'; id: string; at: string; event: TicketEventDTO };

function buildTimeline(ticket: TicketDetailDTO): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      kind: 'message',
      id: 'original',
      at: ticket.createdAt,
      author: ticket.customer,
      body: ticket.description,
      isInternal: false,
      attachments: ticket.attachments,
      isOriginal: true,
    },
    ...ticket.messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      at: message.createdAt,
      author: message.author,
      body: message.body,
      isInternal: message.isInternal,
      attachments: message.attachments,
    })),
    ...ticket.events
      .filter((event) => event.type !== 'CREATED')
      .map((event) => ({ kind: 'event' as const, id: event.id, at: event.createdAt, event })),
  ];
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

const strong = (text: string | null) => (
  <strong className="font-medium text-slate-700">{text}</strong>
);

function describeEvent(event: TicketEventDTO): ReactNode {
  const { fromValue: from, toValue: to } = event;
  switch (event.type) {
    case 'STATUS_CHANGED':
      return (
        <>
          changed the status from {strong(STATUS_LABELS[from as TicketStatus] ?? from)} to{' '}
          {strong(STATUS_LABELS[to as TicketStatus] ?? to)}
        </>
      );
    case 'PRIORITY_CHANGED':
      return (
        <>
          changed the priority from {strong(PRIORITY_LABELS[from as TicketPriority] ?? from)} to{' '}
          {strong(PRIORITY_LABELS[to as TicketPriority] ?? to)}
        </>
      );
    case 'CATEGORY_CHANGED':
      if (!to) return <>removed the category {strong(from)}</>;
      return from ? (
        <>
          moved this from {strong(from)} to {strong(to)}
        </>
      ) : (
        <>set the category to {strong(to)}</>
      );
    case 'ASSIGNEE_CHANGED':
      if (!to) return <>unassigned {strong(from)}</>;
      return from ? (
        <>
          reassigned this from {strong(from)} to {strong(to)}
        </>
      ) : (
        <>assigned this to {strong(to)}</>
      );
    case 'SUBJECT_CHANGED':
      return <>renamed the ticket to {strong(`“${to}”`)}</>;
    default:
      return <>updated the ticket</>;
  }
}

function EventRow({ event }: { event: TicketEventDTO }) {
  return (
    <li className="relative flex items-center gap-3 pl-1 text-xs text-slate-500">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-4 ring-slate-50">
        <History className="size-3.5 text-slate-400" aria-hidden />
      </span>
      <p className="min-w-0">
        {strong(event.actor.name)} {describeEvent(event)}{' '}
        <time
          dateTime={event.createdAt}
          title={formatDateTime(event.createdAt)}
          className="text-slate-400"
        >
          · {formatRelative(event.createdAt)}
        </time>
      </p>
    </li>
  );
}

function MessageCard({ item }: { item: Extract<TimelineItem, { kind: 'message' }> }) {
  const fromStaff = isStaff(item.author.role);

  return (
    <li className="relative flex gap-3">
      <Avatar name={item.author.name} className="mt-0.5 ring-4 ring-slate-50" />
      <article
        className={cn(
          'min-w-0 flex-1 rounded-xl px-4 py-3 shadow-sm ring-1',
          item.isInternal
            ? 'bg-amber-50 ring-amber-200'
            : fromStaff
              ? 'bg-white ring-brand-200'
              : 'bg-white ring-slate-200',
        )}
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-900">{item.author.name}</span>
          {fromStaff && !item.isInternal && <Badge tone="indigo">Support</Badge>}
          {item.isInternal && (
            <Badge tone="amber">
              <Lock className="size-3" aria-hidden /> Internal note
            </Badge>
          )}
          {item.isOriginal && <span className="text-xs text-slate-400">opened this ticket</span>}
          <time
            dateTime={item.at}
            title={formatDateTime(item.at)}
            className="ml-auto text-xs text-slate-400"
          >
            {formatRelative(item.at)}
          </time>
        </header>
        <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-700">
          {item.body}
        </p>
        <AttachmentList attachments={item.attachments} />
      </article>
    </li>
  );
}

export function Conversation({ ticket }: { ticket: TicketDetailDTO }) {
  const items = buildTimeline(ticket);
  return (
    <ol className="relative space-y-5 before:absolute before:top-4 before:bottom-4 before:left-4 before:w-px before:bg-slate-200">
      {items.map((item) =>
        item.kind === 'message' ? (
          <MessageCard key={item.id} item={item} />
        ) : (
          <EventRow key={item.id} event={item.event} />
        ),
      )}
    </ol>
  );
}
