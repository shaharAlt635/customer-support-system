import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, getErrorMessage } from '../api/client';

/**
 * Show server-side validation errors next to the matching form fields; anything that
 * does not map to a field becomes a toast.
 */
export function handleFormError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  if (error instanceof ApiError && error.details.length > 0) {
    let unmatched = false;
    for (const issue of error.details) {
      if ((fields as readonly string[]).includes(issue.path)) {
        setError(issue.path as Path<T>, { type: 'server', message: issue.message });
      } else {
        unmatched = true;
      }
    }
    if (!unmatched) return;
  }
  toast.error(getErrorMessage(error));
}
