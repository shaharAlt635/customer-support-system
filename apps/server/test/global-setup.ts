import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

export async function setup(project: TestProject) {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const databaseUrl = replSet.getUri('support_desk_test');

  // Must be async: a blocking exec would stall the event loop that drains mongod's output.
  await promisify(exec)('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  project.provide('databaseUrl', databaseUrl);
}

export async function teardown() {
  await replSet?.stop();
}
