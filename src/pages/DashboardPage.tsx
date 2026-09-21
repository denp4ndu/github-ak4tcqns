import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  Wifi,
  WifiOff,
  Clock,
  Terminal,
  AlertTriangle,
  Layers,
  Plus,
  Activity,
  Database,
  Sparkles,
  Zap,
  Edit3,
  Check,
  X,
  RotateCcw,
  LayoutGrid,
  Save,
  Loader2,
  Sliders,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { DashboardGrid } from '../components/dashboard/DashboardGrid.tsx';
import { AddWidgetModal } from '../components/dashboard/AddWidgetModal.tsx';
import { LiveChart } from '../components/widgets/LiveChart.tsx';
import { HistoricalChart } from '../components/widgets/HistoricalChart.tsx';
import type { Device, Datastream, Widget, WidgetInput, WidgetType } from '../types/index.ts';

interface DashboardPageProps {
  device: Device | null;
  datastreams: Datastream[];
  onOpenSimulator: () => void;
  onNavigateToDevices: () => void;
  onNavigateToDatastreams: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  device,
  datastreams,
  onOpenSimulator,
  onNavigateToDevices,
  onNavigateToDatastreams,
}) => {
  // Layout and Builder states
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [savedWidgetsSnapshot, setSavedWidgetsSnapshot] = useState<Widget[]>([]);
  const [isLoadingLayout, setIsLoadingLayout] = useState<boolean>(false);
  const [isSavingLayout, setIsSavingLayout] = useState<boolean>(false);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Analytical visualizer view mode
  const [chartViewMode, setChartViewMode] = useState<'live' | 'history' | 'both'>('live');

  // Load layout from PostgreSQL whenever device changes
  const loadLayout = useCallback(async (deviceId: string) => {
    console.log(`[UI] DashboardPage loadLayout called for device: ${deviceId}`);
    setIsLoadingLayout(true);
    setSaveFeedback(null);
    try {
      const res = await api.getDashboardLayout(deviceId);
      console.log(`[UI] DashboardPage loadLayout response for device: ${deviceId}, success: ${res.success}, widgets received: ${res.widgets?.length || 0}`);
      if (res.success) {
        setWidgets(res.widgets || []);
        setSavedWidgetsSnapshot(res.widgets || []);
        console.log(`[UI] DashboardPage state updated with ${res.widgets?.length || 0} widgets for device: ${deviceId}`);
      }
    } catch (err: any) {
      console.error('Failed to load dashboard layout:', err);
    } finally {
      setIsLoadingLayout(false);
    }
  }, []);

  useEffect(() => {
    console.log(`[UI] DashboardPage useEffect [device.id=${device?.id}] triggered, mounting/remounting`);
    setIsEditMode(false);
    if (device?.id) {
      loadLayout(device.id);
    } else {
      console.log(`[UI] DashboardPage: No deviceId, clearing widgets`);
      setWidgets([]);
      setSavedWidgetsSnapshot([]);
    }
  }, [device?.id, loadLayout]);

  // Helper to auto-generate default starter layout from available datastreams
  const handleGenerateDefaultLayout = () => {
    if (!device || datastreams.length === 0) return;

    const newWidgets: Widget[] = [];
    let currentX = 0;
    let currentY = 0;

    // 1. First add Actuators / Switches
    datastreams
      .filter((d) => d.dataType === 'BOOLEAN')
      .forEach((ds) => {
        newWidgets.push({
          id: `widget-${ds.virtualPin.toLowerCase()}-${Date.now()}`,
          deviceId: device.id,
          datastreamId: ds.id,
          type: 'SWITCH',
          x: currentX,
          y: currentY,
          w: 4,
          h: 2,
          title: ds.name,
          datastream: ds,
        });
        currentX = (currentX + 4) % 12;
        if (currentX === 0) currentY += 2;
      });

    // 2. Add Gauges for percentage or V0
    datastreams
      .filter(
        (d) =>
          d.dataType !== 'BOOLEAN' &&
          (d.virtualPin === 'V0' || d.unit === '%' || d.name.toLowerCase().includes('humidity'))
      )
      .forEach((ds) => {
        newWidgets.push({
          id: `widget-${ds.virtualPin.toLowerCase()}-${Date.now()}`,
          deviceId: device.id,
          datastreamId: ds.id,
          type: 'GAUGE',
          x: currentX,
          y: currentY,
          w: 3,
          h: 2,
          title: ds.name,
          datastream: ds,
        });
        currentX = (currentX + 3) % 12;
        if (currentX === 0) currentY += 2;
      });

    // 3. Add Value Cards for remaining sensors
    datastreams
      .filter(
        (d) =>
          d.dataType !== 'BOOLEAN' &&
          d.virtualPin !== 'V0' &&
          d.unit !== '%' &&
          !d.name.toLowerCase().includes('humidity')
      )
      .forEach((ds) => {
        newWidgets.push({
          id: `widget-${ds.virtualPin.toLowerCase()}-${Date.now()}`,
          deviceId: device.id,
          datastreamId: ds.id,
          type: 'VALUE_CARD',
          x: currentX,
          y: currentY,
          w: 3,
          h: 2,
          title: ds.name,
          datastream: ds,
        });
        currentX = (currentX + 3) % 12;
        if (currentX === 0) currentY += 2;
      });

    // 4. Add Live Chart for device
    const numericDs = datastreams.find((d) => d.dataType === 'INTEGER' || d.dataType === 'FLOAT');
    if (numericDs) {
      if (currentX !== 0) {
        currentX = 0;
        currentY += 2;
      }
      newWidgets.push({
        id: `widget-livechart-${Date.now()}`,
        deviceId: device.id,
        datastreamId: numericDs.id,
        type: 'LIVE_CHART',
        x: 0,
        y: currentY,
        w: 12,
        h: 4,
        title: 'Real-Time Telemetry Stream',
        datastream: numericDs,
      });
    }

    setWidgets(newWidgets);
    setIsEditMode(true);
  };

  // Add widget handler from modal
  const handleAddWidget = (input: WidgetInput) => {
    if (!device) return;

    const matchedDs = datastreams.find((d) => d.id === input.datastreamId);
    const newWidget: Widget = {
      id: `widget-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      deviceId: device.id,
      datastreamId: input.datastreamId,
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      title: input.title,
      datastream: matchedDs,
    };

    setWidgets((prev) => [...prev, newWidget]);
  };

  // Delete widget handler
  const handleDeleteWidget = (widgetId: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
  };

  // Layout change handler from react-grid-layout
  const handleLayoutChange = (updatedWidgets: Widget[]) => {
    setWidgets(updatedWidgets);
  };

  // Save layout to PostgreSQL via PUT /api/devices/:id/dashboard/layout
  const handleSaveLayout = async () => {
    if (!device) return;
    setIsSavingLayout(true);
    setSaveFeedback(null);

    const payload: WidgetInput[] = widgets.map((w) => ({
      id: w.id,
      datastreamId: w.datastreamId,
      type: w.type,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      title: w.title,
    }));

    try {
      const res = await api.saveDashboardLayout(device.id, payload);
      if (res.success) {
        setWidgets(res.widgets);
        setSavedWidgetsSnapshot(res.widgets);
        setIsEditMode(false);
        setSaveFeedback({
          type: 'success',
          message: 'Dashboard layout saved successfully to PostgreSQL.',
        });
        setTimeout(() => setSaveFeedback(null), 4000);
      } else {
        setSaveFeedback({
          type: 'error',
          message: res.message || 'Failed to save layout',
        });
      }
    } catch (err: any) {
      console.error('Error saving dashboard layout:', err);
      setSaveFeedback({
        type: 'error',
        message: err.message || 'Network or server error while saving layout.',
      });
    } finally {
      setIsSavingLayout(false);
    }
  };

  // Cancel edit mode and revert changes
  const handleCancelEdit = () => {
    setWidgets(savedWidgetsSnapshot);
    setIsEditMode(false);
    setSaveFeedback(null);
  };

  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
        <Cpu className="w-12 h-12 text-slate-600 mb-3" />
        <h2 className="text-lg font-bold text-white">No Devices Registered Yet</h2>
        <p className="text-xs text-slate-400 max-w-md mt-1 mb-6">
          Create a project and register an ESP32 device to start monitoring sensor datastreams.
        </p>
        <button
          id="empty-dash-create-device-btn"
          onClick={onNavigateToDevices}
          className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Register First ESP32 Device
        </button>
      </div>
    );
  }

  const isOnline = device.status === 'ONLINE';
  const hasEverReceivedData = datastreams.some(
    (d) => d.currentValue !== null && d.currentValue !== undefined
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Device Overview Banner & Phase 4 Builder Controls */}
      <div
        id="device-overview-card"
        className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
              isOnline
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            {isOnline ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white">{device.name}</h2>
              <span className="px-2 py-0.5 text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700 rounded-md">
                {device.deviceIdentifier}
              </span>
              <span
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                  isOnline
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 mt-1">
              <span>
                Project: <strong className="text-slate-200">{device.projectName || 'Default'}</strong>
              </span>
              <span>&bull;</span>
              <span>
                Datastreams: <strong className="text-slate-200">{datastreams.length}</strong>
              </span>
              <span>&bull;</span>
              <span>
                Widgets: <strong className="text-slate-200">{widgets.length}</strong>
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {device.lastSeen ? (
                  <>
                    Last seen: {new Date(device.lastSeen).toLocaleString()}
                    {device.secondsSinceLastSeen !== null && device.secondsSinceLastSeen !== undefined && (
                      <span className="text-slate-500 font-mono">
                        ({device.secondsSinceLastSeen}s ago)
                      </span>
                    )}
                  </>
                ) : (
                  <span className="italic text-amber-400/80">No data received yet</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Phase 4: Action Controls: Mode Switcher & Ingestion Simulator */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {!isEditMode ? (
            <button
              id="dash-edit-mode-btn"
              onClick={() => setIsEditMode(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 hover:text-white border border-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-sky-400" />
              <span>Edit Dashboard</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                id="dash-cancel-layout-btn"
                onClick={handleCancelEdit}
                disabled={isSavingLayout}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>

              <button
                id="dash-add-widget-btn"
                onClick={() => setIsAddModalOpen(true)}
                disabled={isSavingLayout || datastreams.length === 0}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-500/30 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Widget</span>
              </button>

              <button
                id="dash-save-layout-btn"
                onClick={handleSaveLayout}
                disabled={isSavingLayout}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                {isSavingLayout ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Save Layout</span>
              </button>
            </div>
          )}

          <button
            id="dash-open-sim-btn"
            onClick={onOpenSimulator}
            className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-sky-500/20 cursor-pointer"
          >
            <Terminal className="w-4 h-4" />
            <span>Simulate ESP32 Ingestion</span>
          </button>
        </div>
      </div>

      {/* Save Feedback Banner */}
      {saveFeedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-fade-in ${
            saveFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveFeedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{saveFeedback.message}</span>
          </div>
          <button
            onClick={() => setSaveFeedback(null)}
            className="p-1 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Edit Mode Instructions Banner */}
      {isEditMode && (
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sky-200 text-xs">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-sky-400 shrink-0" />
            <div>
              <strong className="font-semibold block text-white">
                Dashboard Builder Mode Active
              </strong>
              <span>
                Drag widget header bars to reorder. Drag bottom-right corners to resize. Changes will persist directly to PostgreSQL when you click <strong>Save Layout</strong>.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Widget</span>
            </button>
            <button
              onClick={handleGenerateDefaultLayout}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>
      )}

      {/* Offline Alert Notice when device has timed out */}
      {!isOnline && device.lastSeen && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center gap-3 text-rose-300 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <strong className="font-semibold block text-rose-200">Device is OFFLINE</strong>
            <span>
              No heartbeat or sensor transmission has been received for more than 30 seconds. Verify ESP32 WiFi connection and power supply.
            </span>
          </div>
        </div>
      )}

      {/* If brand new device with no data received at all */}
      {!hasEverReceivedData && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between gap-3 text-amber-300 text-xs">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <strong className="font-semibold block text-amber-200">
                Awaiting Initial ESP32 Transmission
              </strong>
              <span>
                All widgets display "No data received" according to Master Specification Rule #5. Flash your firmware or click Simulate ESP32 to push sensor data.
              </span>
            </div>
          </div>
          <button
            onClick={onOpenSimulator}
            className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs shrink-0 cursor-pointer"
          >
            Test Now
          </button>
        </div>
      )}

      {/* Phase 4: Dynamic Dashboard Grid Layout */}
      {isLoadingLayout ? (
        <div className="p-12 flex flex-col items-center justify-center bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-400">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin mb-2" />
          <span className="text-xs font-mono">Loading PostgreSQL widget layout...</span>
        </div>
      ) : widgets.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Device Dashboard ({widgets.length} Widgets)
              </h3>
            </div>
            {!isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Customize Layout</span>
              </button>
            )}
          </div>

          <DashboardGrid
            device={device}
            datastreams={datastreams}
            widgets={widgets}
            isEditMode={isEditMode}
            onLayoutChange={handleLayoutChange}
            onDeleteWidget={handleDeleteWidget}
            isDeviceOffline={!isOnline}
          />
        </div>
      ) : (
        /* Empty State: No widgets configured yet */
        <div className="p-10 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <LayoutGrid className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No Dashboard Widgets Configured</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-6">
            Build your custom telemetry and actuator control interface with drag-and-drop cards, gauges, charts, and switches.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              id="dash-first-widget-btn"
              onClick={() => setIsAddModalOpen(true)}
              disabled={datastreams.length === 0}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Your First Widget</span>
            </button>
            {datastreams.length > 0 && (
              <button
                id="dash-generate-starter-btn"
                onClick={handleGenerateDefaultLayout}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs flex items-center gap-2 border border-slate-700 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Generate Starter Dashboard</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Datastream Management Quick Link */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span>Configured Virtual Pins:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {datastreams.map((ds) => (
              <span
                key={ds.id}
                className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-300 border border-slate-700"
              >
                {ds.virtualPin}: {ds.name}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onNavigateToDatastreams}
          className="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer shrink-0 ml-4"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Manage Pins ({datastreams.length})</span>
        </button>
      </div>

      {/* Historical Database Analytics Visualizer */}
      {datastreams.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Historical Database Analytics (PostgreSQL)
              </h3>
            </div>

            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 self-start sm:self-auto">
              <button
                id="chart-tab-live"
                onClick={() => setChartViewMode('live')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  chartViewMode === 'live'
                    ? 'bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Live Stream</span>
              </button>

              <button
                id="chart-tab-history"
                onClick={() => setChartViewMode('history')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  chartViewMode === 'history'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Historical</span>
              </button>

              <button
                id="chart-tab-both"
                onClick={() => setChartViewMode('both')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  chartViewMode === 'both'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Split View</span>
              </button>
            </div>
          </div>

          {(chartViewMode === 'live' || chartViewMode === 'both') && (
            <LiveChart device={device} datastreams={datastreams} />
          )}

          {(chartViewMode === 'history' || chartViewMode === 'both') && (
            <HistoricalChart deviceId={device.id} datastreams={datastreams} />
          )}
        </div>
      )}

      {/* Add Widget Modal */}
      <AddWidgetModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        datastreams={datastreams}
        onAddWidget={handleAddWidget}
      />
    </div>
  );
};
