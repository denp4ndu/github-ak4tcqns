import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Edit2, Info, AlertCircle, Check } from 'lucide-react';
import { api } from '../services/api.ts';
import type { Device, Datastream, DataType } from '../types/index.ts';

interface DatastreamsPageProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  onRefresh: () => void;
}

export const DatastreamsPage: React.FC<DatastreamsPageProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  onRefresh,
}) => {
  const [datastreams, setDatastreams] = useState<Datastream[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Form states
  const [virtualPin, setVirtualPin] = useState<string>('V0');
  const [name, setName] = useState<string>('');
  const [dataType, setDataType] = useState<DataType>('INTEGER');
  const [unit, setUnit] = useState<string>('%');
  const [minValue, setMinValue] = useState<string>('0');
  const [maxValue, setMaxValue] = useState<string>('100');
  const [description, setDescription] = useState<string>('');

  const fetchStreams = async (deviceId: string) => {
    setLoading(true);
    try {
      const res = await api.getDatastreams(deviceId);
      if (res.success) {
        setDatastreams(res.datastreams);
      }
    } catch (err: any) {
      console.error('Fetch datastreams error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDevice) {
      fetchStreams(selectedDevice.id);
    }
  }, [selectedDevice]);

  const handleCreateDatastream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice || !virtualPin.trim() || !name.trim()) return;

    setLoading(true);
    try {
      await api.createDatastream(selectedDevice.id, {
        virtualPin: virtualPin.toUpperCase().trim(),
        name: name.trim(),
        dataType,
        unit: unit.trim() || undefined,
        minValue: minValue !== '' ? parseFloat(minValue) : null,
        maxValue: maxValue !== '' ? parseFloat(maxValue) : null,
        description: description.trim() || undefined,
      });

      setIsCreating(false);
      setName('');
      setDescription('');
      fetchStreams(selectedDevice.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to create datastream');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, pin: string) => {
    if (!confirm(`Delete Datastream ${pin}? All recorded sensor data for this virtual pin will be permanently deleted.`)) {
      return;
    }
    try {
      await api.deleteDatastream(id);
      if (selectedDevice) fetchStreams(selectedDevice.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to delete datastream');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            Datastreams & Virtual Pins
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Define logical telemetry channels, measurement units, data types, and min/max validation boundaries
          </p>
        </div>

        <div className="flex items-center gap-3">
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

          <button
            id="create-datastream-modal-btn"
            disabled={!selectedDevice}
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Datastream</span>
          </button>
        </div>
      </div>

      {/* Rule #10 Architectural Notice */}
      <div className="bg-sky-500/10 border border-sky-500/20 rounded-2xl p-4 flex items-start gap-3 text-sky-300 text-xs">
        <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold block text-sky-200">
            Architectural Rule: Virtual Pin ≠ Physical GPIO Pin
          </strong>
          <span>
            Virtual Pins (V0, V1, V2, etc.) are cloud logical channels decoupled from physical microchip pins. Physical GPIO mapping (such as reading analog sensor on GPIO 34 or triggering relay on GPIO 26) is handled purely inside ESP32 firmware, while the cloud API ingests telemetry via standard Virtual Pins.
          </span>
        </div>
      </div>

      {/* Datastream Create Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateDatastream}
          className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">
              Add Datastream to {selectedDevice?.name}
            </h3>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Virtual Pin * (e.g. V0, V1, V2)
              </label>
              <input
                id="new-ds-virtual-pin"
                type="text"
                required
                placeholder="V0"
                value={virtualPin}
                onChange={(e) => setVirtualPin(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white uppercase focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Datastream Name *
              </label>
              <input
                id="new-ds-name"
                type="text"
                required
                placeholder="e.g. Kelembaban Tanah, Suhu"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Data Type *
              </label>
              <select
                id="new-ds-datatype"
                value={dataType}
                onChange={(e) => setDataType(e.target.value as DataType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="INTEGER">INTEGER (Whole numbers e.g. 67, 1880)</option>
                <option value="FLOAT">FLOAT (Decimals e.g. 29.5)</option>
                <option value="BOOLEAN">BOOLEAN (True/False, ON/OFF)</option>
                <option value="STRING">STRING (Text message / Status)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Unit (e.g. %, °C, ADC, ON/OFF)
              </label>
              <input
                id="new-ds-unit"
                type="text"
                placeholder="%"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Min Allowed Value
              </label>
              <input
                id="new-ds-min"
                type="number"
                placeholder="0"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Max Allowed Value
              </label>
              <input
                id="new-ds-max"
                type="number"
                placeholder="100"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Description (Optional)
            </label>
            <input
              id="new-ds-desc"
              type="text"
              placeholder="e.g. Analog soil sensor reading calibrated via mapped ADC"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              id="save-datastream-btn"
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs"
            >
              {loading ? 'Adding...' : 'Save Datastream'}
            </button>
          </div>
        </form>
      )}

      {/* Datastreams Table */}
      {!selectedDevice ? (
        <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <p className="text-xs text-slate-400">Please select a device above to view datastreams.</p>
        </div>
      ) : datastreams.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Layers className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <h3 className="text-base font-bold text-white">No Datastreams Defined</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
            Click "New Datastream" to register virtual pins (V0, V1, V2...) for this device.
          </p>
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 border-b border-slate-800 uppercase tracking-wider text-[10px] text-slate-400">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Virtual Pin</th>
                  <th className="py-3.5 px-4 font-semibold">Name</th>
                  <th className="py-3.5 px-4 font-semibold">Data Type</th>
                  <th className="py-3.5 px-4 font-semibold">Unit</th>
                  <th className="py-3.5 px-4 font-semibold">Allowed Range</th>
                  <th className="py-3.5 px-4 font-semibold">Description</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {datastreams.map((ds) => (
                  <tr key={ds.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-sky-400">
                      <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                        {ds.virtualPin}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-white">{ds.name}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        {ds.dataType}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-medium">{ds.unit || '—'}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-400">
                      {ds.minValue !== null && ds.maxValue !== null
                        ? `${ds.minValue} .. ${ds.maxValue}`
                        : 'Unlimited'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 max-w-xs truncate">
                      {ds.description || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleDelete(ds.id, ds.virtualPin)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                        title="Delete Datastream"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
