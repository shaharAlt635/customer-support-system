/**
 * Vercel build (vercel.json → buildCommand; locally: `npm run build:vercel`).
 *
 * Writes `.vercel/output` in Vercel's Build Output API format: the React app as static
 * files, and the Fastify API as a single Node.js function that serves every /api/* request
 * on the same domain (so the httpOnly session cookie stays first-party).
 */
import { execSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';
import { build } from 'tsup';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'apps/server');
const out = path.join(root, '.vercel/output');
const posix = (file) => file.split(path.sep).join('/');
const run = (command, env = {}, cwd = root) =>
  execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

await rm(out, { recursive: true, force: true });

// 1. Database: sync collections and indexes with schema.prisma (refuses data loss).
if (process.env.DATABASE_URL) {
  run('npx prisma db push --skip-generate', {}, server);
} else {
  console.log('DATABASE_URL is not set: skipping `prisma db push`.');
}

// 2. Web app → static files (it reads demo mode and other settings from /api/config).
run('npm run build -w @support-desk/web');
await cp(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

// 3. API → bundle our code and the shared package (which ships TypeScript sources)…
const bundleDir = path.join(server, 'dist-vercel');
const serverPackage = JSON.parse(await readFile(path.join(server, 'package.json'), 'utf8'));
await build({
  config: false,
  entry: { index: path.join(server, 'src/vercel.ts') },
  outDir: bundleDir,
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  clean: true,
  splitting: false,
  silent: true,
  noExternal: ['@support-desk/shared'],
  external: Object.keys(serverPackage.dependencies ?? {}),
});

// …then copy exactly the files it needs at runtime (node_modules, Prisma's query engine).
const entry = path.join(bundleDir, 'index.mjs');
const functionDir = path.join(out, 'functions/api.func');
const { fileList } = await nodeFileTrace([entry], { base: root });
for (const file of fileList) {
  const target = path.join(functionDir, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, file), target, { dereference: true, recursive: true });
}
if (![...fileList].some((file) => /query_engine|libquery/.test(file))) {
  throw new Error('Prisma query engine was not traced into the function bundle');
}

const nodeMajor = process.versions.node.split('.')[0];
await writeFile(
  path.join(functionDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: `nodejs${nodeMajor}.x`,
      handler: posix(path.relative(root, entry)),
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // The daily demo reset reseeds the database; everything else answers in milliseconds.
      maxDuration: 300,
    },
    null,
    2,
  ),
);

// 4. Routing: /api/* → the function, files as-is, everything else → the React app.
await writeFile(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(?:/.*)?$', dest: '/api' },
        {
          src: '^/assets/(.*)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { handle: 'filesystem' },
        { src: '^/.*$', dest: '/index.html' },
      ],
      // Vercel Cron (production deployments only); needs CRON_SECRET to be set.
      crons: [{ path: '/api/cron/daily', schedule: '0 4 * * *' }],
    },
    null,
    2,
  ),
);

console.log(
  `\nBuild output ready in ${posix(path.relative(root, out))} (${fileList.size} files traced)`,
);
