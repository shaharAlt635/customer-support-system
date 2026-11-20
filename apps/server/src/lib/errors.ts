import type { ValidationIssue } from '@support-desk/shared';

/**
 * An error that is safe to show to API clients. Anything else that reaches the error
 * handler is logged and reported as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ValidationIssue[];

  constructor(statusCode: number, code: string, message: string, details?: ValidationIssue[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message),
  validation: (details: ValidationIssue[]) =>
    new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details),
  unauthorized: (message = 'Authentication required', code = 'UNAUTHORIZED') =>
    new AppError(401, code, message),
  forbidden: (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
    new AppError(403, code, message),
  notFound: (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found`),
  conflict: (message: string, code = 'CONFLICT') => new AppError(409, code, message),
  payloadTooLarge: (message: string, code = 'PAYLOAD_TOO_LARGE') =>
    new AppError(413, code, message),
  unsupportedMediaType: (message: string, code = 'UNSUPPORTED_MEDIA_TYPE') =>
    new AppError(415, code, message),
};
