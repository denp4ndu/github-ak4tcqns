import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyUserJwt, hashDeviceToken } from '../auth.ts';
import {
  getDeviceByTokenHash,
  getDeviceById,
  getDeviceByIdentifier,
  getDatastreamsByDeviceId,
  insertSensorData,
  updateDeviceLastSeen,
} from '../db.ts';

let ioInstance: SocketIOServer | null = null;

export interface SensorUpdatePayload {
  deviceId: string; // e.g. "ESP32-001" or deviceIdentifier
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
}

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
        const tokenHash = hashDeviceToken(candidateDeviceToken.trim());
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
        socket.data.deviceToken = candidateDeviceToken.trim();

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

      // Update last seen in DB
      await updateDeviceLastSeen(deviceId, new Date());

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

          // If device confirmed physical execution, persist new state into PostgreSQL SensorData
          if (isSuccess) {
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
          }

          // Step 8: Forward ACK to Web Dashboard in User Room
          const stateUpdatedPayload: StateUpdatedPayload = {
            deviceId,
            deviceIdentifier,
            virtualPin: normalizedPin,
            value: payload.value,
            status: isSuccess ? 'SUCCESS' : 'FAILED',
            timestamp: now.toISOString(),
          };

          io.to(`room_user_${ownerUserId}`).emit('state_updated', stateUpdatedPayload);

          // Also emit standard sensor_update to keep Phase 2 visualizers & value cards in sync
          emitSensorUpdateToUser(ownerUserId, {
            deviceId: deviceIdentifier,
            timestamp: now.toISOString(),
            data: {
              [normalizedPin]: payload.value,
            },
          });

          console.log(
            `[WS-ACK] Forwarded 'state_updated' to room_user_${ownerUserId} for ${normalizedPin}`
          );
        } catch (ackError: any) {
          console.error('[WS-ACK] Error processing command_ack:', ackError);
        }
      });

      // Handle optional telemetry streaming over WebSocket from ESP32
      socket.on('telemetry_update', async (payload: { data: Record<string, any> }) => {
        try {
          if (!payload?.data) return;
          const now = new Date();
          const registeredStreams = await getDatastreamsByDeviceId(deviceId);
          const streamMap = new Map(registeredStreams.map((s) => [s.virtualPin.toUpperCase(), s]));

          for (const [pin, rawVal] of Object.entries(payload.data)) {
            const normPin = pin.toUpperCase().trim();
            const stream = streamMap.get(normPin);
            if (stream) {
              const strVal = String(rawVal);
              const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(strVal);
              await insertSensorData({
                id: randomUUID(),
                deviceId,
                datastreamId: stream.id,
                value: strVal,
                numericValue: isNaN(numVal) ? null : numVal,
                timestamp: now,
              });
            }
          }

          await updateDeviceLastSeen(deviceId, now);

          emitSensorUpdateToUser(ownerUserId, {
            deviceId: deviceIdentifier,
            timestamp: now.toISOString(),
            data: payload.data,
          });
        } catch (telemetryErr) {
          console.error('[WS-DEVICE] Error in telemetry_update:', telemetryErr);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[WS-DEVICE] ESP32 disconnected: ${deviceIdentifier} (Reason: ${reason})`);
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
          const commandPayload: DeviceCommandPayload = {
            virtualPin: payload.virtualPin.toUpperCase().trim(),
            value: payload.value,
            commandId: randomUUID(),
            timestamp: new Date().toISOString(),
          };

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
    socket.on('subscribe_device', (data: { deviceId: string }) => {
      if (!data?.deviceId) return;
      for (const room of socket.rooms) {
        if (room.startsWith('room_sub_device_')) {
          socket.leave(room);
        }
      }
      const newRoom = `room_sub_device_${data.deviceId}`;
      socket.join(newRoom);
      socket.emit('device_subscribed', { deviceId: data.deviceId });
    });

    socket.on('unsubscribe_device', (data: { deviceId: string }) => {
      if (data?.deviceId) {
        socket.leave(`room_sub_device_${data.deviceId}`);
      }
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

