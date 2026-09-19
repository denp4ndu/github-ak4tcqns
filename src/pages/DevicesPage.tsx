import React, { useState } from 'react';
import {
  Cpu,
  Plus,
  Trash2,
  RefreshCw,
  Key,
  Copy,
  Check,
  ExternalLink,
  Layers,
  AlertTriangle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../services/api.ts';
import type { Device, Project } from '../types/index.ts';

interface DevicesPageProps {
  devices: Device[];
  projects: Project[];
  onRefresh: () => void;
  onSelectDeviceForDashboard: (device: Device) => void;
  onManageDatastreams: (device: Device) => void;
}

export const DevicesPage: React.FC<DevicesPageProps> = ({
  devices,
  projects,
  onRefresh,
  onSelectDeviceForDashboard,
  onManageDatastreams,
}) => {
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects.length > 0 ? projects[0].id : ''
  );
  const [name, setName] = useState<string>('');
  const [deviceIdentifier, setDeviceIdentifier] = useState<string>('ESP32-001');
  const [loading, setLoading] = useState<boolean>(false);

  // Modal to show generated token (Once-only display Rule #28)
  const [newTokenModal, setNewTokenModal] = useState<{
    deviceName: string;
    token: string;
    isRegenerated?: boolean;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !deviceIdentifier.trim() || !selectedProjectId) {
      alert('Please fill all required fields');
      return;
    }

    setLoading(true);
    try {
      const res = await api.createDevice({
        projectId: selectedProjectId,
        name: name.trim(),
        deviceIdentifier: deviceIdentifier.trim(),
      });

      setName('');
      setDeviceIdentifier(`ESP32-00${devices.length + 2}`);
      setIsCreating(false);
      onRefresh();

      // Show token dialog
      setNewTokenModal({
        deviceName: res.device.name,
        token: res.deviceToken,
        isRegenerated: false,
      });
    } catch (err: any) {
      alert(err.message || 'Failed to create device');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateToken = async (device: Device) => {
    if (
      !confirm(
        `Regenerate token for "${device.name}"? The previous token will immediately stop working and any active ESP32 firmware will need to be updated with the new token.`
      )
    ) {
      return;
    }

    try {
      const res = await api.regenerateDeviceToken(device.id);
      setNewTokenModal({
        deviceName: device.name,
        token: res.deviceToken,
        isRegenerated: true,
      });
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate token');
    }
  };

  const handleDelete = async (id: string, devName: string) => {
    if (!confirm(`Delete device "${devName}" and all associated datastreams and readings?`)) {
      return;
    }
    try {
      await api.deleteDevice(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to delete device');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-sky-400" />
            ESP32 Devices
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage registered microcontrollers, secure device tokens, and hardware connection state
          </p>
        </div>

        <button
          id="create-device-modal-btn"
          onClick={() => {
            if (projects.length === 0) {
              alert('Please create a project first before registering a device.');
              return;
            }
            setIsCreating(true);
          }}
          className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/20 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Register New Device</span>
        </button>
      </div>

      {/* Creation Modal / Inline Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateDevice}
          className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">Register New ESP32 Device</h3>
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
                Parent Project *
              </label>
              <select
                id="device-project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Device Name *
              </label>
              <input
                id="new-device-name"
                type="text"
                required
                placeholder="e.g. ESP32 Greenhouse 01"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Device Identifier * (Unique)
              </label>
              <input
                id="new-device-identifier"
                type="text"
                required
                placeholder="e.g. ESP32-001"
                value={deviceIdentifier}
                onChange={(e) => setDeviceIdentifier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500"
              />
            </div>
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
              id="save-device-btn"
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs"
            >
              {loading ? 'Registering...' : 'Register & Generate Token'}
            </button>
          </div>
        </form>
      )}

      {/* Secret Token Display Modal (Crucial Security Rule #28) */}
      {newTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-emerald-400">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {newTokenModal.isRegenerated ? 'Token Regenerated' : 'Device Created Successfully'}
                </h3>
                <p className="text-xs text-slate-400">{newTokenModal.deviceName}</p>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 flex items-start gap-2.5 text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block text-amber-200">
                  IMPORTANT: Copy this token now!
                </strong>
                <span>
                  For security, device tokens are hashed with SHA-256 before storing. This token will NEVER be shown again. Paste it into your ESP32 Arduino firmware.
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Your Device Secret Token
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="displayed-device-token"
                  type="text"
                  readOnly
                  value={newTokenModal.token}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-emerald-400 select-all focus:outline-none"
                />
                <button
                  id="copy-token-btn"
                  onClick={() => copyToClipboard(newTokenModal.token)}
                  className="px-3.5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1 shrink-0 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <button
              onClick={() => setNewTokenModal(null)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              I have safely copied my token
            </button>
          </div>
        </div>
      )}

      {/* Devices Table / Grid */}
      {devices.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Cpu className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <h3 className="text-base font-bold text-white">No ESP32 Devices Registered</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
            Click "Register New Device" to create a device identifier and generate your first ESP32 authentication token.
          </p>
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 border-b border-slate-800 uppercase tracking-wider text-[10px] text-slate-400">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Device</th>
                  <th className="py-3.5 px-4 font-semibold">Identifier</th>
                  <th className="py-3.5 px-4 font-semibold">Project</th>
                  <th className="py-3.5 px-4 font-semibold">Status</th>
                  <th className="py-3.5 px-4 font-semibold">Last Seen</th>
                  <th className="py-3.5 px-4 font-semibold">Datastreams</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {devices.map((d) => {
                  const isOnline = d.status === 'ONLINE';
                  return (
                    <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isOnline
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                        </div>
                        <span>{d.name}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">{d.deviceIdentifier}</td>
                      <td className="py-3.5 px-4 text-slate-400">{d.projectName || '—'}</td>
                      <td className="py-3.5 px-4">
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            ONLINE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            OFFLINE
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {d.lastSeen ? (
                          <span>{new Date(d.lastSeen).toLocaleTimeString()}</span>
                        ) : (
                          <span className="italic text-slate-600">Never</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => onManageDatastreams(d)}
                          className="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>{d.datastreamCount ?? 0} datastreams</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => onSelectDeviceForDashboard(d)}
                          className="p-1.5 text-slate-400 hover:text-sky-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="Open in Dashboard"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRegenerateToken(d)}
                          className="p-1.5 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="Regenerate Device Token"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(d.id, d.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="Delete Device"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
