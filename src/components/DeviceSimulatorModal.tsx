import React, { useState } from 'react';
import { X, Send, Heart, Terminal, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { api } from '../services/api.ts';
import type { Device, Datastream } from '../types/index.ts';

interface DeviceSimulatorModalProps {
  device: Device;
  datastreams: Datastream[];
  onClose: () => void;
  onDataSent?: () => void;
}

export const DeviceSimulatorModal: React.FC<DeviceSimulatorModalProps> = ({
  device,
  datastreams,
  onClose,
  onDataSent,
}) => {
  const [deviceToken, setDeviceToken] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'normal' | 'tests' | 'heartbeat'>('normal');

  // Input states for normal sensor send
  const [readings, setReadings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const d of datastreams) {
      if (d.virtualPin === 'V0') initial[d.virtualPin] = '67';
      else if (d.virtualPin === 'V1') initial[d.virtualPin] = '29.5';
      else if (d.virtualPin === 'V2') initial[d.virtualPin] = '1880';
      else if (d.virtualPin === 'V3') initial[d.virtualPin] = 'true';
      else initial[d.virtualPin] = d.currentValue || '0';
    }
    return initial;
  });

  // Test custom payload editor
  const [customPayload, setCustomPayload] = useState<string>(
    JSON.stringify(
      {
        deviceToken: '',
        data: { V0: 67, V1: 29.5, V2: 1880, V3: true },
      },
      null,
      2
    )
  );

  const [loading, setLoading] = useState<boolean>(false);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [serverResponse, setServerResponse] = useState<any>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleSendSensorData = async () => {
    if (!deviceToken.trim()) {
      alert('Please enter your Device Token (generated when creating or regenerating the device).');
      return;
    }

    setLoading(true);
    setHttpStatus(null);
    setServerResponse(null);

    // Build payload according to datastream types
    const dataToSend: Record<string, any> = {};
    for (const ds of datastreams) {
      const val = readings[ds.virtualPin];
      if (val === undefined || val === '') continue;

      if (ds.dataType === 'INTEGER') dataToSend[ds.virtualPin] = parseInt(val, 10);
      else if (ds.dataType === 'FLOAT') dataToSend[ds.virtualPin] = parseFloat(val);
      else if (ds.dataType === 'BOOLEAN') dataToSend[ds.virtualPin] = val === 'true' || val === '1' || val === 'ON';
      else dataToSend[ds.virtualPin] = val;
    }

    try {
      const res = await api.ingestDeviceData({
        deviceToken: deviceToken.trim(),
        data: dataToSend,
      });
      setHttpStatus(200);
      setServerResponse(res);
      onDataSent?.();
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
    setHttpStatus(null);
    setServerResponse(null);

    try {
      const res = await api.sendDeviceHeartbeat(deviceToken.trim());
      setHttpStatus(200);
      setServerResponse(res);
      onDataSent?.();
    } catch (err: any) {
      setHttpStatus(err.status || 401);
      setServerResponse({
        success: false,
        error: err.code || 'REQUEST_FAILED',
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRunAcceptancePreset = async (testId: string) => {
    setLoading(true);
    setHttpStatus(null);
    setServerResponse(null);

    let payload: any = {};

    switch (testId) {
      case 'test7': // Test 7: V0 = 67
        payload = {
          deviceToken: deviceToken.trim() || 'REPLACE_WITH_VALID_TOKEN',
          data: { V0: 67 },
        };
        break;
      case 'test11': // Test 11: V0 = 68
        payload = {
          deviceToken: deviceToken.trim() || 'REPLACE_WITH_VALID_TOKEN',
          data: { V0: 68 },
        };
        break;
      case 'test13': // Test 13: Invalid token
        payload = {
          deviceToken: 'invalid_device_token_xyz123',
          data: { V0: 67 },
        };
        break;
      case 'test14': // Test 14: Unknown pin V99
        payload = {
          deviceToken: deviceToken.trim() || 'REPLACE_WITH_VALID_TOKEN',
          data: { V99: 100 },
        };
        break;
      case 'test15': // Test 15: String "hello" into INTEGER V0
        payload = {
          deviceToken: deviceToken.trim() || 'REPLACE_WITH_VALID_TOKEN',
          data: { V0: 'hello' },
        };
        break;
    }

    try {
      const res = await api.ingestDeviceData(payload);
      setHttpStatus(200);
      setServerResponse(res);
      onDataSent?.();
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

  const curlExample = `curl -X POST "${window.location.origin}/api/device/data" \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceToken": "${deviceToken || 'YOUR_DEVICE_TOKEN'}",
    "data": {
      "V0": 67,
      "V1": 29.5,
      "V2": 1880,
      "V3": true
    }
  }'`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">ESP32 REST API Hardware Simulator</h2>
              <p className="text-xs text-slate-400">
                Target Device: <span className="font-mono text-sky-300">{device.name}</span> ({device.deviceIdentifier})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Device Token Input */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Device Token (Secret)
            </label>
            <input
              id="sim-device-token-input"
              type="text"
              placeholder="e.g. esp32_tok_9f81a7b3d2c1..."
              value={deviceToken}
              onChange={(e) => setDeviceToken(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Token generated from Device management. Hashed via SHA-256 by the server.
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 gap-4 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('normal')}
              className={`pb-2.5 border-b-2 transition-colors ${
                activeTab === 'normal'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Interactive Sensor Inputs
            </button>
            <button
              onClick={() => setActiveTab('tests')}
              className={`pb-2.5 border-b-2 transition-colors ${
                activeTab === 'tests'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Phase 1 Acceptance Test Presets
            </button>
            <button
              onClick={() => setActiveTab('heartbeat')}
              className={`pb-2.5 border-b-2 transition-colors ${
                activeTab === 'heartbeat'
                  ? 'border-sky-500 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Heartbeat (Keep-Alive)
            </button>
          </div>

          {/* Tab 1: Normal Ingestion Inputs */}
          {activeTab === 'normal' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {datastreams.map((ds) => (
                  <div key={ds.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono font-bold text-sky-400">{ds.virtualPin}</span>
                      <span className="text-[11px] text-slate-400">{ds.dataType}</span>
                    </div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">{ds.name}</label>
                    {ds.dataType === 'BOOLEAN' ? (
                      <select
                        value={readings[ds.virtualPin] || 'false'}
                        onChange={(e) =>
                          setReadings({ ...readings, [ds.virtualPin]: e.target.value })
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
                          setReadings({ ...readings, [ds.virtualPin]: e.target.value })
                        }
                        placeholder={`e.g. ${ds.minValue ?? 0}`}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                    )}
                  </div>
                ))}
              </div>

              <button
                id="send-simulated-data-btn"
                onClick={handleSendSensorData}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {loading ? 'Sending to /api/device/data...' : 'POST Sensor Data (Simulate ESP32 Ingestion)'}
              </button>
            </div>
          )}

          {/* Tab 2: Acceptance Tests Presets */}
          {activeTab === 'tests' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Click any preset below to instantly run Section 37 Acceptance Tests against the live backend:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleRunAcceptancePreset('test7')}
                  className="text-left p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-sky-500/60 transition-all cursor-pointer"
                >
                  <span className="font-bold text-emerald-400 block">TEST 7: Valid Ingestion</span>
                  <span className="text-slate-400 text-[11px]">Sends V0 = 67 to test 200 OK & DB persist</span>
                </button>

                <button
                  onClick={() => handleRunAcceptancePreset('test11')}
                  className="text-left p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-sky-500/60 transition-all cursor-pointer"
                >
                  <span className="font-bold text-sky-400 block">TEST 11: Updated Reading</span>
                  <span className="text-slate-400 text-[11px]">Sends V0 = 68 to test dashboard update</span>
                </button>

                <button
                  onClick={() => handleRunAcceptancePreset('test13')}
                  className="text-left p-3 rounded-xl bg-slate-950/80 border border-rose-900/40 hover:border-rose-500 transition-all cursor-pointer"
                >
                  <span className="font-bold text-rose-400 block">TEST 13: Invalid Token</span>
                  <span className="text-slate-400 text-[11px]">Tests 401 INVALID_DEVICE_TOKEN</span>
                </button>

                <button
                  onClick={() => handleRunAcceptancePreset('test14')}
                  className="text-left p-3 rounded-xl bg-slate-950/80 border border-amber-900/40 hover:border-amber-500 transition-all cursor-pointer"
                >
                  <span className="font-bold text-amber-400 block">TEST 14: Unknown Pin V99</span>
                  <span className="text-slate-400 text-[11px]">Tests 400 UNKNOWN_VIRTUAL_PIN</span>
                </button>

                <button
                  onClick={() => handleRunAcceptancePreset('test15')}
                  className="text-left p-3 rounded-xl bg-slate-950/80 border border-amber-900/40 hover:border-amber-500 transition-all cursor-pointer sm:col-span-2"
                >
                  <span className="font-bold text-amber-400 block">TEST 15: Invalid Data Type</span>
                  <span className="text-slate-400 text-[11px]">Sends string "hello" to INTEGER pin V0 -&gt; tests 400 INVALID_DATA_TYPE</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Heartbeat */}
          {activeTab === 'heartbeat' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Tests keep-alive heartbeat (`POST /api/device/heartbeat`). Updates `device.lastSeen` without modifying sensor data.
              </p>
              <button
                onClick={handleSendHeartbeat}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                <Heart className="w-4 h-4 text-slate-950 fill-slate-950" />
                {loading ? 'Sending Heartbeat...' : 'Send POST /api/device/heartbeat'}
              </button>
            </div>
          )}

          {/* cURL Snippet */}
          <div className="bg-slate-950 rounded-xl p-3 border border-slate-800">
            <div className="flex items-center justify-between mb-1 text-xs text-slate-400">
              <span>Equivalent Terminal cURL Command:</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(curlExample);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied!' : 'Copy cURL'}</span>
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto p-2 bg-slate-900/80 rounded">
              {curlExample}
            </pre>
          </div>

          {/* Server Response Terminal */}
          {serverResponse && (
            <div className="border border-slate-800 rounded-xl p-4 bg-slate-950 font-mono text-xs">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <span className="text-slate-400">Server Response</span>
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
              <pre className="text-slate-300 overflow-x-auto max-h-40">
                {JSON.stringify(serverResponse, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
