#!/usr/bin/env node
/**
 * First-time setup: creates apps/server/.env (with a freshly generated JWT secret) and
 * apps/web/.env from the committed examples. Existing files are never overwritten.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createEnv(app, transform = (text) => text) {
  const example = path.join(root, 'apps', app, '.env.example');
  const target = path.join(root, 'apps', app, '.env');
  if (existsSync(target)) {
    console.log(`• apps/${app}/.env already exists — leaving it untouched`);
    return;
  }
  copyFileSync(example, target);
  writeFileSync(target, transform(readFileSync(target, 'utf8')));
  console.log(`✓ Created apps/${app}/.env`);
}

createEnv('server', (text) =>
  text.replace(
    /^JWT_ACCESS_SECRET=.*$/m,
    `JWT_ACCESS_SECRET="${randomBytes(48).toString('base64url')}"`,
  ),
);
createEnv('web');

console.log(`
Next steps:
  1. Start MongoDB (replica set):  npm run db:local      (or: docker compose up -d)
  2. Create collections & indexes: npm run db:push
  3. Load demo data:               npm run db:seed
  4. Start the app:                npm run dev            → http://localhost:5173
`);
