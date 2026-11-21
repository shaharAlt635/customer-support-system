import { MailCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { usePublicConfig } from '../../api/queries';
import { Button } from '../../components/ui/Button';

const RESEND_COOLDOWN_SECONDS = 30;

interface CheckEmailNoticeProps {
  email: string;
  companySlug: string;
  message?: string;
}

/** Shown after sign-up: explains the confirmation email and offers a rate-limited resend. */
export function CheckEmailNotice({ email, companySlug, message }: CheckEmailNoticeProps) {
  const { data: config } = usePublicConfig();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    setSending(true);
    try {
      await authApi.resendVerification({ companySlug, email });
      toast.success('We sent you a new link');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl bg-brand-50 p-5 ring-1 ring-brand-100">
      <MailCheck className="size-8 text-brand-600" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-slate-900">Check your inbox</h2>
      <p className="mt-1 text-sm text-slate-600">
        {message ?? 'We sent a confirmation link to'}{' '}
        <strong className="font-medium text-slate-900">{email}</strong>. Click it to activate your
        account — the link is valid for 24 hours.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={resend}
          loading={sending}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
        </Button>
        {config?.devMailbox && (
          <Link
            to="/dev/mailbox"
            className="text-sm font-medium text-brand-700 hover:text-brand-900"
          >
            Open dev mailbox →
          </Link>
        )}
      </div>
    </div>
  );
}
