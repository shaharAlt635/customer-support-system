import type { ApiErrorBody, AuthResponse, ValidationIssue } from '@support-desk/shared';

const API_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ValidationIssue[];

  constructor(status: number, code: string, message: string, details: ValidationIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Session handling
// The access token lives only in memory; the refresh token is an httpOnly cookie the
// browser sends to /api/auth/refresh. A 401 triggers one transparent refresh + retry.
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
/** Accounts are per company, so the session (and refresh cookie) is tied to one company. */
let companySlug: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Switch the client to another company's session (drops the current access token). */
export function setCompanySlug(slug: string | null): void {
  if (slug !== companySlug) {
    companySlug = slug;
    accessToken = null;
    refreshInFlight = null;
  }
}

export function getCompanySlug(): string | null {
  return companySlug;
}

export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function performRefresh(attempt = 0): Promise<AuthResponse | null> {
  if (!companySlug) return null;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companySlug }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server.');
  }

  if (response.ok) {
    const session = (await response.json()) as AuthResponse;
    accessToken = session.accessToken;
    return session;
  }

  // Another tab rotated the cookie a moment ago; the browser now holds the new one.
  if (response.status === 401 && attempt === 0) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === 'SESSION_ROTATED') {
      await delay(250);
      return performRefresh(1);
    }
  }

  accessToken = null;
  return null;
}

/** Refresh the session once, even if many requests ask at the same time. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | null | undefined | readonly string[];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Set to false for endpoints where a 401 means "bad credentials", not "expired token". */
  auth?: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${API_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (body?.error) {
    return new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  }
  return new ApiError(response.status, 'HTTP_ERROR', `Request failed (${response.status})`);
}

async function send(path: string, options: RequestOptions, canRetry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection.');
  }

  if (response.status === 401 && canRetry && options.auth !== false) {
    const session = await refreshSession().catch(() => null);
    if (session) return send(path, options, false);
    sessionExpiredHandler?.();
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function requestBlob(path: string): Promise<Blob> {
  return (await send(path, {})).blob();
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
