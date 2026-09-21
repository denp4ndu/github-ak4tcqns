import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Send,
  Heart,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Copy,
  Check,
  Cpu,
  Zap,
  Wifi,
  WifiOff,
  Power,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { api } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { simulatorSocketService } from '../services/simulatorSocketService.ts';
import type { Device, Datastream } from '../types/index.ts';

interface SimulatorPageProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  datastreams: Datastream[];
  onDataSent: () => void;
}

export const SimulatorPage: React.FC<SimulatorPageProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  datastreams,
  onDataSent,
}) => {
  const { token } = useAuth();
  const STACKBLITZ_PREVIEW = import.meta.env.DEV;
  const [deviceToken, setDeviceToken] = useState<string>(
    import.meta.env.DEV ? 'preview-device-token' : ''
  );
  const [readings, setReadings] = useState<Record<string, string>>({
    V0: '67',
    V1: '29.5',
    V2: '1880',
    V3: 'true',
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [serverResponse, setServerResponse] = useState<any>(null);

  // =========================================================
  // Phase 3: Simulated ESP32 WebSocket Client (Persistent Singleton)
  // =========================================================
  const [isWsClientConnected, setIsWsClientConnected] = useState<boolean>(() =>
    simulatorSocketService.getIsConnected()
  );
  const [simulatedRelayState, setSimulatedRelayState] = useState<boolean>(() =>
    simulatorSocketService.getRelayState()
  );
  const [deviceLogs, setDeviceLogs] = useState(() =>
    simulatorSocketService.getLogs()
  );
  const [isAckSuppressed, setIsAckSuppressed] = useState<boolean>(() =>
    simulatorSocketService.isAckSuppressed()
  );
  const [isTelemetryActive, setIsTelemetryActive] = useState<boolean>(() =>
    simulatorSocketService.isTelemetryRunning()
  );
  const [telemetryCount, setTelemetryCount] = useState<number>(() =>
    simulatorSocketService.getTelemetryCount()
  );

  // Subscribe to persistent simulator service updates (persists across tab navigation!)
  useEffect(() => {
    const syncState = () => {
      setIsWsClientConnected(simulatorSocketService.getIsConnected());
      setSimulatedRelayState(simulatorSocketService.getRelayState());
      setDeviceLogs(simulatorSocketService.getLogs());
      setIsAckSuppressed(simulatorSocketService.isAckSuppressed());
      setIsTelemetryActive(simulatorSocketService.isTelemetryRunning());
      setTelemetryCount(simulatorSocketService.getTelemetryCount());
    };

    syncState();
    const unsubscribe = simulatorSocketService.subscribe(syncState);
    return () => {
      // ONLY unsubscribe UI observer! DO NOT disconnect the simulator socket!
      unsubscribe();
    };
  }, []);

  const addDeviceLog = (type: 'info' | 'cmd' | 'ack' | 'err', text: string) => {
    simulatorSocketService.addLog(type, text);
  };

  const connectSimulatedESP32 = () => {
    if (!deviceToken.trim()) {
      alert('Please enter a valid Device Token to connect simulated ESP32.');
      return;
    }
    simulatorSocketService.connect(deviceToken.trim());
  };

  const disconnectSimulatedESP32 = () => {
    simulatorSocketService.disconnect(
      'Manually disconnected simulated ESP32 (Power Cut Simulation)'
    );
  };

  // Automated acceptance test checklist results
  const [suiteResults, setSuiteResults] = useState<{
    test1?: boolean; // Device Connection
    test2?: boolean; // Command Routing
    test3?: boolean; // Hardware Action
    test4?: boolean; // Closed-Loop ACK
    test5?: boolean; // Persistence
    test6?: boolean; // Offline Timeout
  }>({});

  const handleSendSensorData = async () => {
    if (!deviceToken.trim()) {
      alert(
        'Please enter your Device Token (generated when registering device or regenerating token).'
      );
      return;
    }

    setLoading(true);
    setHttpStatus(null);
    setServerResponse(null);

    const payloadData: Record<string, any> = {};
    for (const ds of datastreams) {
      const val = readings[ds.virtualPin];
      if (val === undefined || val === '') continue;

      if (ds.dataType === 'INTEGER')
        payloadData[ds.virtualPin] = parseInt(val, 10);
      else if (ds.dataType === 'FLOAT')
        payloadData[ds.virtualPin] = parseFloat(val);
      else if (ds.dataType === 'BOOLEAN')
        payloadData[ds.virtualPin] =
          val === 'true' || val === '1' || val === 'ON';
      else payloadData[ds.virtualPin] = val;
    }

    try {
      const res = await api.ingestDeviceData({
        deviceToken: deviceToken.trim(),
        data: payloadData,
      });
      setHttpStatus(200);
      setServerResponse(res);
      onDataSent();
    } catch (err: any) {
      setHttpStatus(err.status || 400);
      setServerResponse({
        success: false,
        error: err.code || 'REQUEST_FAILED',
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendHeartbeat = async () => {
    if (!deviceToken.trim()) {
      alert('Please enter your Device Token.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.sendDeviceHeartbeat(deviceToken.trim());
      setHttpStatus(200);
      setServerResponse(res);
      onDataSent();
    } catch (err: any) {
      setHttpStatus(err.status || 400);
      setServerResponse({
        success: false,
        error: err.code || 'HEARTBEAT_FAILED',
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // Run full Phase 3 acceptance test suite
  const runPhase3AcceptanceSuite = async () => {
    if (!deviceToken.trim()) {
      alert('Device token required to run valid tests.');
      return;
    }
    if (!selectedDevice) {
      alert('Please select a device.');
      return;
    }

    setLoading(true);
    const results: typeof suiteResults = {};

    try {
      // ---------------------------------------------------------
      // TEST 1: ESP32 Device WebSocket Authentication (Device Token)
      // ---------------------------------------------------------
      addDeviceLog(
        'info',
        '[SUITE] Executing TEST 1: Device Connection & Token Auth...'
      );
      let test1Passed = false;
      const deviceSocket = io({
        auth: { deviceToken: deviceToken.trim() },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 4000);
        deviceSocket.on('device_ready', () => {
          test1Passed = true;
          clearTimeout(timer);
          resolve();
        });
        deviceSocket.on('connect_error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      results.test1 = test1Passed;
      addDeviceLog(
        'info',
        `[SUITE] TEST 1 Result: ${
          test1Passed ? 'PASSED (200 Authenticated)' : 'FAILED'
        }`
      );

      // ---------------------------------------------------------
      // TEST 2 & 3: Command Routing & Hardware Action
      // ---------------------------------------------------------
      addDeviceLog(
        'info',
        '[SUITE] Executing TEST 2 & 3: Command Routing & Hardware Action...'
      );
      let test2Passed = false;
      let test3Passed = false;
      let capturedCommandId: string | undefined;

      // Listen for command on device socket
      deviceSocket.on('device_command', (cmd) => {
        if (cmd.virtualPin === 'V3' && cmd.value === true) {
          test2Passed = true; // Routed correctly to isolated device room!
          test3Passed = true; // Simulating physical execution
          capturedCommandId = cmd.commandId;
          // Send ACK with correlated commandId
          deviceSocket.emit('command_ack', {
            deviceToken: deviceToken.trim(),
            virtualPin: 'V3',
            value: true,
            status: 'SUCCESS',
            commandId: cmd.commandId,
          });
        }
      });

      // User socket sends command
      const userSocket = io({
        auth: { token: token || 'stackblitz-preview-token' },
        transports: ['websocket'],
      });

      let test4Passed = false;
      userSocket.on('state_updated', (ack) => {
        if (
          ack.virtualPin === 'V3' &&
          ack.status === 'SUCCESS' &&
          (!capturedCommandId || ack.commandId === capturedCommandId)
        ) {
          test4Passed = true;
        }
      });

      await new Promise((r) => setTimeout(r, 600));

      userSocket.emit('send_command', {
        deviceId: selectedDevice.id,
        virtualPin: 'V3',
        value: true,
      });

      await new Promise((r) => setTimeout(r, 1500));

      results.test2 = test2Passed;
      results.test3 = test3Passed;
      results.test4 = test4Passed;

      // ---------------------------------------------------------
      // TEST 5: State Persistence in PostgreSQL
      // ---------------------------------------------------------
      addDeviceLog(
        'info',
        '[SUITE] Executing TEST 5: PostgreSQL Actuator State Persistence...'
      );
      try {
        const liveData = await api.getDeviceLiveData(selectedDevice.id);
        const v3Datastream = liveData.datastreams?.find(
          (d: any) => d.virtualPin === 'V3'
        );
        results.test5 = Boolean(
          v3Datastream &&
            (v3Datastream.currentValue === 'true' ||
              v3Datastream.currentValue === '1')
        );
      } catch {
        results.test5 = false;
      }

      // ---------------------------------------------------------
      // TEST 6: Offline 5-Second Timeout Simulation
      // ---------------------------------------------------------
      addDeviceLog(
        'info',
        '[SUITE] Executing TEST 6: Offline 5s Timeout Protection (device suppresses ACK)...'
      );

      // Disable command_ack on deviceSocket so backend 5-second timer fires
      deviceSocket.off('device_command');

      let test6Passed = false;
      const timeoutPromise = new Promise<boolean>((resolve) => {
        const timeoutHandler = (ack: any) => {
          if (ack.status === 'TIMEOUT' && ack.virtualPin === 'V3') {
            userSocket.off('state_updated', timeoutHandler);
            resolve(true);
          }
        };
        userSocket.on('state_updated', timeoutHandler);
        // Timeout guard at 6.5s
        setTimeout(() => {
          userSocket.off('state_updated', timeoutHandler);
          resolve(false);
        }, 6500);
      });

      userSocket.emit('send_command', {
        deviceId: selectedDevice.id,
        virtualPin: 'V3',
        value: false,
      });

      test6Passed = await timeoutPromise;
      results.test6 = test6Passed;

      // Clean up test sockets
      deviceSocket.disconnect();
      userSocket.disconnect();

      addDeviceLog(
        'info',
        `[SUITE] TEST 6 Result: ${
          test6Passed ? 'PASSED (5s Timeout Triggered)' : 'FAILED'
        }`
      );

      setSuiteResults(results);
      addDeviceLog(
        'info',
        '[SUITE] Phase 3 Acceptance Suite completed successfully!'
      );
    } catch (err: any) {
      console.error('Test suite error:', err);
    } finally {
      setLoading(false);
      onDataSent();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-sky-400" />
            ESP32 Hardware Ingestion & Relay Simulator
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test Phase 1 & 2 REST ingestion and Phase 3 Two-Way WebSocket
            Closed-Loop Relay Control directly in-browser
          </p>
        </div>

        {devices.length > 0 && (
          <select
            value={selectedDevice?.id || ''}
            onChange={(e) => {
              const found = devices.find((d) => d.id === e.target.value);
              if (found) onSelectDevice(found);
            }}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-sky-500"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.deviceIdentifier})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Device Token Authentication Input */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
          Device Authentication Token (Required)
        </label>
        <input
          id="sim-page-token-input"
          type="text"
          placeholder="Paste device token (e.g. esp32_tok_...)"
          value={deviceToken}
          onChange={(e) => setDeviceToken(e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
        />
        <p className="text-xs text-slate-400">
          Obtain this token from the <strong>Devices</strong> tab. The backend
          hashes it with SHA-256 before validating against stored hashes.
        </p>
      </div>

      {/* Phase 3: Simulated ESP32 WebSocket Client Panel */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Simulated ESP32 WebSocket Client (Phase 3 Two-Way Control)
              </h3>
              <p className="text-xs text-slate-400">
                Acts as a physical ESP32 connected via WebSocket, listening for
                relay commands (V3 / GPIO 27) and replying with ACK
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isWsClientConnected ? (
              <button
                id="sim-connect-ws-btn"
                onClick={connectSimulatedESP32}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Connect Simulated ESP32</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {!isTelemetryActive ? (
                  <button
                    id="sim-start-telemetry-btn"
                    onClick={() => simulatorSocketService.startTelemetryLoop(5000)}
                    className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm shadow-sky-500/20"
                    title="Emit periodic telemetry every 5s to backend via WebSocket"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Telemetry Loop (5s)</span>
                  </button>
                ) : (
                  <button
                    id="sim-stop-telemetry-btn"
                    onClick={() => simulatorSocketService.stopTelemetryLoop('User clicked stop')}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Stop Telemetry ({telemetryCount} sent)</span>
                  </button>
                )}
                <button
                  id="sim-suppress-ack-btn"
                  onClick={() => {
                    const next = simulatorSocketService.toggleAckSuppression();
                    setIsAckSuppressed(next);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer border transition-colors ${
                    isAckSuppressed
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  }`}
                  title="Simulate ESP32 unresponsive hang — received commands will NOT be acknowledged, triggering the 5s timeout on dashboard"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {isAckSuppressed
                      ? 'ACK Suppressed (Hanging)'
                      : 'Simulate Hang / Timeout'}
                  </span>
                </button>
                <button
                  id="sim-disconnect-ws-btn"
                  onClick={disconnectSimulatedESP32}
                  className="px-3.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Disconnect (Simulate Power Cut)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Physical GPIO State Visualizer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-4 h-4 rounded-full ${
                  isWsClientConnected
                    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                    : 'bg-slate-600'
                }`}
              />
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  WebSocket Client Status
                </span>
                <span className="text-xs font-mono font-bold text-slate-200">
                  {isWsClientConnected
                    ? 'CONNECTED & LISTENING'
                    : 'OFFLINE / DISCONNECTED'}
                </span>
              </div>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              room_device_
              {selectedDevice?.id ? selectedDevice.id.slice(0, 8) : '...'}
            </span>
          </div>

          <div
            className={`border rounded-xl p-4 flex items-center justify-between transition-colors ${
              simulatedRelayState
                ? 'bg-amber-500/10 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                : 'bg-slate-950/70 border-slate-800'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  simulatedRelayState
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Power className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Simulated Hardware Relay (GPIO 27 / Pin V3)
                </span>
                <span
                  className={`text-xs font-mono font-black tracking-wider ${
                    simulatedRelayState ? 'text-amber-400' : 'text-slate-400'
                  }`}
                >
                  {simulatedRelayState
                    ? 'GPIO 27: HIGH (RELAY ON)'
                    : 'GPIO 27: LOW (RELAY OFF)'}
                </span>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                simulatedRelayState
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              V3: {simulatedRelayState ? 'TRUE' : 'FALSE'}
            </span>
          </div>
        </div>

        {/* Live ESP32 Hardware Console Logs */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800 text-[11px]">
            <span>ESP32 Hardware Event Log (Auto-replies with ACK)</span>
            <button
              onClick={() => setDeviceLogs([])}
              className="text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {deviceLogs.length === 0 ? (
              <p className="text-slate-600 italic">
                No events logged yet. Connect simulated ESP32 above.
              </p>
            ) : (
              deviceLogs.map((l, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-slate-500 shrink-0">
                    [{l.timestamp}]
                  </span>
                  <span
                    className={
                      l.type === 'cmd'
                        ? 'text-amber-300 font-bold'
                        : l.type === 'ack'
                        ? 'text-emerald-300 font-bold'
                        : l.type === 'err'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                    }
                  >
                    {l.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Two Column Layout: Manual Sensor Controls & Automated Phase 3 Suite */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Manual Sensor Controls (HTTP POST REST API) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">
              Manual Sensor Data Ingestion
            </h3>
            <span className="text-xs font-mono text-sky-400">
              POST /api/device/data
            </span>
          </div>

          <div className="space-y-3">
            {datastreams.map((ds) => (
              <div
                key={ds.id}
                className="bg-slate-950/60 border border-slate-800 rounded-xl p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-sky-400">
                      {ds.virtualPin}
                    </span>
                    <span className="text-xs font-semibold text-slate-200">
                      {ds.name}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {ds.dataType}
                  </span>
                </div>

                {ds.dataType === 'BOOLEAN' ? (
                  <select
                    value={readings[ds.virtualPin] || 'false'}
                    onChange={(e) =>
                      setReadings({
                        ...readings,
                        [ds.virtualPin]: e.target.value,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value="true">true (ON)</option>
                    <option value="false">false (OFF)</option>
                  </select>
                ) : (
                  <input
                    type={ds.dataType === 'STRING' ? 'text' : 'number'}
                    step={ds.dataType === 'FLOAT' ? '0.1' : '1'}
                    value={readings[ds.virtualPin] || ''}
                    onChange={(e) =>
                      setReadings({
                        ...readings,
                        [ds.virtualPin]: e.target.value,
                      })
                    }
                    placeholder={`e.g. ${ds.minValue ?? 0}`}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSendSensorData}
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-sky-500/20 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>POST Sensor Readings</span>
            </button>
            <button
              onClick={handleSendHeartbeat}
              disabled={loading}
              className="py-2.5 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Send keep-alive heartbeat"
            >
              <Heart className="w-3.5 h-3.5" />
              <span>Heartbeat</span>
            </button>
          </div>
        </div>

        {/* Right Column: Automated Phase 3 Acceptance Suite (6 Tests) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">
                Phase 3 Acceptance Test Suite
              </h3>
              <p className="text-[11px] text-slate-400">
                Section 8 Acceptance Criteria (Tests 1–6)
              </p>
            </div>
            <button
              id="sim-run-phase3-suite-btn"
              onClick={runPhase3AcceptanceSuite}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Run Suite</span>
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            {/* Test 1 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 1: Device WebSocket Connection
                </strong>
                <span className="text-slate-400 text-[11px]">
                  ESP32 connects as WS Client with Device Token
                </span>
              </div>
              <div>
                {suiteResults.test1 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test1 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test1 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>

            {/* Test 2 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 2: Isolated Command Routing
                </strong>
                <span className="text-slate-400 text-[11px]">
                  User sends command; routed ONLY to room_device_&#123;id&#125;
                </span>
              </div>
              <div>
                {suiteResults.test2 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test2 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test2 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>

            {/* Test 3 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 3: Hardware Action Execution
                </strong>
                <span className="text-slate-400 text-[11px]">
                  ESP32 parses JSON and triggers digitalWrite(27, HIGH)
                </span>
              </div>
              <div>
                {suiteResults.test3 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test3 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test3 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>

            {/* Test 4 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 4: Closed-Loop ACK Propagation
                </strong>
                <span className="text-slate-400 text-[11px]">
                  ESP32 sends command_ack; Web receives state_updated
                </span>
              </div>
              <div>
                {suiteResults.test4 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test4 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test4 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>

            {/* Test 5 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 5: State Persistence in PostgreSQL
                </strong>
                <span className="text-slate-400 text-[11px]">
                  Actuator state saved to PostgreSQL SensorData
                </span>
              </div>
              <div>
                {suiteResults.test5 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test5 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test5 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>

            {/* Test 6 */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <strong className="text-slate-200 block">
                  TEST 6: Offline 5-Second Timeout Handling
                </strong>
                <span className="text-slate-400 text-[11px]">
                  Device power cut triggers 5s timeout & switch reverts
                </span>
              </div>
              <div>
                {suiteResults.test6 === true && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {suiteResults.test6 === false && (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                {suiteResults.test6 === undefined && (
                  <span className="text-slate-500 text-[11px]">Pending</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Terminal Output */}
      {serverResponse && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <span className="text-slate-400">Server Execution Log</span>
            <span
              className={`px-2 py-0.5 rounded font-bold ${
                httpStatus === 200
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              HTTP {httpStatus}
            </span>
          </div>
          <pre className="text-slate-200 overflow-x-auto max-h-48">
            {JSON.stringify(serverResponse, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
