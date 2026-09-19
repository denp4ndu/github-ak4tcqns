import React, { useState, useEffect } from 'react';
import { BarChart3, Clock, RefreshCw, AlertCircle, Calendar, Filter, Database, Download } from 'lucide-react';
import { api } from '../services/api.ts';
import { HistoricalChart } from '../components/widgets/HistoricalChart.tsx';
import type { Device, Datastream, TimeRange } from '../types/index.ts';

interface DataHistoryPageProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  datastreams: Datastream[];
}

export const DataHistoryPage: React.FC<DataHistoryPageProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  datastreams,
}) => {
  const [selectedPin, setSelectedPin] = useState<string>('V0');
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1h');
  const [rawPoints, setRawPoints] = useState<{ timestamp: string; value: string; numericValue: number | null }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  useEffect(() => {
    if (datastreams.length > 0 && !datastreams.some((d) => d.virtualPin === selectedPin)) {
      setSelectedPin(datastreams[0].virtualPin);
    }
  }, [datastreams, selectedPin]);

  const handleDownloadCSV = async () => {
    if (!selectedDevice) return;
    try {
      setIsExporting(true);
      const token = localStorage.getItem('esp32_auth_token');
      const response = await fetch(`/api/devices/${selectedDevice.id}/export`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) throw new Error('Gagal mengunduh berkas CSV');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ESP32_${selectedDevice.deviceIdentifier}_export_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('Gagal ekspor CSV: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const fetchHistoryTable = async () => {
    if (!selectedDevice || !selectedPin) return;
    setLoading(true);
    try {
      const res = await api.getDeviceHistory(selectedDevice.id, selectedPin, selectedRange);
      if (res.success && res.points) {
        setRawPoints(res.points);
      }
    } catch (err: any) {
      console.error('Fetch history error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryTable();
  }, [selectedDevice, selectedPin, selectedRange]);

  const activeStream = datastreams.find((d) => d.virtualPin === selectedPin);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            Historical Telemetry Logs
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Query persisted time-series sensor points from the relational database
          </p>
        </div>

        <div className="flex items-center gap-3">
          {selectedDevice && (
            <button
              id="export-csv-btn"
              onClick={handleDownloadCSV}
              disabled={isExporting}
              className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-50"
              title="Download telemetry sensor history as CSV"
            >
              <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
              <span>{isExporting ? 'Mengunduh...' : 'Export CSV Data'}</span>
            </button>
          )}

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
      </div>

      {selectedDevice && datastreams.length > 0 && (
        <>
          {/* Chart Component */}
          <HistoricalChart deviceId={selectedDevice.id} datastreams={datastreams} />

          {/* Raw Log Records Table */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden p-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white">
                  Database Records for {selectedPin} ({rawPoints.length} entries)
                </h3>
              </div>
              <button
                onClick={fetchHistoryTable}
                disabled={loading}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
                <span>Refresh Logs</span>
              </button>
            </div>

            {rawPoints.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No database records logged for {selectedPin} in the past {selectedRange}.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 mt-4">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/60 sticky top-0 uppercase tracking-wider text-[10px] text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Timestamp (UTC / Local)</th>
                      <th className="py-2.5 px-4 font-semibold">Virtual Pin</th>
                      <th className="py-2.5 px-4 font-semibold">Recorded Value</th>
                      <th className="py-2.5 px-4 font-semibold">Numeric Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {rawPoints.map((pt, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 text-slate-400">
                          {new Date(pt.timestamp).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-sky-400 font-bold">{selectedPin}</td>
                        <td className="py-2.5 px-4 font-bold text-white">
                          {pt.value} {activeStream?.unit}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">
                          {pt.numericValue !== null ? pt.numericValue : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
