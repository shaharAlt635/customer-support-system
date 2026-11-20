/**
 * Zero-install MongoDB for local development.
 *
 * Downloads an official MongoDB binary (first run only) and starts a single-node replica
 * set — which Prisma requires — on 127.0.0.1:27017. Data persists in `.mongo-data/`.
 * Use this when Docker or a local MongoDB installation is not available.
 *
 *   npm run db:local
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const dbPath = path.resolve(process.env.LOCAL_MONGO_DATA ?? '.mongo-data');
mkdirSync(dbPath, { recursive: true });

console.log('⏳ Starting local MongoDB replica set (the first run downloads MongoDB)…');

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});

const url = `mongodb://127.0.0.1:${port}/support_desk?directConnection=true`;
console.log(`\n✅ MongoDB is running (data: ${dbPath})`);
console.log(`   DATABASE_URL="${url}"\n`);
console.log('Press Ctrl+C to stop.');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping MongoDB…');
  // Keep the data directory so the next start resumes where you left off.
  await replSet.stop({ doCleanup: false });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
