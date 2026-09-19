import { startPostgresServer } from '../src/backend/pgServer.ts';

async function main() {
  await startPostgresServer();
  console.log('[POSTGRES] Ready for Prisma commands.');
}

main().catch((err) => {
  console.error('[POSTGRES] Failed to start:', err);
  process.exit(1);
});
