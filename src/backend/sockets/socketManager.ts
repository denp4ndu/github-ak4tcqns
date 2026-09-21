import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyUserJwt, hashDeviceToken } from '../auth.ts';
import {
  getDeviceByTokenHash,
  getDeviceById,
  getDeviceByIdentifier,
  getDatastreamsByDeviceId,
  insertSensorData,
  ingestTelemetryAtomic,
  updateDeviceLastSeen,
  prisma,
} from '../db.ts';
import { validateDatastreamValue } from '../services/iotService.ts';
import { batchInFlightCommands } from '../services/batchExecutionService.ts';
import { ErrorCode } from '../types.ts';

let ioInstance: SocketIOServer | null = null;
let redisOperational = false;
let pubClient: ReturnType<typeof createClient> | null = null;
let subClient: ReturnType<typeof createClient> | null = null;

interface PendingCommand {
  commandId: string;
  deviceId: string;
  deviceIdentifier: string;
  virtualPin: string;
  targetValue: boolean | number | string;
  userId: string;
  createdAt: number;
  timeoutTimer: NodeJS.Timeout;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
}

const pendingCommandsMap = new Map<string, PendingCommand>();

export let redisReady = false;
export let distributedRealtimeReady = false;
export let connectionState: 'STARTING' | 'REDIS_CONNECTING' | 'READY' | 'REDIS_UNAVAILABLE' | 'DEGRADED' = 'STARTING';

/**
 * Handle Redis connection failures or disconnects by transitioning to degraded state
 */
export function handleRedisFailure(): void {
  if (connectionState === 'READY') {
    connectionState = 'REDIS_UNAVAILABLE';
    redisReady = false;
    distributedRealtimeReady = false;
    console.warn('[WS-REDIS] State Transition: READY -> REDIS_UNAVAILABLE (Entering DEGRADED)');
    connectionState = 'DEGRADED';
    failAllPendingCommandsOnFailure();
  } else if (connectionState === 'STARTING' || connectionState === 'REDIS_CONNECTING') {
    connectionState = 'REDIS_UNAVAILABLE';
    redisReady = false;
    distributedRealtimeReady = false;
    console.warn('[WS-REDIS] State Transition: CONNECTING -> REDIS_UNAVAILABLE (Entering DEGRADED)');
    connectionState = 'DEGRADED';
  }
}

/**
 * Check and verify Redis connectivity to recover from degraded state
 */
export async function checkRedisAndRestore(): Promise<void> {
  if (pubClient?.isOpen && subClient?.isOpen) {
    if (connectionState !== 'READY') {
      console.log('[WS-REDIS] State Transition: DEGRADED -> REDIS_CONNECTING');
      connectionState = 'REDIS_CONNECTING';
      
      try {
        const pingResult = await pubClient.ping();
        if (pingResult === 'PONG') {
          console.log('[WS-REDIS] PING/PONG verified successfully.');
          
          if (ioInstance) {
            ioInstance.adapter(createAdapter(pubClient!, subClient!));
          }
          
          redisReady = true;
          distributedRealtimeReady = true;
          redisOperational = true;
          connectionState = 'READY';
          console.log('[WS-REDIS] State Transition: REDIS_CONNECTING -> READY. Distributed realtime is now healthy!');
        } else {
          throw new Error('Invalid ping response: ' + pingResult);
        }
      } catch (err: any) {
        console.error('[WS-REDIS] Verification failed during recovery:', err);
        handleRedisFailure();
      }
    }
  }
}

/**
 * Clean up pending commands in the database and notify users deterministically when Redis fails
 */
export async function failAllPendingCommandsOnFailure(): Promise<void> {
  try {
    const updated = await prisma.deviceCommand.updateMany({
      where: {
        status: 'PENDING',
      },
      data: {
        status: 'TIMEOUT',
      },
    });
    console.log(`[WS-REDIS-FAIL-CLEANUP] Atomic cleanup: Transitioned ${updated.count} stuck PENDING commands to TIMEOUT.`);
    
    for (const pending of pendingCommandsMap.values()) {
      if (pending.status === 'PENDING') {
        clearTimeout(pending.timeoutTimer);
        pending.status = 'TIMEOUT';
        
        const timeoutPayload: StateUpdatedPayload = {
          deviceId: pending.deviceId,
          deviceIdentifier: pending.deviceIdentifier,
          virtualPin: pending.virtualPin,
          value: pending.targetValue,
          status: 'TIMEOUT',
          commandId: pending.commandId,
          timestamp: new Date().toISOString(),
        };
        ioInstance?.to(`room_user_${pending.userId}`).emit('state_updated', timeoutPayload);
      }
    }
    pendingCommandsMap.clear();
  } catch (err) {
    console.error('[WS-REDIS-FAIL-CLEANUP] Failed to transition pending commands in DB:', err);
  }
}


export interface SensorUpdatePayload {
  deviceId: string; // e.g. "ESP32-001" or deviceIdentifier
  rawDeviceId?: string; // database UUID
  datastreamId?: string; // datastream UUID
  virtualPin?: string; // e.g. "V0"
  value?: string | number | boolean;
  numericValue?: number | null;
  timestamp: string; // ISO 8601 string
  data: Record<string, any>; // e.g. { V0: 67, V2: 1880 }
}

export interface StateUpdatedPayload {
  deviceId: string; // UUID of device
  deviceIdentifier: string; // Hardware tag e.g. "ESP32-001"
  virtualPin: string; // e.g. "V3"
  value: boolean | number | string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  timestamp: string;
  commandId?: string;
}

export interface DeviceCommandPayload {
  virtualPin: string;
  value: boolean | number | string;
  commandId?: string;
  timestamp?: string;
}

export interface CommandAckPayload {
  deviceToken?: string;
  virtualPin: string;
  value: boolean | number | string;
  status?: string;
  commandId?: string;
}

interface PendingCommand {
  commandId: string;
  deviceId: string;
  deviceIdentifier: string;
  virtualPin: string;
  targetValue: boolean | number | string;
  userId: string;
  createdAt: number;
  timeoutTimer: NodeJS.Timeout;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
}

// Map tracking in-flight commands for 5-second ACK timeout and correlation


/**
 * Initialize Socket.IO server with dual authentication:
 * 1. User Client (JWT from Browser) -> joins room_user_${userId}
 * 2. Device Client (Device Token from ESP32) -> joins room_device_${deviceId}
 */
export function initWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 25000,
    pingInterval: 30000,
  });

  // Async Redis client connection & Adapter mounting
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  pubClient = createClient({ url: redisUrl });
  subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('[WS-REDIS-PUB] Error:', err));
  subClient.on('error', (err) => console.error('[WS-REDIS-SUB] Error:', err));

  pubClient.connect()
    .then(() => subClient!.connect())
    .then(() => {
      io.adapter(createAdapter(pubClient!, subClient!));
      redisReady = true;
      distributedRealtimeReady = true;
      redisOperational = true;
      connectionState = 'READY';
      console.log(`[WS-REDIS] Scaled Socket.IO with Redis Adapter connected successfully to ${redisUrl}`);
    })
    .catch((err) => {
      console.error(
        `[WS-REDIS-FATAL] Redis client failed to connect to ${redisUrl}. Socket.IO distributed realtime functionality is UNAVAILABLE. Error: ${err.message}`
      );
      // Fail closed: Do NOT set an adapter, and keep redisReady/distributedRealtimeReady as false
      handleRedisFailure();
    });


  // -----------------------------------------------------------
  // WebSocket Security & Dual Client Authentication Middleware
  // Distinguish between Browser User (JWT) and Hardware ESP32 (Device Token)
  // -----------------------------------------------------------
  io.use(async (socket: Socket, next) => {
    try {
      // 1. Check if connecting as Hardware Device via Device Token
      const candidateDeviceToken =
        socket.handshake.auth?.deviceToken ||
        socket.handshake.query?.deviceToken ||
        socket.handshake.headers?.['x-device-token'] ||
        (typeof socket.handshake.auth?.token === 'string' &&
        socket.handshake.auth.token.startsWith('esp32_tok_')
          ? socket.handshake.auth.token
          : undefined) ||
        (typeof socket.handshake.query?.token === 'string' &&
        socket.handshake.query.token.startsWith('esp32_tok_')
          ? socket.handshake.query.token
          : undefined);

      if (candidateDeviceToken && typeof candidateDeviceToken === 'string') {
        const cleanDevToken = candidateDeviceToken.trim();

        // Support preview device token for local development & testing
        if (cleanDevToken === 'preview-device-token') {
          let realDeviceId = 'preview-device-001';
          let realOwnerId = 'preview-user-001';
          try {
            const realDevice = await getDeviceByIdentifier('ESP32-001');
            if (realDevice) {
              realDeviceId = realDevice.id;
              realOwnerId = realDevice.userId;
            }
          } catch {
            // Graceful fallback if database lookup fails
          }

          socket.data.clientType = 'device';
          socket.data.deviceId = realDeviceId;
          socket.data.deviceIdentifier = 'ESP32-001';
          socket.data.userId = realOwnerId;
          socket.data.deviceToken = cleanDevToken;

          console.log(
            `[WS-DEVICE-AUTH] Device connected (Preview Device ESP32-001, DB ID: ${socket.data.deviceId})`
          );
          return next();
        }

        const tokenHash = hashDeviceToken(cleanDevToken);
        const device = await getDeviceByTokenHash(tokenHash);

        if (!device) {
          console.warn(`[WS-DEVICE-AUTH] Connection rejected: Invalid device token for socket ${socket.id}`);
          return next(new Error('INVALID_DEVICE_TOKEN'));
        }

        // Authenticated as Hardware Device
        socket.data.clientType = 'device';
        socket.data.deviceId = device.id;
        socket.data.deviceIdentifier = device.deviceIdentifier;
        socket.data.userId = device.userId;
        socket.data.deviceToken = cleanDevToken;

        console.log(
          `[WS-DEVICE-AUTH] Device connected: ${device.deviceIdentifier} (ID: ${device.id}) for User: ${device.userId}`
        );
        return next();
      }

      // 2. Otherwise authenticate as Web User via JWT
      const rawUserToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!rawUserToken || typeof rawUserToken !== 'string') {
        console.warn(`[WS-AUTH] Connection rejected: Missing token (socket ${socket.id})`);
        return next(new Error('AUTHENTICATION_REQUIRED'));
      }

      const token = rawUserToken.replace(/^Bearer\s+/i, '').trim();

      // Support preview user token for local development & testing
      if (token === 'stackblitz-preview-token') {
        let realUserId = 'preview-user-001';
        try {
          const user = await prisma.user.findFirst({ where: { email: 'demo@esp32.io' } });
          if (user) {
            realUserId = user.id;
          }
        } catch {
          // Graceful fallback
        }
        socket.data.clientType = 'user';
        socket.data.userId = realUserId;
        socket.data.userEmail = 'demo@esp32.io';
        return next();
      }

      const user = verifyUserJwt(token);
      if (!user) {
        console.warn(`[WS-AUTH] Connection rejected: Invalid or expired JWT (socket ${socket.id})`);
        return next(new Error('INVALID_TOKEN'));
      }

      // Authenticated as Web User
      socket.data.clientType = 'user';
      socket.data.userId = user.id;
      socket.data.userEmail = user.email;

      return next();
    } catch (err: any) {
      console.error('[WS-AUTH] Authentication exception:', err?.message || err);
      next(new Error('AUTHENTICATION_FAILED'));
    }
  });

  // -----------------------------------------------------------
  // Connection Handler & Multi-Tenant Room Isolation
  // -----------------------------------------------------------
  io.on('connection', async (socket: Socket) => {
    // =========================================================
    // CASE A: HARDWARE ESP32 WEBSOCKET CLIENT
    // =========================================================
    if (socket.data.clientType === 'device') {
      const deviceId = socket.data.deviceId;
      const deviceIdentifier = socket.data.deviceIdentifier;
      const ownerUserId = socket.data.userId;

      // Join isolated device control room
      const deviceRoom = `room_device_${deviceId}`;
      const deviceIdentRoom = `room_device_ident_${deviceIdentifier}`;
      socket.join(deviceRoom);
      socket.join(deviceIdentRoom);

      console.log(
        `[WS-DEVICE] ESP32 joined room: ${deviceRoom} & ${deviceIdentRoom} (Device: ${deviceIdentifier})`
      );

      // Update last seen in DB (non-blocking)
      updateDeviceLastSeen(deviceId, new Date()).catch((lastSeenErr) => {
        console.warn(`[WS-DEVICE] Could not update lastSeen for ${deviceId}:`, lastSeenErr);
      });

      // Notify owner's browser that device is now ONLINE
      io.to(`room_user_${ownerUserId}`).emit('device_status_change', {
        deviceId: deviceIdentifier,
        status: 'ONLINE',
        lastSeen: new Date().toISOString(),
      });

      // Send connection confirmation to ESP32
      socket.emit('device_ready', {
        connected: true,
        deviceId,
        deviceIdentifier,
        serverTime: new Date().toISOString(),
      });

      // Handle Event C: command_ack from ESP32
      socket.on('command_ack', async (payload: CommandAckPayload) => {
        try {
          console.log(
            `[WS-ACK] Received ACK from ESP32 ${deviceIdentifier}:`,
            JSON.stringify(payload)
          );

          if (!payload || !payload.virtualPin) {
            console.warn(`[WS-ACK] Malformed ACK payload from ${deviceIdentifier}`);
            return;
          }

          const normalizedPin = payload.virtualPin.toUpperCase().trim();
          const ackStatus = (payload.status || 'SUCCESS').toUpperCase();
          const isSuccess = ackStatus === 'SUCCESS';
          const now = new Date();
          const ackCommandId = payload.commandId;

          // Correlate with pending commands for 5s timeout and idempotency
          let pending: {
            commandId: string;
            deviceId: string;
            deviceIdentifier: string;
            virtualPin: string;
            targetValue: boolean | number | string;
            userId: string;
            status: string;
            timeoutTimer?: NodeJS.Timeout;
          } | undefined;

          let resolvedFromDb = false;

          if (ackCommandId) {
            // First check database for this commandId to enforce distributed state lookup
            try {
              const dbCmd = await prisma.deviceCommand.findUnique({
                where: { id: ackCommandId },
              });

              if (dbCmd) {
                // Validate device ownership of commandId
                if (dbCmd.deviceId !== deviceId) {
                  console.warn(
                    `[WS-ACK-SECURITY] Rejecting unauthorized ACK: Device ${deviceIdentifier} (${deviceId}) tried to ACK command ${ackCommandId} belonging to device ${dbCmd.deviceId}`
                  );
                  return;
                }

                pending = {
                  commandId: dbCmd.id,
                  deviceId: dbCmd.deviceId,
                  deviceIdentifier: dbCmd.deviceIdentifier,
                  virtualPin: dbCmd.virtualPin,
                  targetValue: dbCmd.targetValue,
                  userId: dbCmd.userId,
                  status: dbCmd.status,
                };
                resolvedFromDb = true;

                // Bind the timer if we are on the instance that holds it
                const memPending = pendingCommandsMap.get(ackCommandId);
                if (memPending) {
                  pending.timeoutTimer = memPending.timeoutTimer;
                }
              }
            } catch (dbErr) {
              console.error('[WS-ACK-DB] Failed to look up command in DB:', dbErr);
            }
          }

          // Fallback to local memory maps if not resolved from DB
          if (!pending) {
            if (ackCommandId && pendingCommandsMap.has(ackCommandId)) {
              const candidatePending = pendingCommandsMap.get(ackCommandId);
              // C. Validate device ownership of commandId
              if (candidatePending && candidatePending.deviceId === deviceId) {
                pending = candidatePending;
              } else if (candidatePending) {
                console.warn(
                  `[WS-ACK-SECURITY] Rejecting unauthorized ACK: Device ${deviceIdentifier} (${deviceId}) tried to ACK command ${ackCommandId} belonging to device ${candidatePending.deviceId}`
                );
                return;
              }
            } else if (ackCommandId && batchInFlightCommands.has(ackCommandId)) {
              // Validate batch command device ownership
              const expectedDeviceId = batchInFlightCommands.get(ackCommandId);
              if (expectedDeviceId !== deviceId) {
                console.warn(
                  `[WS-ACK-SECURITY] Rejecting unauthorized batch ACK: Device ${deviceIdentifier} (${deviceId}) tried to ACK command ${ackCommandId} belonging to device ${expectedDeviceId}`
                );
                return;
              }
            } else {
              // Fallback: match latest pending command for this device & pin from DB or local memory
              try {
                const dbCmd = await prisma.deviceCommand.findFirst({
                  where: {
                    deviceId,
                    virtualPin: normalizedPin,
                    status: 'PENDING',
                  },
                  orderBy: { createdAt: 'desc' },
                });

                if (dbCmd) {
                  pending = {
                    commandId: dbCmd.id,
                    deviceId: dbCmd.deviceId,
                    deviceIdentifier: dbCmd.deviceIdentifier,
                    virtualPin: dbCmd.virtualPin,
                    targetValue: dbCmd.targetValue,
                    userId: dbCmd.userId,
                    status: dbCmd.status,
                  };
                  resolvedFromDb = true;

                  const memPending = pendingCommandsMap.get(dbCmd.id);
                  if (memPending) {
                    pending.timeoutTimer = memPending.timeoutTimer;
                  }
                }
              } catch (dbErr) {
                console.error('[WS-ACK-DB] Failed to find latest pending command in DB:', dbErr);
              }

              if (!pending) {
                for (const cmd of pendingCommandsMap.values()) {
                  if (
                    cmd.deviceId === deviceId &&
                    cmd.virtualPin === normalizedPin &&
                    cmd.status === 'PENDING'
                  ) {
                    pending = cmd;
                    break;
                  }
                }
              }
            }
          }

          if (pending) {
            // 1. Idempotency protection against duplicate ACKs
            if (pending.status === 'SUCCESS' || pending.status === 'FAILED') {
              console.warn(
                `[WS-ACK-DUPLICATE] Duplicate ACK ignored for command ${pending.commandId} (current status: ${pending.status})`
              );
              return;
            }

            // 2. Late ACK protection: command already timed out after 5 seconds
            if (pending.status === 'TIMEOUT') {
              console.warn(
                `[WS-ACK-LATE] Late ACK received for timed out command ${pending.commandId}. Discarding without overriding TIMEOUT.`
              );
              return;
            }

            // 3. Atomically transition command status in PostgreSQL if resolved from DB
            let transitionSucceeded = true;
            if (resolvedFromDb) {
              try {
                const updated = await prisma.deviceCommand.updateMany({
                  where: {
                    id: pending.commandId,
                    status: 'PENDING',
                  },
                  data: {
                    status: isSuccess ? 'SUCCESS' : 'FAILED',
                  },
                });
                transitionSucceeded = updated.count === 1;
              } catch (dbErr) {
                console.error('[WS-ACK-DB] Failed to update command status in DB:', dbErr);
                transitionSucceeded = false;
              }
            }

            if (!transitionSucceeded) {
              console.warn(
                `[WS-ACK-LATE] Late ACK or race condition detected for command ${pending.commandId}. Discarding without overriding TIMEOUT.`
              );
              return;
            }

            // 4. Update the local memory map status and clear the timeout timer if present
            if (pending.timeoutTimer) {
              clearTimeout(pending.timeoutTimer);
            }
            const pendingMem = pendingCommandsMap.get(pending.commandId);
            if (pendingMem) {
              clearTimeout(pendingMem.timeoutTimer);
              pendingMem.status = (isSuccess ? 'SUCCESS' : 'FAILED') as any;
            }
          }

          // GAP-DISPATCH-001: Deterministic ACK bridge - emit locally to the batch execution engine
          const ackEventPayload = {
            commandId: ackCommandId || pending?.commandId,
            status: isSuccess ? 'SUCCESS' : 'FAILED',
            error: (payload as any).error || (isSuccess ? undefined : 'Hardware error'),
          };
          EventEmitter.prototype.emit.call(io.sockets, 'command_ack_event', ackEventPayload);

          // If device confirmed physical execution, persist new state into PostgreSQL SensorData (for real devices)
          if (isSuccess && deviceId !== 'preview-device-001') {
            try {
              const registeredStreams = await getDatastreamsByDeviceId(deviceId);
              const stream = registeredStreams.find(
                (s) => s.virtualPin.toUpperCase() === normalizedPin
              );

              if (stream) {
                const isBool = typeof payload.value === 'boolean';
                const boolVal = isBool
                  ? payload.value
                  : payload.value === 'true' || payload.value === 1 || payload.value === '1';
                const strVal = String(payload.value);
                const numVal = isBool
                  ? payload.value
                    ? 1
                    : 0
                  : typeof payload.value === 'number'
                  ? payload.value
                  : boolVal
                  ? 1
                  : 0;

                await insertSensorData({
                  id: randomUUID(),
                  deviceId,
                  datastreamId: stream.id,
                  value: strVal,
                  numericValue: numVal,
                  timestamp: now,
                });

                console.log(
                  `[WS-ACK] Persisted actuator state in PostgreSQL for ${deviceIdentifier} pin ${normalizedPin} = ${strVal}`
                );
              } else {
                console.warn(
                  `[WS-ACK] Datastream ${normalizedPin} not registered for device ${deviceId}`
                );
              }

              await updateDeviceLastSeen(deviceId, now);
            } catch (dbErr) {
              console.error('[WS-ACK] Database persistence error:', dbErr);
            }
          }

          // Step 8: Forward ACK to Web Dashboard in User Room with commandId
          const stateUpdatedPayload: StateUpdatedPayload = {
            deviceId,
            deviceIdentifier,
            virtualPin: normalizedPin,
            value: payload.value,
            status: isSuccess ? 'SUCCESS' : 'FAILED',
            timestamp: now.toISOString(),
            commandId: ackCommandId || pending?.commandId,
          };

          io.to(`room_user_${ownerUserId}`).emit('state_updated', stateUpdatedPayload);

          // Also emit standard sensor_update to keep visualizers & value cards in sync
          emitSensorUpdateToUser(ownerUserId, {
            deviceId: deviceIdentifier,
            timestamp: now.toISOString(),
            data: {
              [normalizedPin]: payload.value,
            },
          });

          console.log(
            `[WS-ACK] Forwarded 'state_updated' to room_user_${ownerUserId} for ${normalizedPin}${
              stateUpdatedPayload.commandId ? ` (ID: ${stateUpdatedPayload.commandId})` : ''
            }`
          );
        } catch (ackError: any) {
          console.error('[WS-ACK] Error processing command_ack:', ackError);
        }
      });

      // Phase 2B: Telemetry Validation Engine
      socket.on('telemetry_update', async (payload: any) => {
        try {
          console.log('[WS-TELEMETRY] Received telemetry_update event:', JSON.stringify(payload));
          // 1. Structure & Type Validation (DoD: Malformed payload rejection)
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            console.warn(
              `[WS-TELEMETRY-REJECT] Malformed payload (not an object) from ${deviceIdentifier} (${deviceId})`
            );
            return;
          }

          if (
            !payload.data ||
            typeof payload.data !== 'object' ||
            Array.isArray(payload.data)
          ) {
            console.warn(
              `[WS-TELEMETRY-REJECT] Malformed payload (missing or non-object 'data') from ${deviceIdentifier} (${deviceId})`
            );
            return;
          }

          const pinKeys = Object.keys(payload.data);
          if (pinKeys.length === 0) {
            console.warn(
              `[WS-TELEMETRY-REJECT] Malformed payload (empty 'data' object) from ${deviceIdentifier} (${deviceId})`
            );
            return;
          }

          // 2. Ownership & Anti-Spoofing Identity Validation (DoD: Unauthorized rejection)
          if (payload.deviceId && payload.deviceId !== deviceId && payload.deviceId !== deviceIdentifier) {
            console.warn(
              `[SECURITY] Rejected telemetry: spoofed deviceId '${payload.deviceId}' does not match authenticated '${deviceId}'`
            );
            return;
          }

          if (payload.deviceIdentifier && payload.deviceIdentifier !== deviceIdentifier) {
            console.warn(
              `[SECURITY] Rejected telemetry: spoofed deviceIdentifier '${payload.deviceIdentifier}' does not match authenticated '${deviceIdentifier}'`
            );
            return;
          }

          if (payload.userId && payload.userId !== ownerUserId) {
            console.warn(
              `[SECURITY] Rejected telemetry: spoofed userId '${payload.userId}' does not match authenticated owner '${ownerUserId}'`
            );
            return;
          }

          // 3. Timestamp Validation
          if (payload.timestamp !== undefined && payload.timestamp !== null) {
            if (typeof payload.timestamp !== 'string') {
              console.warn(
                `[WS-TELEMETRY-REJECT] Invalid timestamp type (must be ISO string) from ${deviceIdentifier}`
              );
              return;
            }
            const parsedTs = new Date(payload.timestamp).getTime();
            if (isNaN(parsedTs)) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Unparseable timestamp '${payload.timestamp}' from ${deviceIdentifier}`
              );
              return;
            }
            const now = Date.now();
            if (parsedTs > now + 300000) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Future timestamp '${payload.timestamp}' from ${deviceIdentifier}`
              );
              return;
            }
            if (parsedTs < now - 30 * 24 * 60 * 60 * 1000) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Expired timestamp '${payload.timestamp}' from ${deviceIdentifier}`
              );
              return;
            }
          }

          const effectiveTimestamp = payload.timestamp
            ? new Date(payload.timestamp).toISOString()
            : new Date().toISOString();

          // 4. Datastream & Virtual Pin Validation (DoD: Invalid datastream rejection)
          let targetDeviceId = deviceId;
          let registeredStreams = await getDatastreamsByDeviceId(deviceId);
          if (registeredStreams.length === 0 || targetDeviceId === 'preview-device-001') {
            const dev = await getDeviceByIdentifier(deviceIdentifier);
            if (dev) {
              targetDeviceId = dev.id;
              registeredStreams = await getDatastreamsByDeviceId(dev.id);
            }
          }

          const streamMap = new Map(
            registeredStreams.map((s) => [s.virtualPin.toUpperCase().trim(), s])
          );

          // Atomic validation loop: verify every pin and value before accepting
          for (const key of pinKeys) {
            const trimmedKey = typeof key === 'string' ? key.trim() : '';
            if (!trimmedKey || !/^V\d+$/i.test(trimmedKey)) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Invalid virtual pin syntax '${key}' from ${deviceIdentifier}`
              );
              return;
            }

            const normPin = trimmedKey.toUpperCase();
            const stream = streamMap.get(normPin);
            if (!stream) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Virtual pin '${normPin}' is not registered on device ${deviceIdentifier}`
              );
              return;
            }

            // 5. Value & Range Validation (DoD: Invalid value rejection)
            const rawVal = payload.data[key];
            const validation = validateDatastreamValue(stream, rawVal);
            if (!validation.valid) {
              console.warn(
                `[WS-TELEMETRY-REJECT] Invalid value for ${normPin} (${validation.errorCode}): ${validation.errorMessage}`
              );
              return;
            }
          }

          // Telemetry accepted after full validation
          console.log(
            `[WS-TELEMETRY-ACCEPTED] Validated telemetry accepted from ${deviceIdentifier} (${deviceId}):`,
            JSON.stringify(payload.data)
          );

          // ---------------------------------------------------------
          // Phase 2C: Telemetry Persistence Engine (PostgreSQL / Prisma)
          // ---------------------------------------------------------
          const validReadingsToStore = pinKeys.map((key) => {
            const normPin = key.trim().toUpperCase();
            const stream = streamMap.get(normPin)!;
            const rawVal = payload.data[key];
            const validation = validateDatastreamValue(stream, rawVal);
            return {
              id: randomUUID(),
              deviceId: targetDeviceId,
              datastreamId: stream.id,
              value: validation.normalizedValue!,
              numericValue: validation.numericValue ?? null,
              timestamp: effectiveTimestamp,
            };
          });

          // Atomic Ingestion: Persist readings and update device lastSeen in single transaction
          await ingestTelemetryAtomic(targetDeviceId, validReadingsToStore, effectiveTimestamp);

          console.log(
            `[WS-TELEMETRY-PERSISTED] Ingested ${validReadingsToStore.length} sensor readings in PostgreSQL for ${deviceIdentifier} (${targetDeviceId}) at ${effectiveTimestamp}`
          );

          // ---------------------------------------------------------
          // Phase 2D: Realtime Telemetry Broadcast Engine
          // Emitted ONLY AFTER successful PostgreSQL transaction commit.
          // Exactly 1 sensor_update broadcast per persisted reading.
          // ---------------------------------------------------------
          for (const reading of validReadingsToStore) {
            const stream = registeredStreams.find((d: any) => d.id === reading.datastreamId);
            const virtualPin = stream ? stream.virtualPin : 'V?';
            const numVal = reading.numericValue !== null ? reading.numericValue : parseFloat(reading.value);

            const sensorUpdatePayload: SensorUpdatePayload = {
              deviceId: deviceIdentifier, // Primary identifier for frontend UI & dashboard matching
              rawDeviceId: targetDeviceId, // PostgreSQL UUID
              datastreamId: reading.datastreamId,
              virtualPin,
              value: reading.value,
              numericValue: isNaN(numVal) ? null : numVal,
              timestamp: effectiveTimestamp,
              data: {
                [virtualPin]: isNaN(numVal) ? reading.value : numVal,
              },
            };

            const userRoom = `room_user_${ownerUserId}`;
            const deviceSubRoom = `room_sub_device_${targetDeviceId}`;
            const deviceIdentSubRoom = `room_sub_device_${deviceIdentifier}`;

            // Socket.IO deduplicates delivery across chained target rooms
            io.to(userRoom)
              .to(deviceSubRoom)
              .to(deviceIdentSubRoom)
              .emit('sensor_update', sensorUpdatePayload);

            console.log(
              `[WS-BROADCAST-2D] Emitted 'sensor_update' for ${deviceIdentifier}:${virtualPin} to rooms [${userRoom}, ${deviceSubRoom}]`
            );
          }
        } catch (telemetryErr) {
          console.error(`[WS-TELEMETRY] Error handling telemetry_update from ${deviceIdentifier}:`, telemetryErr);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[WS-DEVICE] ESP32 disconnected: ${deviceIdentifier} (Reason: ${reason})`);
        
        // Notify owner's browser that device is now OFFLINE
        io.to(`room_user_${ownerUserId}`).emit('device_status_change', {
          deviceId: deviceIdentifier,
          status: 'OFFLINE',
          lastSeen: new Date().toISOString(),
        });
      });

      return;
    }

    // =========================================================
    // CASE B: BROWSER USER WEBSOCKET CLIENT
    // =========================================================
    const userId = socket.data.userId;
    const userRoom = `room_user_${userId}`;

    // Join user-specific isolated room
    socket.join(userRoom);
    console.log(
      `[WS-USER] Client authenticated: socket ${socket.id} joined ${userRoom} (User: ${socket.data.userEmail})`
    );

    // Send connection confirmation
    socket.emit('ws_ready', {
      connected: true,
      userId,
      room: userRoom,
      serverTime: new Date().toISOString(),
    });

    // ---------------------------------------------------------
    // Phase 3: Event A: User Web Dashboard -> Backend: send_command
    // ---------------------------------------------------------
    socket.on(
      'send_command',
      async (
        payload: { deviceId: string; virtualPin: string; value: boolean | number | string },
        callback?: (res: { success: boolean; message?: string; isDeviceOnline?: boolean }) => void
      ) => {
        try {
          console.log(`[WS-CMD] User ${userId} requested send_command:`, JSON.stringify(payload));

          if (!distributedRealtimeReady) {
            console.warn(`[WS-CMD-REJECT] Distributed realtime infrastructure is unavailable.`);
            const errRes = { success: false, message: 'DISTRIBUTED_TRANSPORT_UNAVAILABLE' };
            socket.emit('command_error', errRes);
            callback?.(errRes);
            return;
          }

          if (!payload || !payload.deviceId || !payload.virtualPin) {
            const errRes = { success: false, message: 'Missing deviceId or virtualPin' };
            socket.emit('command_error', errRes);
            callback?.(errRes);
            return;
          }

          // Strict Authorization Check (No IDOR):
          // Look up device and ensure it belongs to the authenticated user!
          let device: any = await getDeviceById(payload.deviceId);
          if (!device) {
            device = await getDeviceByIdentifier(payload.deviceId);
          }

          // Allow preview device fallback for local development
          if (
            !device &&
            (payload.deviceId === 'preview-device-001' || payload.deviceId === 'ESP32-001')
          ) {
            device = {
              id: 'preview-device-001',
              name: 'ESP32-001',
              deviceIdentifier: 'ESP32-001',
              projectId: 'preview-project-001',
              projectName: 'Smart Irrigation',
              tokenHash: 'preview-hash',
              lastSeen: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              userId: 'preview-user-001',
            };
          }

          if (!device || device.userId !== userId) {
            console.warn(
              `[SECURITY] Unauthorized command attempt by user ${userId} on device ${payload.deviceId}`
            );
            const errRes = {
              success: false,
              message: 'Device not found or you do not have permission to control this device',
            };
            socket.emit('command_error', errRes);
            callback?.(errRes);
            return;
          }

          const deviceRoom = `room_device_${device.id}`;
          const deviceRoomSockets = io.sockets.adapter.rooms.get(deviceRoom);
          const isDeviceConnected = Boolean(deviceRoomSockets && deviceRoomSockets.size > 0);

          console.log(
            `[WS-CMD] Forwarding command to ${deviceRoom} (ESP32 online: ${isDeviceConnected})`
          );

          // Step 3: Forward command to ESP32: emit 'device_command'
          const commandId = randomUUID();
          const commandPayload: DeviceCommandPayload = {
            virtualPin: payload.virtualPin.toUpperCase().trim(),
            value: payload.value,
            commandId,
            timestamp: new Date().toISOString(),
          };

          // 1. Persist command state into distributed PostgreSQL database
          try {
            await prisma.deviceCommand.create({
              data: {
                id: commandId,
                deviceId: device.id,
                deviceIdentifier: device.deviceIdentifier,
                virtualPin: commandPayload.virtualPin,
                targetValue: String(payload.value),
                userId,
                status: 'PENDING',
              },
            });
            console.log(`[WS-CMD-DB] Registered command ${commandId} in PostgreSQL distributed store.`);
          } catch (dbErr) {
            console.error('[WS-CMD-DB] Failed to persist command in PostgreSQL:', dbErr);
          }

          // Register 5-second ACK timeout timer with distributed atomic state resolution
          const timeoutTimer = setTimeout(async () => {
            let wasTimeoutAtomic = false;
            try {
              const updated = await prisma.deviceCommand.updateMany({
                where: {
                  id: commandId,
                  status: 'PENDING',
                },
                data: {
                  status: 'TIMEOUT',
                },
              });
              wasTimeoutAtomic = updated.count === 1;
            } catch (dbErr) {
              console.error('[WS-CMD-TIMEOUT-DB] Failed to update timeout in DB:', dbErr);
              // Fallback to in-memory check if database is down or not queryable
              const pendingMem = pendingCommandsMap.get(commandId);
              if (pendingMem && pendingMem.status === 'PENDING') {
                pendingMem.status = 'TIMEOUT' as any;
                wasTimeoutAtomic = true;
              }
            }

            // Synchronize status in the local memory map
            const pendingMem = pendingCommandsMap.get(commandId);
            if (pendingMem) {
              if (wasTimeoutAtomic) {
                pendingMem.status = 'TIMEOUT' as any;
              }
            }

            if (wasTimeoutAtomic && pendingMem) {
              console.warn(
                `[WS-CMD-TIMEOUT] Backend 5s ACK timeout reached for command ${commandId} (Pin: ${pendingMem.virtualPin} on ${pendingMem.deviceIdentifier})`
              );

              // Broadcast TIMEOUT state_updated to user room so UI reverts and clears pending state
              const timeoutPayload: StateUpdatedPayload = {
                deviceId: pendingMem.deviceId,
                deviceIdentifier: pendingMem.deviceIdentifier,
                virtualPin: pendingMem.virtualPin,
                value: pendingMem.targetValue,
                status: 'TIMEOUT',
                commandId,
                timestamp: new Date().toISOString(),
              };

              io.to(`room_user_${pendingMem.userId}`).emit('state_updated', timeoutPayload);
            }
          }, 5000);

          pendingCommandsMap.set(commandId, {
            commandId,
            deviceId: device.id,
            deviceIdentifier: device.deviceIdentifier,
            virtualPin: commandPayload.virtualPin,
            targetValue: payload.value,
            userId,
            createdAt: Date.now(),
            timeoutTimer,
            status: 'PENDING',
          });

          io.to(deviceRoom).emit('device_command', commandPayload);

          const successRes = {
            success: true,
            message: isDeviceConnected
              ? 'Command dispatched to ESP32'
              : 'Command dispatched (ESP32 currently disconnected, awaiting reconnection)',
            isDeviceOnline: isDeviceConnected,
          };

          callback?.(successRes);
        } catch (cmdError: any) {
          console.error('[WS-CMD] Error processing send_command:', cmdError);
          const errRes = { success: false, message: 'Internal server error processing command' };
          socket.emit('command_error', errRes);
          callback?.(errRes);
        }
      }
    );

    socket.on('disconnect', (reason) => {
      console.log(
        `[WS-USER] User disconnected: socket ${socket.id} from ${userRoom} (Reason: ${reason})`
      );
    });

    // Client heartbeat ping
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Multi-Device Subscription & Room Switching Isolation
    socket.on('subscribe_device', async (data: { deviceId: string }) => {
      if (!data?.deviceId) return;

      try {
        let targetDevice: any = await getDeviceById(data.deviceId);
        if (!targetDevice) {
          targetDevice = await getDeviceByIdentifier(data.deviceId);
        }

        // Preview fallback for preview user
        if (
          !targetDevice &&
          (data.deviceId === 'preview-device-001' || data.deviceId === 'ESP32-001') &&
          userId === 'preview-user-001'
        ) {
          targetDevice = { id: 'preview-device-001', userId: 'preview-user-001' };
        }

        if (!targetDevice || targetDevice.userId !== userId) {
          console.warn(
            `[SECURITY] Rejected unauthorized subscribe_device attempt: user ${userId} does not own device ${data.deviceId}`
          );
          socket.emit('subscription_error', {
            deviceId: data.deviceId,
            message: 'Unauthorized device subscription',
          });
          return;
        }

        for (const room of socket.rooms) {
          if (room.startsWith('room_sub_device_')) {
            socket.leave(room);
          }
        }
        const newRoom = `room_sub_device_${targetDevice.id || data.deviceId}`;
        socket.join(newRoom);
        socket.emit('device_subscribed', { deviceId: data.deviceId });
      } catch (subErr) {
        console.error('[WS-SUB] Error in subscribe_device:', subErr);
      }
    });

    socket.on('unsubscribe_device', (data: { deviceId: string }) => {
      if (data?.deviceId) {
        socket.leave(`room_sub_device_${data.deviceId}`);
      }
    });

    // Phase 2B Security: Reject any unauthorized telemetry_update from browser user clients
    socket.on('telemetry_update', (payload: any) => {
      console.warn(
        `[SECURITY] Rejected unauthorized telemetry_update from user client ${userId} (socket ${socket.id}): only authenticated devices may emit telemetry`
      );
    });
  });

  ioInstance = io;
  return io;
}

/**
 * Broadcast sensor update payload ONLY to the owner's isolated room
 */
export function emitSensorUpdateToUser(userId: string, payload: SensorUpdatePayload): void {
  if (!ioInstance) {
    console.warn('[WS] Socket.IO instance not ready, cannot broadcast sensor_update');
    return;
  }

  const room = `room_user_${userId}`;
  ioInstance.to(room).emit('sensor_update', payload);

  console.log(
    `[WS-BROADCAST] Emitted 'sensor_update' to ${room} for device ${payload.deviceId} with [${Object.keys(
      payload.data
    ).join(', ')}]`
  );
}

/**
 * Forward command to a device programmatically (e.g. via REST API)
 */
export async function forwardCommandToDevice(
  deviceId: string,
  virtualPin: string,
  value: boolean | number | string
): Promise<{ success: boolean; isDeviceConnected: boolean }> {
  if (!ioInstance) {
    return { success: false, isDeviceConnected: false };
  }

  const deviceRoom = `room_device_${deviceId}`;
  const deviceRoomSockets = ioInstance.sockets.adapter.rooms.get(deviceRoom);
  const isDeviceConnected = Boolean(deviceRoomSockets && deviceRoomSockets.size > 0);

  const commandPayload: DeviceCommandPayload = {
    virtualPin: virtualPin.toUpperCase().trim(),
    value,
    commandId: randomUUID(),
    timestamp: new Date().toISOString(),
  };

  ioInstance.to(deviceRoom).emit('device_command', commandPayload);
  return { success: true, isDeviceConnected };
}

/**
 * Broadcast new notification to device owner & device subscribers
 */
export function emitNotificationToUser(userId: string, deviceId: string, notification: any): void {
  if (!ioInstance) return;
  const userRoom = `room_user_${userId}`;
  const deviceSubRoom = `room_sub_device_${deviceId}`;
  ioInstance.to(userRoom).to(deviceSubRoom).emit('new_notification', notification);
}

/**
 * Access underlying Socket.IO server instance if needed
 */
export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

/**
 * Close active Redis connection clients gracefully
 */
export async function closeRedis(): Promise<void> {
  if (pubClient) {
    try {
      await pubClient.disconnect();
    } catch (e) {
      console.error('[WS-REDIS] Error disconnecting pubClient:', e);
    }
    pubClient = null;
  }
  if (subClient) {
    try {
      await subClient.disconnect();
    } catch (e) {
      console.error('[WS-REDIS] Error disconnecting subClient:', e);
    }
    subClient = null;
  }
  redisOperational = false;
}


