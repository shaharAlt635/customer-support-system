import { EyeOff } from 'lucide-react';

/** Shown on anonymous tickets: who can see what. */
export function AnonymousNotice({ isRequester }: { isRequester: boolean }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
      <EyeOff className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
      <p>
        {isRequester
          ? "You submitted this ticket anonymously. The support team can't see your name or email — we only use your email to keep you updated."
          : 'The requester chose to stay anonymous. Replies still reach them by email, but their name and email are hidden from the team.'}
      </p>
    </div>
  );
}
