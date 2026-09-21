import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

// Route handlers
import authRoutes from './src/backend/routes/auth.ts';
import projectRoutes from './src/backend/routes/projects.ts';
import deviceRoutes from './src/backend/routes/devices.ts';
import datastreamRoutes from './src/backend/routes/datastreams.ts';
import deviceApiRoutes from './src/backend/routes/deviceApi.ts';
import dataRoutes from './src/backend/routes/data.ts';
import notificationRoutes from './src/backend/routes/notifications.ts';
import batchRoutes from './src/backend/routes/batches.ts';
import batchItemRoutes from './src/backend/routes/batchItems.ts';

// WebSocket manager
import { initWebSocket, redisReady, distributedRealtimeReady, connectionState } from './src/backend/sockets/socketManager.ts';

// PostgreSQL and Prisma initialization
import { startPostgresServer } from './src/backend/pgServer.ts';
import { prisma, initDatabaseSchema } from './src/backend/db.ts';
import { startOfflineMonitor } from './src/backend/services/offlineMonitor.ts';
import { rehydrateScheduledBatches, recoverOrphanedBatches } from './src/backend/services/batchExecutionService.ts';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const rawPort = process.env.PORT ? process.env.PORT.trim() : '';
  const parsedPort = /^\d+$/.test(rawPort) ? parseInt(rawPort, 10) : NaN;
  const PORT =
    !isNaN(parsedPort) &&
    parsedPort > 0 &&
    parsedPort < 65536
      ? parsedPort
      : 3000;

  // Initialize Socket.IO with JWT Authentication and Room isolation
  const io = initWebSocket(server);
  console.log('[WEBSOCKET] Socket.IO server initialized and attached to HTTP server.');

  // 1. Start embedded PostgreSQL TCP server if needed
  await startPostgresServer();

  // 2. Connect to PostgreSQL via Prisma Client
  try {
    await prisma.$connect();
    console.log('[POSTGRES] Connected to PostgreSQL via Prisma Client successfully.');
    await initDatabaseSchema();
    startOfflineMonitor(60000);
    await rehydrateScheduledBatches().catch((err) => console.error('[BATCH-RECOVERY] Error rehydrating scheduled batches:', err));
    await recoverOrphanedBatches().catch((err) => console.error('[BATCH-RECOVERY] Error recovering orphaned batches:', err));
  } catch (dbErr) {
    console.error('[FATAL] Failed to connect to PostgreSQL via Prisma:', dbErr);
    process.exit(1);
  }

  // Basic security and parsing middleware
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token'],
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logger for IoT API monitoring
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/device/')) {
      console.log(`[API ${req.method}] ${req.path} - IP: ${req.ip}`);
    }
    next();
  });

  // Health check
  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const isHealthy = distributedRealtimeReady;
      
      const healthData = {
        status: isHealthy ? 'ok' : 'degraded',
        database: 'PostgreSQL + Prisma ORM',
        websocket: 'Socket.IO (Authenticated Rooms)',
        redis: redisReady ? 'connected' : 'unconnected',
        distributedRealtime: distributedRealtimeReady ? 'ready' : 'unavailable',
        connectionState: connectionState,
        service: 'ESP32 IoT Monitor Backend',
        phase: 2,
        time: new Date().toISOString(),
      };

      if (!isHealthy) {
        res.status(503).json(healthData);
      } else {
        res.json(healthData);
      }
    } catch (err) {
      res.status(500).json({
        status: 'error',
        database: 'PostgreSQL disconnected',
        error: String(err),
      });
    }
  });

  // ==========================================
  // REST API ROUTERS
  // ==========================================
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api', datastreamRoutes);
  app.use('/api/device', deviceApiRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api', dataRoutes);
  app.use('/api/batches', batchRoutes);
  app.use('/api/batches', batchItemRoutes);

  // Global API 404 handler
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'ENDPOINT_NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`,
    });
  });

  // ==========================================
  // VITE / STATIC SERVING
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] ESP32 IoT Monitor running on http://0.0.0.0:${PORT} (Phase 2 with WebSocket)`);
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});
