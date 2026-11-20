import { CircleCheck, LifeBuoy } from 'lucide-react';
import type { ReactNode } from 'react';

const HIGHLIGHTS = [
  'Track every request from first message to resolution',
  'Collaborate with internal notes your customers never see',
  'Measure response times and team workload in real time',
];

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col justify-center px-4 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <LifeBuoy className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-900">
              Support Desk
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-brand-700 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-500/40 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -bottom-32 -left-16 size-96 rounded-full bg-indigo-400/30 blur-3xl"
          aria-hidden
        />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Customer support, without the chaos.
          </h2>
          <p className="mt-4 text-brand-100">
            One place for your team to triage, assign and resolve customer requests.
          </p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((text) => (
              <li key={text} className="flex items-start gap-3 text-sm text-brand-50">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-200" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
