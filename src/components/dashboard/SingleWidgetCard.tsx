import React from 'react';
import { GripVertical, Trash2, Activity, Gauge, BarChart2, ToggleLeft, AlertCircle } from 'lucide-react';
import { ValueCard } from '../widgets/ValueCard.tsx';
import { GaugeWidget } from '../widgets/GaugeWidget.tsx';
import { ActuatorToggleWidget } from '../widgets/ActuatorToggleWidget.tsx';
import { LiveChart } from '../widgets/LiveChart.tsx';
import type { Device, Datastream, Widget } from '../../types/index.ts';

interface SingleWidgetCardProps {
  widget: Widget;
  device: Device;
  datastream: Datastream | undefined;
  allDatastreams: Datastream[];
  isEditMode: boolean;
  isDeviceOffline: boolean;
  onDelete: (widgetId: string) => void;
}

const TYPE_ICONS = {
  VALUE_CARD: Activity,
  GAUGE: Gauge,
  LIVE_CHART: BarChart2,
  SWITCH: ToggleLeft,
};

export const SingleWidgetCard: React.FC<SingleWidgetCardProps> = ({
  widget,
  device,
  datastream,
  allDatastreams,
  isEditMode,
  isDeviceOffline,
  onDelete,
}) => {
  const Icon = TYPE_ICONS[widget.type] || Activity;

  // Fallback datastream if datastream was deleted from DB
  const effectiveDatastream: Datastream = datastream || {
    id: widget.datastreamId,
    deviceId: device.id,
    virtualPin: widget.datastream?.virtualPin || 'V?',
    name: widget.datastream?.name || widget.title,
    dataType: widget.datastream?.dataType || 'STRING',
    unit: widget.datastream?.unit || null,
    minValue: widget.datastream?.minValue || null,
    maxValue: widget.datastream?.maxValue || null,
    description: null,
    currentValue: null,
  };

  return (
    <div
      className={`h-full w-full rounded-2xl flex flex-col transition-all overflow-hidden ${
        isEditMode
          ? 'bg-slate-900 border-2 border-sky-500/60 shadow-lg shadow-sky-500/5'
          : 'bg-transparent'
      }`}
    >
      {/* Edit Mode Header Toolbar & Drag Handle */}
      {isEditMode && (
        <div className="widget-drag-handle px-3 py-2 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between cursor-move select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GripVertical className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-xs font-bold text-white truncate">{widget.title}</span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded">
                {effectiveDatastream.virtualPin}
              </span>
              <span className="text-[10px] font-medium text-slate-400 uppercase hidden sm:inline">
                {widget.type}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(widget.id);
            }}
            title="Delete widget"
            className="p-1 rounded-lg text-rose-400 hover:text-white hover:bg-rose-500/80 transition-colors cursor-pointer shrink-0 ml-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Widget Content Body */}
      <div className={`flex-1 relative min-h-0 overflow-hidden ${isEditMode ? 'p-2' : ''}`}>
        {/* Render child component based on type */}
        {widget.type === 'VALUE_CARD' && (
          <div className="h-full flex flex-col justify-stretch">
            <ValueCard datastream={effectiveDatastream} isDeviceOffline={isDeviceOffline} />
          </div>
        )}

        {widget.type === 'GAUGE' && (
          <div className="h-full flex flex-col justify-stretch">
            <GaugeWidget datastream={effectiveDatastream} />
          </div>
        )}

        {widget.type === 'SWITCH' && (
          <div className="h-full flex flex-col justify-stretch">
            <ActuatorToggleWidget
              device={device}
              datastream={effectiveDatastream}
              isDeviceOffline={isDeviceOffline}
            />
          </div>
        )}

        {widget.type === 'LIVE_CHART' && (
          <div className="h-full flex flex-col justify-stretch overflow-hidden">
            <LiveChart
              device={device}
              datastreams={
                effectiveDatastream ? [effectiveDatastream, ...allDatastreams.filter((d) => d.id !== effectiveDatastream.id)] : allDatastreams
              }
            />
          </div>
        )}

        {/* In edit mode, render a transparent click blocker so controls like switches aren't triggered accidentally */}
        {isEditMode && widget.type === 'SWITCH' && (
          <div
            className="absolute inset-0 bg-transparent cursor-move"
            title="Drag to reposition (Switch interaction paused in edit mode)"
          />
        )}
      </div>
    </div>
  );
};
