import { z } from 'zod';

// Load `.env` from the working directory when present (Node >= 20.12). Real environment
// variables always win, so this is a no-op in containers/CI that inject config directly.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the process environment.
}

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1'));

/** Unset and empty (`KEY=` in .env) both mean "not configured". */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'DATABASE_URL must be a MongoDB connection string'),

  JWT_ACCESS_SECRET: z
    .string({ error: 'JWT_ACCESS_SECRET is required' })
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: booleanFlag,
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  TRUST_PROXY: booleanFlag,
  /** Let visitors create new companies from /signup. */
  ALLOW_COMPANY_SIGNUP: booleanFlag,
  /** Let visitors register customer accounts on a company's page. */
  ALLOW_REGISTRATION: booleanFlag,

  /** Public URL of the web app, used to build links in emails. */
  APP_URL: z.url().default('http://localhost:5173'),
  /** `smtp` sends real email; `dev` stores emails in the database for /dev/mailbox. */
  EMAIL_TRANSPORT: z.enum(['smtp', 'dev']).optional(),
  EMAIL_FROM: z.string().default('Support Desk <no-reply@example.com>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFlag,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().max(100).default(10),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().min(1).max(20).default(5),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Cloudflare Turnstile keys; when both are set, public forms require the human check. */
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,

  SERVE_WEB: booleanFlag,
  WEB_DIST_DIR: z.string().default('../web/dist'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const e = result.data;
  const isProduction = e.NODE_ENV === 'production';
  const emailTransport = e.EMAIL_TRANSPORT ?? (isProduction ? 'smtp' : 'dev');
  if (isProduction && emailTransport === 'dev') {
    // The dev mailbox is unreachable in production, so emails would silently go nowhere.
    throw new Error(
      'Invalid environment configuration:\n  - EMAIL_TRANSPORT: "dev" is not allowed in production',
    );
  }
  if (emailTransport === 'smtp' && !e.SMTP_HOST) {
    throw new Error(
      'Invalid environment configuration:\n  - SMTP_HOST: required when EMAIL_TRANSPORT=smtp ' +
        '(set EMAIL_TRANSPORT=dev to keep emails in the dev mailbox instead)',
    );
  }

  if (Boolean(e.TURNSTILE_SITE_KEY) !== Boolean(e.TURNSTILE_SECRET_KEY)) {
    throw new Error(
      'Invalid environment configuration:\n  - TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY: set both to enable the human check, or neither',
    );
  }

  return {
    ...e,
    isProduction,
    /** Human check on public forms (Cloudflare Turnstile), or null when disabled. */
    captcha:
      e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY
        ? { siteKey: e.TURNSTILE_SITE_KEY, secretKey: e.TURNSTILE_SECRET_KEY }
        : null,
    isTest: e.NODE_ENV === 'test',
    COOKIE_SECURE: e.COOKIE_SECURE ?? isProduction,
    TRUST_PROXY: e.TRUST_PROXY ?? false,
    ALLOW_REGISTRATION: e.ALLOW_REGISTRATION ?? true,
    ALLOW_COMPANY_SIGNUP: e.ALLOW_COMPANY_SIGNUP ?? true,
    EMAIL_TRANSPORT: emailTransport,
    SMTP_SECURE: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
    APP_URL: e.APP_URL.replace(/\/$/, ''),
    /** The dev mailbox API is never exposed in production. */
    devMailboxEnabled: emailTransport === 'dev' && !isProduction,
    SERVE_WEB: e.SERVE_WEB ?? false,
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_SIZE_MB * 1024 * 1024),
  };
}
