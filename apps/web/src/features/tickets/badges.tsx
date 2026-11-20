import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TicketPriority,
  type TicketStatus,
} from '@support-desk/shared';
import { ArrowDown, ArrowRight, ArrowUp, Flame } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';

export const STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  OPEN: 'blue',
  IN_PROGRESS: 'violet',
  WAITING_ON_CUSTOMER: 'amber',
  RESOLVED: 'green',
  CLOSED: 'slate',
};

const STATUS_DOTS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-500',
  IN_PROGRESS: 'bg-violet-500',
  WAITING_ON_CUSTOMER: 'bg-amber-500',
  RESOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-400',
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOTS[status])} aria-hidden />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY_STYLE: Record<TicketPriority, { icon: typeof ArrowUp; className: string }> = {
  LOW: { icon: ArrowDown, className: 'text-slate-500' },
  MEDIUM: { icon: ArrowRight, className: 'text-sky-600' },
  HIGH: { icon: ArrowUp, className: 'text-orange-600' },
  URGENT: { icon: Flame, className: 'text-red-600' },
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  const { icon: Icon, className: tone } = PRIORITY_STYLE[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function CategoryTag({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-600">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {name}
    </span>
  );
}
