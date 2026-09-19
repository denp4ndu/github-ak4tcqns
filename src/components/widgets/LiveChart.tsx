import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Activity, Radio, Trash2, Cpu } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket.ts';
import { api } from '../../services/api.ts';
import type { Device, Datastream } from '../../types/index.ts';

interface LiveChartProps {
  device: Device;
  datastreams: Datastream[];
}

const MAX_WINDOW_POINTS = 35;

interface DataPoint {
  timestamp: string;
  displayTime: string;
  value: number;
}

export const LiveChart: React.FC<LiveChartProps> = ({ device, datastreams }) => {
  const { isConnected, subscribe } = useWebSocket();

  const numericStreams = useMemo(
    () => datastreams.filter((d) => d.dataType === 'INTEGER' || d.dataType === 'FLOAT'),
    [datastreams]
  );

  const [selectedPin, setSelectedPin] = useState<string>(() => {
    return numericStreams.find((s) => s.virtualPin === 'V0')?.virtualPin || numericStreams[0]?.virtualPin || 'V0';
  });

  const [points, setPoints] = useState<DataPoint[]>([]);
  const [pulseKey, setPulseKey] = useState<number>(0);

  // Sync selected pin if list of datastreams changes
  useEffect(() => {
    if (numericStreams.length > 0 && !numericStreams.some((s) => s.virtualPin === selectedPin)) {
      setSelectedPin(numericStreams[0].virtualPin);
    }
  }, [numericStreams, selectedPin]);

  // Load recent points upon device or pin change (seed initial window up to 20 points)
  useEffect(() => {
    let isCancelled = false;
    async function seedInitialPoints() {
      if (!device || !selectedPin) return;
      try {
        const res = await api.getDeviceHistory(device.id, selectedPin, '5m');
        if (!isCancelled && res.success && res.points && res.points.length > 0) {
          const valid = res.points
            .filter((p) => p.numericValue !== null && !isNaN(p.numericValue))
            .slice(-20)
            .map((p) => ({
              timestamp: p.timestamp,
              value: p.numericValue as number,
              displayTime: new Date(p.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            }));
          setPoints(valid);
        }
      } catch {
        // Seeding failure is non-fatal; live points will accumulate
      }
    }

    seedInitialPoints();
    return () => {
      isCancelled = true;
    };
  }, [device.id, selectedPin]);

  // Subscribe to WebSocket 'sensor_update' events using sliding window
  useEffect(() => {
    if (!device) return;

    const unsubscribe = subscribe((payload) => {
      // Filter strictly for this device
      if (payload.deviceId !== device.deviceIdentifier) return;

      // Check if the payload contains data for the currently selected pin
      if (payload.data && payload.data[selectedPin] !== undefined) {
        const rawVal = payload.data[selectedPin];
        const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));

        if (!isNaN(numVal)) {
          const now = new Date(payload.timestamp);
          const newPoint: DataPoint = {
            timestamp: payload.timestamp,
            displayTime: now.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            value: numVal,
          };

          setPoints((prev) => {
            // Apply Sliding Window: retain strictly the last MAX_WINDOW_POINTS entries
            const nextPoints = [...prev, newPoint];
            if (nextPoints.length > MAX_WINDOW_POINTS) {
              return nextPoints.slice(nextPoints.length - MAX_WINDOW_POINTS);
            }
            return nextPoints;
          });

          setPulseKey((k) => k + 1);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [device.deviceIdentifier, selectedPin, subscribe]);

  const activeStream = datastreams.find((d) => d.virtualPin === selectedPin);
  const latestValue = points.length > 0 ? points[points.length - 1].value : null;
  const minValue = points.length > 0 ? Math.min(...points.map((p) => p.value)) : null;
  const maxValue = points.length > 0 ? Math.max(...points.map((p) => p.value)) : null;

  if (numericStreams.length === 0) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
        <Cpu className="w-8 h-8 mx-auto mb-2 text-slate-600" />
        <p className="text-sm font-semibold text-slate-300">No Numeric Datastreams Configured</p>
        <p className="text-xs text-slate-500 mt-1">
          Live streaming charts require an INTEGER or FLOAT datastream (e.g. V0 for Temperature or Moisture).
        </p>
      </div>
    );
  }

  return (
    <div
      id="live-chart-card"
      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm relative overflow-hidden"
    >
      {/* Top Header & Pin Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-3 w-3">
              {isConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              )}
            </div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Real-Time Live Chart</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                Sliding Window (Max {MAX_WINDOW_POINTS} pts)
              </span>
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Receiving instant WebSocket broadcasts from <code className="text-slate-300">{device.deviceIdentifier}</code>
          </p>
        </div>

        {/* Controls: Datastream Switcher & Clear */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-1">
            {numericStreams.map((s) => (
              <button
                key={s.virtualPin}
                id={`live-chart-pin-${s.virtualPin.toLowerCase()}`}
                onClick={() => {
                  setSelectedPin(s.virtualPin);
                  setPoints([]);
                }}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition-all cursor-pointer ${
                  selectedPin === s.virtualPin
                    ? 'bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/30'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {s.virtualPin} {s.unit ? `(${s.unit})` : ''}
              </button>
            ))}
          </div>

          <button
            id="live-chart-clear-btn"
            onClick={() => setPoints([])}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors cursor-pointer"
            title="Clear live window"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Real-time Indicator Bar */}
      <div className="flex items-center justify-between mt-3 text-xs text-slate-400 px-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">Stream:</span>
          <span className="font-mono text-sky-400 font-bold">{selectedPin}</span>
          <span className="text-slate-500">&bull;</span>
          <span className="text-slate-300">{activeStream?.name || 'Sensor Reading'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-slate-400">
            Window: <strong className="text-white">{points.length}</strong> / {MAX_WINDOW_POINTS} pts
          </span>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
            <Radio className="w-3 h-3 animate-pulse" />
            <span>LIVE</span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="mt-4 h-64 w-full flex items-center justify-center">
        {points.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80 w-full h-full">
            <Activity className="w-8 h-8 text-sky-400/50 animate-pulse mb-2" />
            <p className="text-sm font-semibold text-slate-300">Listening for Real-Time Telemetry</p>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              Waiting for ESP32 to push reading on pin <strong className="text-slate-300 font-mono">{selectedPin}</strong>.
              New readings will stream onto the chart instantly.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="displayTime"
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                tickLine={false}
                unit={activeStream?.unit ? ` ${activeStream.unit}` : ''}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  fontSize: '0.8rem',
                  color: '#f8fafc',
                }}
                labelFormatter={(_, payload) => {
                  if (payload && payload[0]) {
                    return new Date(payload[0].payload.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      fractionalSecondDigits: 3,
                    });
                  }
                  return '';
                }}
                formatter={(val: any) => [
                  `${val} ${activeStream?.unit || ''}`,
                  `${selectedPin} (${activeStream?.name || ''})`,
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#38bdf8"
                strokeWidth={2.5}
                isAnimationActive={false}
                dot={{ r: 3, fill: '#0284c7', stroke: '#38bdf8', strokeWidth: 1 }}
                activeDot={{ r: 5, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Mini Stat Summary Footer */}
      {points.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-3 gap-3 text-center text-xs">
          <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Current Live Value</span>
            <span
              key={pulseKey}
              className="text-base font-bold font-mono text-sky-400 animate-pulse inline-block"
            >
              {latestValue} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Window Minimum</span>
            <span className="text-base font-bold font-mono text-emerald-400">
              {minValue} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Window Maximum</span>
            <span className="text-base font-bold font-mono text-rose-400">
              {maxValue} {activeStream?.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
