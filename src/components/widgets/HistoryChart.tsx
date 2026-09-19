import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../../services/api.ts';
import type { Datastream, TimeRange } from '../../types/index.ts';

interface HistoryChartProps {
  deviceId: string;
  datastreams: Datastream[];
}

const RANGES: { label: string; value: TimeRange }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

export const HistoryChart: React.FC<HistoryChartProps> = ({ deviceId, datastreams }) => {
  const numericStreams = datastreams.filter((d) => d.dataType === 'INTEGER' || d.dataType === 'FLOAT');
  const [selectedPin, setSelectedPin] = useState<string>(
    numericStreams.length > 0 ? numericStreams[0].virtualPin : 'V0'
  );
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1h');
  const [points, setPoints] = useState<{ timestamp: string; value: number; displayTime: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedPin if current pin is not in datastreams
  useEffect(() => {
    if (numericStreams.length > 0 && !numericStreams.some((s) => s.virtualPin === selectedPin)) {
      setSelectedPin(numericStreams[0].virtualPin);
    }
  }, [numericStreams, selectedPin]);

  const fetchHistory = useCallback(async () => {
    if (!deviceId || !selectedPin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDeviceHistory(deviceId, selectedPin, selectedRange);
      if (res.success && res.points) {
        const formatted = res.points
          .filter((p) => p.numericValue !== null && !isNaN(p.numericValue))
          .map((p) => ({
            timestamp: p.timestamp,
            value: p.numericValue as number,
            displayTime: new Date(p.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          }));
        setPoints(formatted);
      }
    } catch (err: any) {
      console.error('History fetch failed:', err);
      setError(err.message || 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  }, [deviceId, selectedPin, selectedRange]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const activeStream = datastreams.find((d) => d.virtualPin === selectedPin);

  return (
    <div id="history-chart-card" className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            <h3 className="text-lg font-bold text-white">Historical Sensor Readings</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Persisted time-series data queried directly from database
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Datastream Pin Selector */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg p-1">
            {numericStreams.map((s) => (
              <button
                key={s.virtualPin}
                id={`history-pin-${s.virtualPin.toLowerCase()}`}
                onClick={() => setSelectedPin(s.virtualPin)}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded transition-colors ${
                  selectedPin === s.virtualPin
                    ? 'bg-sky-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {s.virtualPin} ({s.name})
              </button>
            ))}
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                id={`history-range-${r.value}`}
                onClick={() => setSelectedRange(r.value)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  selectedRange === r.value
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            id="refresh-history-btn"
            onClick={fetchHistory}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
            title="Refresh historical data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Chart Canvas or Empty State */}
      <div className="mt-6 h-72 w-full flex items-center justify-center">
        {loading && points.length === 0 ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
            <span className="text-sm">Querying database...</span>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-slate-400 p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80 w-full">
            <AlertCircle className="w-8 h-8 text-slate-500" />
            <p className="text-base font-semibold text-slate-300">No historical data</p>
            <p className="text-xs text-slate-500 max-w-sm">
              No sensor entries found for {selectedPin} within the selected range ({selectedRange}). Send readings from ESP32 or the simulator to generate history.
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
                    return new Date(payload[0].payload.timestamp).toLocaleString();
                  }
                  return '';
                }}
                formatter={(value: any) => [
                  `${value} ${activeStream?.unit || ''}`,
                  `${selectedPin} (${activeStream?.name || ''})`,
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#0284c7', stroke: '#38bdf8', strokeWidth: 1 }}
                activeDot={{ r: 6, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary Stats Footer */}
      {points.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-xs">
          <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-400 block">Total Data Points</span>
            <span className="text-sm font-bold font-mono text-white">{points.length}</span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-400 block">Latest Reading</span>
            <span className="text-sm font-bold font-mono text-sky-400">
              {points[points.length - 1].value} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-400 block">Minimum in Range</span>
            <span className="text-sm font-bold font-mono text-emerald-400">
              {Math.min(...points.map((p) => p.value))} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
            <span className="text-slate-400 block">Maximum in Range</span>
            <span className="text-sm font-bold font-mono text-rose-400">
              {Math.max(...points.map((p) => p.value))} {activeStream?.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
