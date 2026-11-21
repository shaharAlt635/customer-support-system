import { isStaff } from '@support-desk/shared';
import { ArrowRight, LayoutDashboard, LifeBuoy, MailCheck, Ticket } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { usePublicConfig } from '../api/queries';
import { useAuth } from '../auth/auth-context';
import { useCompany, useCompanyPath } from '../company/company-context';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { FullPageSpinner } from '../components/ui/Spinner';
import { SignInLinkForm } from '../features/portal/SignInLinkForm';
import { TicketRequestForm } from '../features/portal/TicketRequestForm';
import { textColorOn } from '../lib/color';
import { initials } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

function SubmittedNotice({ email, onAnother }: { email: string; onAnother: () => void }) {
  const { data: config } = usePublicConfig();
  return (
    <div className="py-6 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50">
        <MailCheck className="size-7 text-emerald-600" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Check your inbox</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        We sent a confirmation link to <strong className="text-slate-900">{email}</strong>. Your
        request reaches the team as soon as you click it — unconfirmed requests are deleted after 24
        hours.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm">
        {config?.devMailbox && (
          <Link to="/dev/mailbox" className="font-medium text-brand-700 hover:text-brand-900">
            Open dev mailbox →
          </Link>
        )}
        <button
          type="button"
          onClick={onAnother}
          className="font-medium text-slate-600 hover:text-slate-900"
        >
          Send another request
        </button>
      </div>
    </div>
  );
}

/**
 * A company's public ticket page (`/acme`). What visitors can do depends on the company's
 * settings: signed-in customers, guests (confirmed by email) and/or anonymous requests.
 */
export default function PortalPage() {
  const company = useCompany();
  const companyPath = useCompanyPath();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const [submittedEmail, setSubmittedEmail] = useState<string>();
  const [formKey, setFormKey] = useState(0);
  useDocumentTitle(company.portalTitle ?? `${company.name} support`);

  if (status === 'loading') return <FullPageSpinner />;

  const signedIn = status === 'authenticated' && user;
  const staff = signedIn && isStaff(user.role);
  const acceptsGuests = company.allowGuestTickets || company.allowAnonymousTickets;
  const headerText = textColorOn(company.brandColor);

  let content;
  if (staff) {
    content = (
      <CardContent className="py-8 text-center">
        <p className="text-sm text-slate-600">
          You&apos;re signed in as a member of the {company.name} team. This is the page your
          customers see.
        </p>
        <Link
          to={companyPath('/dashboard')}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
        >
          <LayoutDashboard className="size-4" aria-hidden /> Go to the dashboard
        </Link>
      </CardContent>
    );
  } else if (signedIn) {
    content = company.allowAccountTickets ? (
      <CardContent className="py-6">
        <TicketRequestForm
          company={company}
          mode="account"
          onAccountSubmitted={(ticketId) => {
            toast.success('Your ticket was sent');
            navigate(companyPath(`/tickets/${ticketId}`));
          }}
        />
      </CardContent>
    ) : (
      <CardContent className="py-8 text-center text-sm text-slate-600">
        {company.name} isn&apos;t taking new requests online right now. You can still follow your
        existing tickets.
      </CardContent>
    );
  } else if (submittedEmail) {
    content = (
      <CardContent>
        <SubmittedNotice
          email={submittedEmail}
          onAnother={() => {
            setSubmittedEmail(undefined);
            setFormKey((key) => key + 1);
          }}
        />
      </CardContent>
    );
  } else if (acceptsGuests) {
    content = (
      <CardContent className="py-6">
        <TicketRequestForm
          key={formKey}
          company={company}
          mode="guest"
          onGuestSubmitted={setSubmittedEmail}
        />
      </CardContent>
    );
  } else {
    content = (
      <CardContent className="py-8 text-center text-sm text-slate-600">
        {company.allowAccountTickets
          ? `Sign in to your ${company.name} account to open a ticket.`
          : `${company.name} isn't taking new requests online right now.`}
      </CardContent>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header style={{ backgroundColor: company.brandColor, color: headerText }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1 ring-current/20"
              style={{ backgroundColor: 'rgb(255 255 255 / 0.15)' }}
              aria-hidden
            >
              {initials(company.name)}
            </span>
            <span className="truncate font-semibold">{company.name}</span>
          </div>
          {signedIn ? (
            <Link
              to={companyPath(staff ? '/dashboard' : '/tickets')}
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium opacity-90 hover:opacity-100"
            >
              {staff ? 'Dashboard' : 'My tickets'} <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <Link
              to={companyPath('/login')}
              className="shrink-0 text-sm font-medium opacity-90 hover:opacity-100"
            >
              Sign in
            </Link>
          )}
        </div>
        <div className="mx-auto max-w-5xl px-4 pt-6 pb-20 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {company.portalTitle ?? `How can we help?`}
          </h1>
          <p className="mt-3 max-w-2xl whitespace-pre-line opacity-90">
            {company.portalMessage ??
              `Send a request to the ${company.name} support team and we'll get back to you by email.`}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-12 grid w-full max-w-5xl flex-1 gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="self-start">
          <CardHeader
            title={signedIn ? `Hi ${user.name.split(' ')[0]}, what do you need?` : 'Open a request'}
            description={signedIn && !staff ? `Signed in as ${user.email}` : undefined}
          />
          {content}
        </Card>

        {!signedIn && (
          <aside className="space-y-4 self-start">
            {company.allowAccountTickets && (
              <Card>
                <CardHeader title="Have an account?" />
                <CardContent className="space-y-2 text-sm">
                  <Link
                    to={companyPath('/login')}
                    className="flex h-9 items-center justify-center rounded-lg bg-white text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    Sign in
                  </Link>
                  {company.allowRegistration && (
                    <Link
                      to={companyPath('/register')}
                      className="block text-center text-sm font-medium text-brand-600 hover:text-brand-800"
                    >
                      Create an account
                    </Link>
                  )}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader
                title="Already sent a request?"
                description="Get a link to follow your requests — no password needed."
              />
              <CardContent>
                <SignInLinkForm companySlug={company.slug} companyName={company.name} />
              </CardContent>
            </Card>
          </aside>
        )}
        {signedIn && !staff && (
          <aside className="self-start">
            <Card>
              <CardContent className="space-y-3 text-sm">
                <Link
                  to={companyPath('/tickets')}
                  className="flex items-center gap-2 font-medium text-slate-700 hover:text-slate-900"
                >
                  <Ticket className="size-4 text-slate-400" aria-hidden /> My tickets
                </Link>
                <Link
                  to={companyPath('/dashboard')}
                  className="flex items-center gap-2 font-medium text-slate-700 hover:text-slate-900"
                >
                  <LayoutDashboard className="size-4 text-slate-400" aria-hidden /> Overview
                </Link>
              </CardContent>
            </Card>
          </aside>
        )}
      </main>

      <footer className="py-6 text-center text-xs text-slate-400">
        <Link to="/" className="inline-flex items-center gap-1 hover:text-slate-600">
          <LifeBuoy className="size-3.5" aria-hidden /> Powered by Support Desk
        </Link>
      </footer>
    </div>
  );
}
