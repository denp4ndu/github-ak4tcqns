import { io, Socket } from 'socket.io-client';

export interface DeviceLog {
  timestamp: string;
  type: 'info' | 'cmd' | 'ack' | 'err';
  text: string;
}

export type SimulatorConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error';

class SimulatorSocketService {
  private socket: Socket | null = null;
  private currentDeviceToken: string = '';
  private isConnected: boolean = false;
  private relayState: boolean = false;
  private logs: DeviceLog[] = [];
  private suppressAck: boolean = false;
  private listeners: Set<() => void> = new Set();
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private isTelemetryActive: boolean = false;
  private telemetryCount: number = 0;
  private lastTelemetryTimestamp: string | null = null;

  constructor() {
    // Persistent module singleton
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  public getStatus(): SimulatorConnectionStatus {
    if (!this.socket) return 'disconnected';
    if (this.isConnected && this.socket.connected) return 'connected';
    if (this.socket.active) return 'connecting';
    return 'disconnected';
  }

  public getIsConnected(): boolean {
    return this.isConnected && Boolean(this.socket?.connected);
  }

  public getRelayState(): boolean {
    return this.relayState;
  }

  public getDeviceToken(): string {
    return this.currentDeviceToken;
  }

  public getLogs(): DeviceLog[] {
    return [...this.logs];
  }

  public isAckSuppressed(): boolean {
    return this.suppressAck;
  }

  public setSuppressAck(suppress: boolean) {
    this.suppressAck = suppress;
    this.notify();
  }

  public toggleAckSuppression(): boolean {
    this.suppressAck = !this.suppressAck;
    this.notify();
    return this.suppressAck;
  }

  public clearLogs() {
    this.logs = [];
    this.notify();
  }

  public addLog(type: 'info' | 'cmd' | 'ack' | 'err', text: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs = [{ timestamp, type, text }, ...this.logs.slice(0, 49)];
    this.notify();
  }

  public connect(deviceToken: string, serverUrl?: string) {
    const cleanToken = deviceToken.trim();
    if (!cleanToken) {
      this.addLog('err', 'Cannot connect: empty Device Token');
      return;
    }

    // If already connected with the same token, do not duplicate
    if (
      this.socket &&
      this.socket.connected &&
      this.currentDeviceToken === cleanToken
    ) {
      this.addLog(
        'info',
        `[SIMULATOR] Already connected with token: ${cleanToken.substring(0, 14)}...`
      );
      return;
    }

    // Clean up previous socket if exists
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.currentDeviceToken = cleanToken;
    this.addLog(
      'info',
      `Connecting to WebSocket server with deviceToken: ${cleanToken.substring(
        0,
        14
      )}...`
    );
    this.notify();

    const targetUrl = serverUrl || (typeof window !== 'undefined' ? undefined : 'http://127.0.0.1:3000');
    const socketOpts = {
      auth: { deviceToken: cleanToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 25,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    };

    const socket = targetUrl ? io(targetUrl, socketOpts) : io(socketOpts);

    socket.on('connect', () => {
      this.isConnected = true;
      this.addLog(
        'info',
        `[ESP32 WS] Connected to backend! Socket ID: ${socket.id}`
      );
      this.notify();
    });

    socket.on(
      'device_ready',
      (payload: {
        connected: boolean;
        deviceId: string;
        deviceIdentifier: string;
      }) => {
        this.addLog(
          'info',
          `[ESP32 WS] device_ready handshake verified: ${payload.deviceIdentifier}`
        );
        this.notify();
      }
    );

    socket.on(
      'device_command',
      (cmd: {
        virtualPin: string;
        value: boolean | number | string;
        commandId?: string;
        timestamp?: string;
      }) => {
        this.addLog(
          'cmd',
          `[RECV device_command] Pin: ${cmd.virtualPin} -> Value: ${JSON.stringify(
            cmd.value
          )}${cmd.commandId ? ` (ID: ${cmd.commandId})` : ''}`
        );

        const isHigh =
          cmd.value === true ||
          cmd.value === 'true' ||
          cmd.value === 1 ||
          cmd.value === '1';

        this.relayState = isHigh;

        this.addLog(
          'info',
          `[HARDWARE ACTION] Executed digitalWrite(27, ${
            isHigh ? 'HIGH' : 'LOW'
          }) on ESP32`
        );

        // Check if ACK is intentionally suppressed for timeout testing
        if (this.suppressAck) {
          this.addLog(
            'err',
            `[SIMULATOR] ACK intentionally suppressed for Pin ${cmd.virtualPin} (Testing 5s Timeout Protection)`
          );
          this.notify();
          return;
        }

        // Echo the exact received commandId back in command_ack
        const ackPayload = {
          deviceToken: this.currentDeviceToken,
          virtualPin: cmd.virtualPin,
          value: isHigh,
          status: 'SUCCESS',
          commandId: cmd.commandId,
        };

        socket.emit('command_ack', ackPayload);

        this.addLog(
          'ack',
          `[SENT command_ack] -> Emitted ACK { virtualPin: "${cmd.virtualPin}", value: ${isHigh}, status: "SUCCESS"${
            cmd.commandId ? `, commandId: "${cmd.commandId}"` : ''
          } }`
        );
        this.notify();
      }
    );

    socket.on('connect_error', (err) => {
      this.isConnected = false;
      this.addLog('err', `[ESP32 WS] Connection error: ${err.message}`);
      this.notify();
    });

    socket.on('disconnect', (reason) => {
      this.isConnected = false;
      this.addLog('info', `[ESP32 WS] Disconnected (Reason: ${reason})`);
      this.notify();
    });

    this.socket = socket;
  }

  public isTelemetryRunning(): boolean {
    return this.isTelemetryActive;
  }

  public getTelemetryCount(): number {
    return this.telemetryCount;
  }

  public getLastTelemetryTimestamp(): string | null {
    return this.lastTelemetryTimestamp;
  }

  public startTelemetryLoop(intervalMs: number = 5200, maxSamples?: number) {
    if (this.telemetryTimer) {
      // Prevent duplicate timers (DoD: exactly 1 loop)
      return;
    }

    this.isTelemetryActive = true;
    this.addLog(
      'info',
      `[SIMULATOR] Starting periodic telemetry loop (${intervalMs}ms interval${
        maxSamples ? `, target: ${maxSamples} samples` : ''
      })`
    );
    this.notify();

    let emittedInSession = 0;
    this.telemetryTimer = setInterval(() => {
      const sent = this.sendTelemetrySample();
      if (sent) {
        emittedInSession++;
        if (maxSamples && emittedInSession >= maxSamples) {
          this.stopTelemetryLoop(`Completed target of ${maxSamples} samples`);
        }
      }
    }, intervalMs);
  }

  public stopTelemetryLoop(reason: string = 'User stopped telemetry') {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.isTelemetryActive = false;
    this.addLog('info', `[SIMULATOR] Stopped telemetry loop: ${reason}`);
    this.notify();
  }

  public sendTelemetrySample(): boolean {
    // ZERO-TOLERANCE GUARD: Do not emit telemetry while disconnected or unauthenticated
    if (!this.socket || !this.socket.connected || !this.isConnected) {
      return false;
    }

    // Realistic sensor simulation matching valid datastream definitions
    // Round-robin across V0, V1, V2, V3 ensures strict 1-to-1 correlation:
    // 1 telemetry_update = 1 accepted reading = 1 persisted SensorData row = 1 sensor_update broadcast
    const pinCycle = ['V0', 'V1', 'V2', 'V3'];
    const currentPin = pinCycle[this.telemetryCount % pinCycle.length];
    let pinVal: any;

    if (currentPin === 'V0') {
      pinVal = Math.floor(40 + Math.random() * 35); // Soil Moisture (INTEGER: 40-75%)
    } else if (currentPin === 'V1') {
      pinVal = parseFloat((25.0 + Math.random() * 6.5).toFixed(1)); // Temperature (FLOAT: 25.0-31.5 °C)
    } else if (currentPin === 'V2') {
      pinVal = Math.floor(1800 + Math.random() * 800); // ADC Raw (INTEGER: 1800-2600)
    } else {
      pinVal = Boolean(this.relayState); // Relay State (BOOLEAN)
    }

    const nowIso = new Date().toISOString();
    const payload = {
      timestamp: nowIso,
      data: {
        [currentPin]: pinVal,
      },
    };

    this.socket.emit('telemetry_update', payload);
    this.telemetryCount++;
    this.lastTelemetryTimestamp = nowIso;

    this.addLog(
      'info',
      `[TELEMETRY #${this.telemetryCount}] Emitted telemetry_update -> ${currentPin}: ${pinVal}`
    );
    this.notify();
    return true;
  }

  /**
   * Explicit Disconnect ONLY (e.g. user clicks Power Cut or Disconnect)
   * This is never called automatically by React unmount or page navigation!
   */
  public disconnect(reason: string = 'User requested disconnect') {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.isTelemetryActive = false;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.addLog('info', `[ESP32 WS] Simulator explicitly disconnected: ${reason}`);
    this.notify();
  }

  public getRawSocket(): Socket | null {
    return this.socket;
  }
}

// Global persistent singleton instance
export const simulatorSocketService = new SimulatorSocketService();
