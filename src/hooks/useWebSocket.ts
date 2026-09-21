import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext.tsx';

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
  deviceIdentifier?: string; // Hardware tag e.g. "ESP32-001"
  virtualPin: string; // e.g. "V3"
  value: boolean | number | string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  timestamp: string;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

// Module-level shared singleton socket connection per authenticated user
let sharedSocket: Socket | null = null;
let currentSocketToken: string | null = null;
const listeners = new Set<(status: ConnectionStatus) => void>();
const sensorUpdateListeners = new Set<(payload: SensorUpdatePayload) => void>();
const stateUpdateListeners = new Set<(payload: StateUpdatedPayload) => void>();
const notificationListeners = new Set<(notification: any) => void>();

function notifyStatus(status: ConnectionStatus) {
  listeners.forEach((fn) => fn(status));
}

function notifySensorUpdate(payload: SensorUpdatePayload) {
  sensorUpdateListeners.forEach((fn) => fn(payload));
}

function notifyStateUpdate(payload: StateUpdatedPayload) {
  stateUpdateListeners.forEach((fn) => fn(payload));
}

function notifyNotification(notification: any) {
  notificationListeners.forEach((fn) => fn(notification));
}

function getOrCreateSocket(token: string): Socket {
  if (sharedSocket && currentSocketToken === token && sharedSocket.connected) {
    return sharedSocket;
  }

  // If token changed or socket exists in bad state, close previous
  if (sharedSocket) {
    sharedSocket.removeAllListeners();
    sharedSocket.disconnect();
    sharedSocket = null;
  }

  currentSocketToken = token;

  const socket = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 25,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    console.log(`[WS-CLIENT] Connected to backend (socket: ${socket.id})`);
    notifyStatus('connected');
  });

  socket.on('connect_error', (err) => {
    console.warn('[WS-CLIENT] Connection error:', err.message);
    notifyStatus(socket.active ? 'reconnecting' : 'disconnected');
  });

  socket.on('disconnect', (reason) => {
    console.log('[WS-CLIENT] Disconnected:', reason);
    if (reason === 'io server disconnect') {
      // the disconnection was initiated by the server (e.g. auth failed)
      notifyStatus('disconnected');
    } else {
      // the socket will automatically try to reconnect
      notifyStatus('reconnecting');
    }
  });

  socket.io.on('reconnect_attempt', () => {
    notifyStatus('reconnecting');
  });

  socket.io.on('reconnect', () => {
    console.log('[WS-CLIENT] Reconnected successfully');
    notifyStatus('connected');
  });

  socket.io.on('reconnect_failed', () => {
    console.error('[WS-CLIENT] Reconnection failed completely');
    notifyStatus('disconnected');
  });

  // Listen for the Phase 2 specification event: 'sensor_update'
  socket.on('sensor_update', (payload: SensorUpdatePayload) => {
    notifySensorUpdate(payload);
  });

  // Listen for the Phase 3 specification event: 'state_updated'
  socket.on('state_updated', (payload: StateUpdatedPayload) => {
    notifyStateUpdate(payload);
  });

  // Listen for Phase 5 event: 'new_notification'
  socket.on('new_notification', (notification: any) => {
    notifyNotification(notification);
  });

  sharedSocket = socket;
  return socket;
}

export function useWebSocket() {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>(() => {
    if (!token) return 'disconnected';
    return sharedSocket?.connected ? 'connected' : 'connecting';
  });
  const [lastUpdate, setLastUpdate] = useState<SensorUpdatePayload | null>(null);
  const [lastStateUpdate, setLastStateUpdate] = useState<StateUpdatedPayload | null>(null);

  useEffect(() => {
    if (!token || !user) {
      if (sharedSocket) {
        sharedSocket.removeAllListeners();
        sharedSocket.disconnect();
        sharedSocket = null;
        currentSocketToken = null;
      }
      setStatus('disconnected');
      return;
    }

    const socket = getOrCreateSocket(token);

    // Sync initial state
    if (socket.connected) {
      setStatus('connected');
    } else {
      setStatus('connecting');
    }

    // Subscribe to status changes
    const handleStatusChange = (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
    };
    listeners.add(handleStatusChange);

    // Subscribe to incoming sensor updates
    const handleSensorUpdate = (payload: SensorUpdatePayload) => {
      setLastUpdate(payload);
    };
    sensorUpdateListeners.add(handleSensorUpdate);

    // Subscribe to incoming state updates
    const handleStateUpdate = (payload: StateUpdatedPayload) => {
      setLastStateUpdate(payload);
    };
    stateUpdateListeners.add(handleStateUpdate);

    // Cleanup listener on unmount (prevents memory leaks)
    return () => {
      listeners.delete(handleStatusChange);
      sensorUpdateListeners.delete(handleSensorUpdate);
      stateUpdateListeners.delete(handleStateUpdate);
    };
  }, [token, user]);

  /**
   * Subscribe a dedicated callback to real-time sensor updates
   * Returns a cleanup function to automatically unregister.
   */
  const subscribe = useCallback((callback: (payload: SensorUpdatePayload) => void) => {
    sensorUpdateListeners.add(callback);
    return () => {
      sensorUpdateListeners.delete(callback);
    };
  }, []);

  /**
   * Phase 3: Subscribe a dedicated callback to closed-loop actuator state updates (ACK)
   * Returns a cleanup function to automatically unregister.
   */
  const subscribeStateUpdate = useCallback((callback: (payload: StateUpdatedPayload) => void) => {
    stateUpdateListeners.add(callback);
    return () => {
      stateUpdateListeners.delete(callback);
    };
  }, []);

  /**
   * Phase 5: Subscribe to real-time new notifications
   */
  const subscribeNotification = useCallback((callback: (notification: any) => void) => {
    notificationListeners.add(callback);
    return () => {
      notificationListeners.delete(callback);
    };
  }, []);

  /**
   * Phase 3: Dispatch command to ESP32 via WebSocket
   * Event Contract: 'send_command' -> { deviceId, virtualPin, value }
   */
  const sendCommand = useCallback(
    (
      deviceId: string,
      virtualPin: string,
      value: boolean | number | string
    ): Promise<{ success: boolean; message?: string; isDeviceOnline?: boolean }> => {
      return new Promise((resolve) => {
        if (!sharedSocket || !sharedSocket.connected) {
          resolve({
            success: false,
            message: 'WebSocket disconnected. Cannot send command to ESP32.',
            isDeviceOnline: false,
          });
          return;
        }

        sharedSocket.emit(
          'send_command',
          {
            deviceId,
            virtualPin: virtualPin.toUpperCase().trim(),
            value,
          },
          (res: { success: boolean; message?: string; isDeviceOnline?: boolean }) => {
            if (res) {
              resolve(res);
            } else {
              resolve({ success: true, message: 'Command emitted to backend' });
            }
          }
        );
      });
    },
    []
  );

  /**
   * Phase 4: Subscribe to specific device room for strict multi-device isolation
   */
  const subscribeDevice = useCallback((deviceId: string) => {
    if (sharedSocket && sharedSocket.connected && deviceId) {
      sharedSocket.emit('subscribe_device', { deviceId });
    }
  }, []);

  const unsubscribeDevice = useCallback((deviceId: string) => {
    if (sharedSocket && sharedSocket.connected && deviceId) {
      sharedSocket.emit('unsubscribe_device', { deviceId });
    }
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    isReconnecting: status === 'reconnecting',
    isDisconnected: status === 'disconnected',
    lastSensorUpdate: lastUpdate,
    lastStateUpdate,
    subscribe,
    subscribeStateUpdate,
    subscribeNotification,
    subscribeDevice,
    unsubscribeDevice,
    sendCommand,
  };
}
