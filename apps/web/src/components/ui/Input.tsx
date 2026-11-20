import { ChevronDown } from 'lucide-react';
import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const controlBase =
  'block w-full rounded-lg border-0 bg-white text-sm text-slate-900 shadow-sm ring-1 ring-inset placeholder:text-slate-400 transition focus:ring-2 focus:ring-inset focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

const ringState = (invalid?: boolean) =>
  invalid ? 'ring-red-400 focus:ring-red-500' : 'ring-slate-300 focus:ring-brand-500';

interface ControlProps {
  invalid?: boolean;
}

export function Input({
  invalid,
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & ControlProps & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, ringState(invalid), 'h-9 px-3', className)}
      {...props}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> &
  ControlProps & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, ringState(invalid), 'px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

/** Native select with a custom chevron. `className` sizes the wrapper (e.g. `w-40`). */
export function Select({
  invalid,
  className,
  children,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & ControlProps & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(controlBase, ringState(invalid), 'h-9 appearance-none truncate pr-8 pl-3')}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
    </div>
  );
}
