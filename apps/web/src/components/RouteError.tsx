import { TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';

/** Last-resort boundary for render errors and failed chunk loads. */
export function RouteError() {
  const error = useRouteError();
  const isChunkError =
    error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : isChunkError
      ? 'A new version of the app is available.'
      : 'An unexpected error occurred.';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-red-50">
        <TriangleAlert className="size-6 text-red-500" aria-hidden />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
      >
        Reload the page
      </button>
    </div>
  );
}
