import { buildApp } from './app';
import { ensureDatabaseIndexes } from './lib/db-maintenance';

async function main() {
  const app = await buildApp();

  try {
    await app.prisma.$connect();
  } catch (error) {
    app.log.fatal({ err: error }, 'Could not connect to MongoDB. Is DATABASE_URL correct?');
    process.exit(1);
  }
  // Housekeeping indexes (token expiry); the API works without them, so don't block startup.
  await ensureDatabaseIndexes(app.prisma).catch((error: unknown) =>
    app.log.error({ err: error }, 'Could not create TTL indexes'),
  );

  // Unconfirmed public requests expire after 24 hours; sweep them (and their files) hourly.
  const sweep = () =>
    app.services.portal
      .cleanupExpired()
      .then((count) => count && app.log.info({ count }, 'Removed expired unconfirmed requests'))
      .catch((error: unknown) => app.log.error({ err: error }, 'Request cleanup failed'));
  const sweeper = setInterval(sweep, 60 * 60 * 1000);
  sweeper.unref();
  // Hooks must be registered before the server starts listening.
  app.addHook('onClose', async () => clearInterval(sweeper));

  await app.listen({ host: app.config.HOST, port: app.config.PORT });
  void sweep();

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
