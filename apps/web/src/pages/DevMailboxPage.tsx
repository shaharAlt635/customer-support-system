import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Inbox, Mail, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { type DevEmail, devApi } from '../api/endpoints';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const linksIn = (email: DevEmail) => Array.from(new Set(email.text.match(/https?:\/\/\S+/g) ?? []));

/**
 * Development-only inbox for emails the API would have sent (EMAIL_TRANSPORT=dev).
 * Lets you click verification and password-reset links without an email provider.
 */
export default function DevMailboxPage() {
  useDocumentTitle('Dev mailbox');
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['dev-emails'],
    queryFn: async () => (await devApi.emails()).data,
    refetchInterval: 3000,
  });
  const clear = useMutation({
    mutationFn: devApi.clear,
    onSuccess: () => {
      setSelectedId(undefined);
      void queryClient.invalidateQueries({ queryKey: ['dev-emails'] });
    },
  });

  const emails = data ?? [];
  const selected = emails.find((email) => email.id === selectedId) ?? emails[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
            ← Support Desk
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Dev mailbox</h1>
          <p className="mt-1 text-sm text-slate-500">
            Emails the API would send. Only available in development (EMAIL_TRANSPORT=dev); kept for
            7 days.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => clear.mutate()}
          loading={clear.isPending}
          disabled={!emails.length}
        >
          <Trash2 className="size-4" /> Clear
        </Button>
      </div>

      <Card className="overflow-hidden">
        {isPending ? (
          <SectionSpinner />
        ) : error ? (
          error instanceof ApiError && error.status === 404 ? (
            <EmptyState
              icon={Mail}
              title="The dev mailbox is disabled"
              description="The API is sending real email (EMAIL_TRANSPORT=smtp) or running in production."
            />
          ) : (
            <ErrorState error={error} onRetry={() => void refetch()} />
          )
        ) : emails.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No emails yet"
            description="Sign up, register or request a password reset and the email will show up here."
          />
        ) : (
          <div className="grid md:grid-cols-[18rem_minmax(0,1fr)]">
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto border-b border-slate-100 md:border-r md:border-b-0">
              {emails.map((email) => (
                <li key={email.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(email.id)}
                    className={cn(
                      'block w-full px-4 py-3 text-left hover:bg-slate-50',
                      selected?.id === email.id && 'bg-brand-50 hover:bg-brand-50',
                    )}
                  >
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {email.subject}
                    </span>
                    <span className="mt-0.5 flex justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">{email.to}</span>
                      <span className="shrink-0">{formatRelative(email.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {selected && (
              <div className="min-w-0 p-5">
                <h2 className="text-base font-semibold text-slate-900">{selected.subject}</h2>
                <p className="mt-1 text-sm text-slate-500">To: {selected.to}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {linksIn(selected).map((url) => (
                    <a
                      key={url}
                      href={url}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                    >
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">Open link: {new URL(url).pathname}</span>
                    </a>
                  ))}
                </div>
                {/* Rendered in a fully sandboxed frame: no scripts, no navigation. */}
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={selected.html}
                  className="mt-4 h-[32rem] w-full rounded-lg ring-1 ring-slate-200"
                />
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
