import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Database, Clock, RefreshCw, AlertCircle, Calendar } from 'lucide-react';
import { api } from '../../services/api.ts';
import type { Datastream, TimeRange } from '../../types/index.ts';

interface HistoricalChartProps {
  deviceId: string;
  datastreams: Datastream[];
}

const HISTORICAL_RANGES: { label: string; value: TimeRange; description: string }[] = [
  { label: '1 Hour', value: '1h', description: 'Past 60 minutes' },
  { label: '6 Hours', value: '6h', description: 'Past 6 hours' },
  { label: '24 Hours', value: '24h', description: 'Past 24 hours' },
  { label: '7 Days', value: '7d', description: 'Past 7 days' },
];

interface HistoryPoint {
  timestamp: string;
  value: number;
  displayTime: string;
  fullDate: string;
}

export const HistoricalChart: React.FC<HistoricalChartProps> = ({ deviceId, datastreams }) => {
  const numericStreams = useMemo(
    () => datastreams.filter((d) => d.dataType === 'INTEGER' || d.dataType === 'FLOAT'),
    [datastreams]
  );

  const [selectedPin, setSelectedPin] = useState<string>(() => {
    return numericStreams.find((s) => s.virtualPin === 'V0')?.virtualPin || numericStreams[0]?.virtualPin || 'V0';
  });

  const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedPin if available streams change
  useEffect(() => {
    if (numericStreams.length > 0 && !numericStreams.some((s) => s.virtualPin === selectedPin)) {
      setSelectedPin(numericStreams[0].virtualPin);
    }
  }, [numericStreams, selectedPin]);

  const fetchHistoricalData = useCallback(async () => {
    if (!deviceId || !selectedPin) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.getDeviceHistory(deviceId, selectedPin, selectedRange);

      if (res.success && res.points) {
        const formatted: HistoryPoint[] = res.points
          .filter((p) => p.numericValue !== null && !isNaN(p.numericValue))
          .map((p) => {
            const date = new Date(p.timestamp);
            // Format X-axis according to time range
            const isLongRange = selectedRange === '7d' || selectedRange === '24h';
            const displayTime = isLongRange
              ? `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date
                  .getDate()
                  .toString()
                  .padStart(2, '0')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return {
              timestamp: p.timestamp,
              value: p.numericValue as number,
              displayTime,
              fullDate: date.toLocaleString(),
            };
          });

        setPoints(formatted);
      } else {
        setPoints([]);
      }
    } catch (err: any) {
      console.error('Failed to fetch historical sensor data:', err);
      setError(err?.message || 'Failed to query database history');
    } finally {
      setLoading(false);
    }
  }, [deviceId, selectedPin, selectedRange]);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  const activeStream = datastreams.find((d) => d.virtualPin === selectedPin);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      count: points.length,
      latest: points[points.length - 1].value,
      min,
      max,
      avg: Number(avg.toFixed(2)),
    };
  }, [points]);

  return (
    <div
      id="historical-chart-card"
      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm"
    >
      {/* Header & Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Advanced Historical Analysis</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Persisted time-series data queried directly from PostgreSQL
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Datastream Virtual Pin Selector */}
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-1">
            {numericStreams.map((s) => (
              <button
                key={s.virtualPin}
                id={`history-pin-${s.virtualPin.toLowerCase()}`}
                onClick={() => setSelectedPin(s.virtualPin)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-lg transition-colors cursor-pointer ${
                  selectedPin === s.virtualPin
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {s.virtualPin} ({s.name})
              </button>
            ))}
          </div>

          {/* Time Range Selector: 1 Hour, 6 Hours, 24 Hours, 7 Days */}
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-1">
            {HISTORICAL_RANGES.map((r) => (
              <button
                key={r.value}
                id={`history-range-${r.value}`}
                onClick={() => setSelectedRange(r.value)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  selectedRange === r.value
                    ? 'bg-slate-700 text-white font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={r.description}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Refresh Action */}
          <button
            id="refresh-history-btn"
            onClick={fetchHistoricalData}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50 cursor-pointer border border-slate-700/60"
            title="Refresh database history"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="mt-6 h-72 w-full flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <RefreshCw className="w-7 h-7 animate-spin text-emerald-400" />
            <span className="text-sm font-medium">Querying PostgreSQL database...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-rose-400 p-6 text-center">
            <AlertCircle className="w-8 h-8" />
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={fetchHistoricalData}
              className="mt-2 px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
            >
              Retry Query
            </button>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-slate-400 p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80 w-full h-full">
            <Calendar className="w-8 h-8 text-slate-500" />
            <p className="text-base font-semibold text-slate-300">No historical data</p>
            <p className="text-xs text-slate-500 max-w-sm">
              No recorded sensor readings for <code className="text-slate-400 font-mono">{selectedPin}</code> within the
              selected range ({selectedRange}). Send telemetry from your ESP32 or simulator to populate history.
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
                    return payload[0].payload.fullDate;
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
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ r: 2.5, fill: '#059669', stroke: '#10b981', strokeWidth: 1 }}
                activeDot={{ r: 5, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Aggregate Statistics Footer */}
      {stats && (
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Total Points</span>
            <span className="text-sm font-bold font-mono text-white">{stats.count}</span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Latest Value</span>
            <span className="text-sm font-bold font-mono text-emerald-400">
              {stats.latest} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Average</span>
            <span className="text-sm font-bold font-mono text-sky-400">
              {stats.avg} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Minimum</span>
            <span className="text-sm font-bold font-mono text-amber-400">
              {stats.min} {activeStream?.unit}
            </span>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 block text-[11px]">Maximum</span>
            <span className="text-sm font-bold font-mono text-rose-400">
              {stats.max} {activeStream?.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
