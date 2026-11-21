import { companySlugSchema } from '@support-desk/shared';
import {
  ArrowRight,
  Building2,
  ChartColumn,
  LifeBuoy,
  Lock,
  Mail,
  type LucideIcon,
  Users,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePublicConfig } from '../api/queries';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useDocumentTitle } from '../lib/hooks';

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Building2,
    title: 'Your own help desk',
    text: 'Every company gets its own address, accounts, categories and tickets.',
  },
  {
    icon: Users,
    title: 'Built for teams',
    text: 'Assign tickets, collaborate with internal notes and track every change.',
  },
  {
    icon: ChartColumn,
    title: 'Know where you stand',
    text: 'Response times, workload and trends on a live dashboard.',
  },
  {
    icon: Lock,
    title: 'Secure by default',
    text: 'Verified emails, rotating sessions and strict isolation between companies.',
  },
];

function GoToCompany() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = companySlugSchema.safeParse(value.replace(/^.*\//, ''));
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    navigate(`/${result.data}/login`);
  };

  return (
    <form onSubmit={onSubmit} className="mt-3" noValidate>
      <div className="flex gap-2">
        <div className="flex flex-1 rounded-lg shadow-sm">
          <span className="inline-flex items-center rounded-l-lg bg-slate-50 px-3 text-sm text-slate-500 ring-1 ring-slate-300 ring-inset">
            {window.location.host}/
          </span>
          <Input
            aria-label="Company address"
            placeholder="your-company"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
            invalid={Boolean(error)}
            autoCapitalize="none"
            spellCheck={false}
            className="-ml-px rounded-l-none shadow-none"
          />
        </div>
        <Button type="submit" variant="secondary">
          Go <ArrowRight className="size-4" />
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </form>
  );
}

export default function HomePage() {
  useDocumentTitle('Customer support for every team');
  const { data: config } = usePublicConfig();

  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <LifeBuoy className="size-5" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-900">
            Support Desk
          </span>
        </div>
        {config?.devMailbox && (
          <Link
            to="/dev/mailbox"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <Mail className="size-4" aria-hidden /> Dev mailbox
          </Link>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:px-6 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Customer support, organised.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Create a help desk for your company, invite your team and start resolving customer
              tickets in minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {config?.allowCompanySignup !== false && (
                <Link
                  to="/signup"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
                >
                  Create your company <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200 sm:p-8">
            <h2 className="text-base font-semibold text-slate-900">Already using Support Desk?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your company&apos;s address to sign in or open a ticket.
            </p>
            <GoToCompany />
            {SHOW_DEMO && (
              <p className="mt-4 text-xs text-slate-500">
                Demo companies:{' '}
                <Link to="/acme/login" className="font-medium text-brand-600 hover:underline">
                  acme
                </Link>{' '}
                ·{' '}
                <Link to="/globex/login" className="font-medium text-brand-600 hover:underline">
                  globex
                </Link>
              </p>
            )}
          </div>
        </div>

        <ul className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl p-5 ring-1 ring-slate-200">
              <Icon className="size-5 text-brand-600" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-500">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
