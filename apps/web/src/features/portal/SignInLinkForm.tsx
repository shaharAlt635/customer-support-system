import { emailSchema } from '@support-desk/shared';
import { MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { usePublicConfig } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useCaptcha } from '../captcha/useCaptcha';

/** "Email me a sign-in link" — the way back in for guests, who have no password. */
export function SignInLinkForm({
  companySlug,
  companyName,
}: {
  companySlug: string;
  companyName: string;
}) {
  const { data: config } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const [sending, setSending] = useState(false);
  // Sits in narrow side panels, so use Cloudflare's compact widget if a click is needed.
  const captcha = useCaptcha({ compact: true });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setSending(true);
    try {
      await authApi.magicLink({ companySlug, email: parsed.data }, captcha.token);
      setSentTo(parsed.data);
    } catch (err) {
      toast.error(getErrorMessage(err));
      captcha.reset();
    } finally {
      setSending(false);
    }
  };

  if (sentTo) {
    return (
      <div className="text-sm text-slate-600">
        <MailCheck className="mb-2 size-6 text-emerald-600" aria-hidden />
        If <strong className="font-medium text-slate-900">{sentTo}</strong> has requests with{' '}
        {companyName}, we sent it a sign-in link. It works once and expires in 30 minutes.
        {config?.devMailbox && (
          <Link to="/dev/mailbox" className="mt-2 block font-medium text-brand-700">
            Open dev mailbox →
          </Link>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <Input
        type="email"
        aria-label="Your email"
        placeholder="you@example.com"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setError(undefined);
        }}
        invalid={Boolean(error)}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {captcha.widget}
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        loading={sending}
        disabled={!captcha.ready}
      >
        Email me a sign-in link
      </Button>
    </form>
  );
}
