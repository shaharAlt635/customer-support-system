import { buildApp } from './app';
import { ensureDatabaseIndexes } from './lib/db-maintenance';

async function main() {
  const app = await buildApp();

  try {
    await app.prisma.$connect();
    await ensureDatabaseIndexes(app.prisma);
  } catch (error) {
    app.log.fatal({ err: error }, 'Could not connect to MongoDB. Is DATABASE_URL correct?');
    process.exit(1);
  }

  await app.listen({ host: app.config.HOST, port: app.config.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down gracefully');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
