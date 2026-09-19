import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';

let serverInstance: any = null;
let pgliteDbInstance: any = null;

const PG_DIR = path.resolve(process.cwd(), 'data', 'postgres');
const PG_PORT = 5432;
const PG_HOST = '127.0.0.1';

/**
 * Check if PostgreSQL port is already open and accepting connections
 */
export async function isPgRunning(port = PG_PORT, host = PG_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Start embedded PostgreSQL TCP server if not already running
 */
export async function startPostgresServer(): Promise<void> {
  const alreadyRunning = await isPgRunning();
  if (alreadyRunning) {
    console.log(`[POSTGRES] PostgreSQL is already active and listening on ${PG_HOST}:${PG_PORT}`);
    return;
  }

  if (!fs.existsSync(PG_DIR)) {
    fs.mkdirSync(PG_DIR, { recursive: true });
  }

  // Ensure standard PostgreSQL subdirectories exist to prevent PGlite resume crashes
  const requiredSubdirs = [
    'pg_notify',
    'pg_tblspc',
    'pg_replslot',
    'pg_snapshots',
    'pg_stat',
    'pg_stat_tmp',
    'pg_commit_ts',
    'pg_twophase',
    'pg_logical/snapshots',
    'pg_logical/mappings',
    'pg_wal/archive_status',
  ];
  for (const subdir of requiredSubdirs) {
    const fullPath = path.join(PG_DIR, subdir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  pgliteDbInstance = new PGlite(PG_DIR);
  await pgliteDbInstance.waitReady;

  serverInstance = new PGLiteSocketServer({
    db: pgliteDbInstance,
    port: PG_PORT,
    host: PG_HOST,
    maxConnections: 100,
  });

  await serverInstance.start();
  console.log(`[POSTGRES] PostgreSQL server listening on ${PG_HOST}:${PG_PORT} (data dir: ${PG_DIR})`);
}

/**
 * Stop PostgreSQL server on shutdown
 */
export async function stopPostgresServer(): Promise<void> {
  if (serverInstance) {
    await serverInstance.stop();
    serverInstance = null;
  }
}
