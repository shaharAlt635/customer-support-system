import { format, parseISO } from 'date-fns';
import { type ReactNode, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/cn';

/**
 * Chart colours: the first two slots of a CVD-validated categorical palette
 * (blue/orange pass protan/deutan/tritan separation and ≥3:1 contrast on white).
 * Text always uses slate ink, never the series colour.
 */
export const SERIES = ['#2a78d6', '#eb6834'] as const;
const GRID = '#eef0f3';
const AXIS_TEXT = '#64748b';
/** Single-hue bars for magnitude-only comparisons. */
const BAR = '#2a78d6';

interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

const SERIES_META = [
  { key: 'created', label: 'Created', color: SERIES[0] },
  { key: 'resolved', label: 'Resolved', color: SERIES[1] },
] as const;

type TooltipValue = number | string | readonly (number | string)[];

function TrendTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValue, number | string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <p className="mb-1 font-medium text-slate-900">
        {format(parseISO(String(label)), 'EEE, MMM d')}
      </p>
      {SERIES_META.map((series) => {
        const value = payload.find((entry) => entry.dataKey === series.key)?.value ?? 0;
        return (
          <p key={series.key} className="flex items-center gap-2 text-slate-600">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
            <span className="ml-auto pl-4 font-medium text-slate-900 tabular-nums">{value}</span>
          </p>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const totals = {
    created: data.reduce((sum, point) => sum + point.created, 0),
    resolved: data.reduce((sum, point) => sum + point.resolved, 0),
  };

  return (
    <div>
      {/* Legend (identity is never colour-alone: each key has a label and a total) */}
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
        {SERIES_META.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: series.color }}
              aria-hidden
            />
            {series.label}
            <span className="font-semibold text-slate-900 tabular-nums">{totals[series.key]}</span>
          </li>
        ))}
      </ul>
      <div
        className="h-64"
        role="img"
        aria-label={`Tickets created (${totals.created}) and resolved (${totals.resolved}) per day`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => format(parseISO(value), 'MMM d')}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tick={{ fontSize: 11, fill: AXIS_TEXT }}
              minTickGap={28}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: AXIS_TEXT }}
              width={44}
            />
            <Tooltip content={TrendTooltip} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
            {SERIES_META.map((series) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill={series.color}
                fillOpacity={0.07}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: ReactNode;
  value: number;
}

/**
 * Ranked horizontal bars for "how many in each bucket". One hue (magnitude only),
 * value at the tip, share of total on hover.
 */
export function BarList({
  data,
  emptyLabel = 'No data yet',
}: {
  data: BarDatum[];
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...data.map((item) => item.value));

  if (total === 0) return <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>;

  return (
    <ul className="space-y-3">
      {data.map((item) => {
        const share = Math.round((item.value / total) * 100);
        const isHovered = hovered === item.key;
        return (
          <li
            key={item.key}
            onMouseEnter={() => setHovered(item.key)}
            onMouseLeave={() => setHovered(null)}
            className="group -mx-2 rounded-md px-2 py-1 transition-colors hover:bg-slate-50"
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{item.label}</span>
              <span className="shrink-0 text-slate-900 tabular-nums">
                <span
                  className={cn(
                    'mr-2 text-xs text-slate-500 transition-opacity',
                    isHovered ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {share}%
                </span>
                <span className="font-medium">{item.value}</span>
              </span>
            </div>
            <div className="h-2.5">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-500"
                style={{
                  width: `${Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0)}%`,
                  backgroundColor: BAR,
                  opacity: hovered && !isHovered ? 0.55 : 1,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
