import os from 'node:os';
import path from 'node:path';
import { inject } from 'vitest';

// Must run before the app (and its config module) is imported by a test file.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  JWT_ACCESS_SECRET: 'test-only-secret-with-more-than-32-characters',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  MAX_UPLOAD_SIZE_MB: '1',
  MAX_FILES_PER_UPLOAD: '3',
  ALLOW_REGISTRATION: 'true',
  SERVE_WEB: 'false',
  UPLOAD_DIR: path.join(os.tmpdir(), `support-desk-test-uploads-${process.pid}`),
});
