import React, { useState, useEffect } from 'react';
import {
  Zap,
  Plus,
  Trash2,
  Edit2,
  Power,
  Cpu,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
} from 'lucide-react';
import { api } from '../services/api.ts';
import type { Device, Datastream, AutomationRule, RuleOperator } from '../types/index.ts';

interface AutomationsPageProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  datastreams: Datastream[];
}

export const AutomationsPage: React.FC<AutomationsPageProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  datastreams,
}) => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  // Form Fields
  const [ruleName, setRuleName] = useState<string>('');
  const [conditionDsId, setConditionDsId] = useState<string>('');
  const [operator, setOperator] = useState<RuleOperator>('<');
  const [conditionVal, setConditionVal] = useState<string>('30');
  const [actionDsId, setActionDsId] = useState<string>('');
  const [actionVal, setActionVal] = useState<string>('true');
  const [isFormSubmitting, setIsFormSubmitting] = useState<boolean>(false);

  // Load rules for selected device
  const fetchRules = async () => {
    if (!selectedDevice) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getAutomationRules(selectedDevice.id);
      if (res.success) {
        setRules(res.rules);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat aturan otomasi');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [selectedDevice?.id]);

  const openCreateModal = () => {
    setEditingRule(null);
    setRuleName('');
    setConditionDsId(datastreams[0]?.id || '');
    setOperator('<');
    setConditionVal('30');
    setActionDsId(datastreams[1]?.id || datastreams[0]?.id || '');
    setActionVal('true');
    setIsModalOpen(true);
  };

  const openEditModal = (rule: AutomationRule) => {
    setEditingRule(rule);
    setRuleName(rule.name);
    setConditionDsId(rule.conditionDatastreamId);
    setOperator(rule.operator);
    setConditionVal(String(rule.conditionValue));
    setActionDsId(rule.actionDatastreamId);
    setActionVal(rule.actionValue);
    setIsModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice) return;

    if (!ruleName.trim()) {
      setErrorMsg('Nama aturan tidak boleh kosong');
      return;
    }
    if (!conditionDsId || !actionDsId) {
      setErrorMsg('Pilih datastream pemicu dan eksekusi');
      return;
    }

    setIsFormSubmitting(true);
    setErrorMsg(null);

    const payload = {
      name: ruleName.trim(),
      conditionDatastreamId: conditionDsId,
      operator,
      conditionValue: parseFloat(conditionVal) || 0,
      actionDatastreamId: actionDsId,
      actionValue: actionVal.trim(),
    };

    try {
      if (editingRule) {
        await api.updateAutomationRule(selectedDevice.id, editingRule.id, payload);
        setSuccessMsg('Otomasi berhasil diperbarui!');
      } else {
        await api.createAutomationRule(selectedDevice.id, payload);
        setSuccessMsg('Aturan otomasi baru berhasil ditambahkan!');
      }

      setIsModalOpen(false);
      fetchRules();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan aturan otomasi');
    } finally {
      setIsFormSubmitting(false);
    }
  };

  const handleToggleRuleActive = async (rule: AutomationRule) => {
    if (!selectedDevice) return;
    try {
      await api.updateAutomationRule(selectedDevice.id, rule.id, {
        isActive: !rule.isActive,
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r))
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengubah status aktif otomasi');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedDevice) return;
    if (!window.confirm('Apakah Anda yakin ingin menghapus aturan otomasi ini?')) return;

    try {
      await api.deleteAutomationRule(selectedDevice.id, ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setSuccessMsg('Aturan otomasi berhasil dihapus');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus aturan otomasi');
    }
  };

  const getDsLabel = (dsId: string) => {
    const ds = datastreams.find((d) => d.id === dsId);
    if (!ds) return 'Datastream';
    return `${ds.name} (${ds.virtualPin})${ds.unit ? ` [${ds.unit}]` : ''}`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            <h1 className="text-xl font-bold text-white">Rule Engine & Otomasi Perangkat</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Evaluasi kondisi sensor di backend Node.js untuk mengeksekusi kontrol aktuator secara
            otomatis tanpa mengubah firmware C++ ESP32.
          </p>
        </div>

        {/* Device Switcher */}
        {devices.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 shrink-0">
            <Cpu className="w-4 h-4 text-sky-400" />
            <select
              value={selectedDevice?.id || ''}
              onChange={(e) => {
                const found = devices.find((d) => d.id === e.target.value);
                if (found) onSelectDevice(found);
              }}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900">
                  {d.name} ({d.deviceIdentifier})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">
            Daftar Aturan ({rules.length})
          </span>
          {selectedDevice && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
              {selectedDevice.deviceIdentifier}
            </span>
          )}
        </div>

        <button
          id="add-automation-rule-btn"
          onClick={openCreateModal}
          disabled={!selectedDevice || datastreams.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Otomasi Baru</span>
        </button>
      </div>

      {/* Alert Banners */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Rules List Grid */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 text-xs">Memuat aturan otomasi...</div>
      ) : !selectedDevice ? (
        <div className="py-16 text-center text-slate-500 text-xs">Pilih perangkat terlebih dahulu</div>
      ) : rules.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30">
          <Zap className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">Belum Ada Aturan Otomasi</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Buat aturanotomasi pertama Anda untuk menyalakan/mematikan pompa, kipas, atau alarm secara otomatis berdasarkan bacaan sensor ESP32.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl cursor-pointer hover:bg-amber-400 transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Buat Otomasi Pertama
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`p-5 rounded-2xl border transition-all ${
                rule.isActive
                  ? 'bg-slate-900/80 border-slate-700/80 hover:border-amber-500/40'
                  : 'bg-slate-950/60 border-slate-800/60 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-xl border ${
                      rule.isActive
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{rule.name}</h3>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ID: {rule.id.slice(0, 8)}
                    </span>
                  </div>
                </div>

                {/* Active Toggle Switch */}
                <button
                  onClick={() => handleToggleRuleActive(rule)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-all ${
                    rule.isActive
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                  }`}
                  title={rule.isActive ? 'Klik untuk menonaktifkan' : 'Klik untuk mengaktifkan'}
                >
                  <Power className="w-3 h-3" />
                  <span>{rule.isActive ? 'AKTIF' : 'NONAKTIF'}</span>
                </button>
              </div>

              {/* Rule Visual Formula */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2 my-3">
                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                  <span className="font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    JIKA
                  </span>
                  <span className="text-slate-200 font-semibold truncate">
                    {rule.conditionDatastream?.name || 'Datastream'} ({rule.conditionDatastream?.virtualPin || 'V?'})
                  </span>
                  <span className="text-amber-300 font-bold px-1 bg-slate-900 rounded">
                    {rule.operator}
                  </span>
                  <span className="text-sky-300 font-bold">{rule.conditionValue}</span>
                </div>

                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                  <span className="font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    MAKA SET
                  </span>
                  <span className="text-slate-200 font-semibold truncate">
                    {rule.actionDatastream?.name || 'Datastream'} ({rule.actionDatastream?.virtualPin || 'V?'})
                  </span>
                  <span className="text-emerald-300 font-bold">= {rule.actionValue}</span>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-500">
                  Dibuat: {new Date(rule.createdAt).toLocaleDateString('id-ID')}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(rule)}
                    className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    title="Edit Aturan"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    title="Hapus Aturan"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Rule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative text-left">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">
                  {editingRule ? 'Edit Aturan Otomasi' : 'Tambah Aturan Otomasi Baru'}
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4">
              {/* Rule Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Otomasi
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Auto Siram Kering (Pompa V3)"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Condition Section */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-amber-400 block uppercase tracking-wider">
                  1. Kondisi Pemicu (INPUT SENSOR)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-400 mb-1">Datastream Sensor</label>
                    <select
                      value={conditionDsId}
                      onChange={(e) => setConditionDsId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {datastreams.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.virtualPin} — {ds.name} {ds.unit ? `(${ds.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Operator</label>
                    <select
                      value={operator}
                      onChange={(e) => setOperator(e.target.value as RuleOperator)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-bold"
                    >
                      <option value="<">Kurang dari (&lt;)</option>
                      <option value=">">Lebih dari (&gt;)</option>
                      <option value="<=" font-bold>Sama atau Kurang (&lt;=)</option>
                      <option value=">=">Sama atau Lebih (&gt;=)</option>
                      <option value="==">Sama dengan (==)</option>
                      <option value="!=">Tidak Sama (!=)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Nilai Batas (Threshold)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={conditionVal}
                    onChange={(e) => setConditionVal(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                    placeholder="e.g. 30"
                  />
                </div>
              </div>

              {/* Action Section */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-emerald-400 block uppercase tracking-wider">
                  2. Tindakan Eksekusi (OUTPUT AKTUATOR)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Datastream Output</label>
                    <select
                      value={actionDsId}
                      onChange={(e) => setActionDsId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {datastreams.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.virtualPin} — {ds.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Perintah / Nilai Target</label>
                    <input
                      type="text"
                      required
                      value={actionVal}
                      onChange={(e) => setActionVal(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-mono font-bold"
                      placeholder="e.g. true atau 1 atau 0"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isFormSubmitting}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all disabled:opacity-50"
                >
                  {isFormSubmitting ? 'Menyimpan...' : 'Simpan Otomasi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
