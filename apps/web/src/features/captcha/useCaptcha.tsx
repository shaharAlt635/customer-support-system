import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { usePublicConfig } from '../../api/queries';

/** The subset of Cloudflare's Turnstile API this app uses. */
interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      appearance: 'always' | 'interaction-only';
      size: 'flexible' | 'compact';
      theme: 'light';
    },
  ): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | undefined;

/** Load Cloudflare's script once, the first time a form with the human check is shown. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing'));
    script.onerror = () => {
      script.remove();
      loading = undefined; // allow a retry on the next mount
      reject(new Error('Could not load Turnstile'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

function TurnstileWidget({
  siteKey,
  compact,
  onToken,
  onError,
}: {
  siteKey: string;
  compact: boolean;
  onToken: (token: string | undefined) => void;
  onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handleToken = useEffectEvent(onToken);
  const handleError = useEffectEvent(onError);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (token) => handleToken(token),
          'expired-callback': () => handleToken(undefined),
          'error-callback': () => {
            handleToken(undefined);
            handleError();
          },
          // Invisible unless Cloudflare needs the visitor to click something.
          appearance: 'interaction-only',
          size: compact ? 'compact' : 'flexible',
          theme: 'light',
        });
      })
      .catch(() => handleError());
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, compact]);

  return <div ref={container} />;
}

/**
 * Human check for public forms. When the server has Turnstile keys, `widget` renders the
 * (usually invisible) check and `token` must be sent with the request; otherwise the
 * check is off and `ready` is always true.
 */
export function useCaptcha({ compact = false }: { compact?: boolean } = {}) {
  const { data: config } = usePublicConfig();
  const siteKey = config?.captchaSiteKey ?? null;
  const [token, setToken] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  const widget = siteKey ? (
    <div>
      <TurnstileWidget
        key={round}
        siteKey={siteKey}
        compact={compact}
        onToken={(value) => {
          setToken(value);
          if (value) setFailed(false);
        }}
        onError={() => setFailed(true)}
      />
      {failed && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          The anti-spam check didn&apos;t load. Check your connection or ad blocker, then reload the
          page.
        </p>
      )}
    </div>
  ) : null;

  return {
    widget,
    token,
    /** The form can be sent: settings are loaded and the check (if on) has passed. */
    ready: config !== undefined && (siteKey === null || token !== undefined),
    /** Tokens work once, so get a fresh one after every attempt. */
    reset: () => {
      setToken(undefined);
      setRound((value) => value + 1);
    },
  };
}
