import React, { useState } from 'react';
import { X, Plus, Activity, Gauge, BarChart2, ToggleLeft } from 'lucide-react';
import type { Datastream, WidgetType, WidgetInput } from '../../types/index.ts';

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  datastreams: Datastream[];
  onAddWidget: (widget: WidgetInput) => void;
}

const WIDGET_TYPE_INFO: Record<
  WidgetType,
  {
    title: string;
    description: string;
    icon: React.FC<{ className?: string }>;
    defaultW: number;
    defaultH: number;
    recommendedDataTypes: string[];
  }
> = {
  VALUE_CARD: {
    title: 'Value Card',
    description: 'Displays current sensor reading with unit, data type, and min/max range.',
    icon: Activity,
    defaultW: 3,
    defaultH: 2,
    recommendedDataTypes: ['INTEGER', 'FLOAT', 'STRING', 'BOOLEAN'],
  },
  GAUGE: {
    title: 'Radial Gauge',
    description: 'Circular dial gauge showing percentage (0-100%) or numeric scale with dynamic color.',
    icon: Gauge,
    defaultW: 3,
    defaultH: 2,
    recommendedDataTypes: ['INTEGER', 'FLOAT'],
  },
  LIVE_CHART: {
    title: 'Live Waveform Chart',
    description: 'Real-time scrolling line graph streaming live sensor points via WebSocket.',
    icon: BarChart2,
    defaultW: 6,
    defaultH: 3,
    recommendedDataTypes: ['INTEGER', 'FLOAT'],
  },
  SWITCH: {
    title: 'Switch / Relay',
    description: 'Two-way interactive toggle button to command physical ESP32 relays with ACK validation.',
    icon: ToggleLeft,
    defaultW: 4,
    defaultH: 2,
    recommendedDataTypes: ['BOOLEAN', 'INTEGER'],
  },
};

export const AddWidgetModal: React.FC<AddWidgetModalProps> = ({
  isOpen,
  onClose,
  datastreams,
  onAddWidget,
}) => {
  const [selectedType, setSelectedType] = useState<WidgetType>('VALUE_CARD');
  const [selectedDatastreamId, setSelectedDatastreamId] = useState<string>(() => {
    return datastreams[0]?.id || '';
  });
  const [customTitle, setCustomTitle] = useState<string>('');

  if (!isOpen) return null;

  const currentTypeInfo = WIDGET_TYPE_INFO[selectedType];
  const selectedDatastream = datastreams.find((d) => d.id === selectedDatastreamId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDatastreamId) return;

    const titleToUse =
      customTitle.trim() ||
      (selectedDatastream ? `${selectedDatastream.name}` : currentTypeInfo.title);

    onAddWidget({
      datastreamId: selectedDatastreamId,
      type: selectedType,
      x: 0,
      y: Infinity, // Places it at the bottom of the grid automatically
      w: currentTypeInfo.defaultW,
      h: currentTypeInfo.defaultH,
      title: titleToUse,
    });

    onClose();
    // Reset form
    setCustomTitle('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        id="add-widget-modal"
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Add Widget to Dashboard</h3>
              <p className="text-xs text-slate-400">Select widget type and bind to an ESP32 datastream</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Step 1: Select Widget Type */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              1. Select Widget Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(WIDGET_TYPE_INFO) as WidgetType[]).map((typeKey) => {
                const info = WIDGET_TYPE_INFO[typeKey];
                const Icon = info.icon;
                const isSelected = selectedType === typeKey;

                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => {
                      setSelectedType(typeKey);
                      // Auto pick matching datastream if available
                      if (typeKey === 'SWITCH') {
                        const boolDs = datastreams.find((d) => d.dataType === 'BOOLEAN');
                        if (boolDs) setSelectedDatastreamId(boolDs.id);
                      } else if (typeKey === 'GAUGE' || typeKey === 'LIVE_CHART') {
                        const numDs = datastreams.find(
                          (d) => d.dataType === 'INTEGER' || d.dataType === 'FLOAT'
                        );
                        if (numDs) setSelectedDatastreamId(numDs.id);
                      }
                    }}
                    className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/10 border-sky-500 text-sky-300 shadow-md shadow-sky-500/10'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          isSelected
                            ? 'bg-sky-500/20 text-sky-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold">{info.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {info.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Bind to Datastream */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              2. Bind to Hardware Datastream
            </label>
            {datastreams.length === 0 ? (
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs">
                No datastreams found on this device. Please create datastreams first.
              </div>
            ) : (
              <select
                id="widget-select-datastream"
                value={selectedDatastreamId}
                onChange={(e) => setSelectedDatastreamId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-sky-500 transition-colors"
                required
              >
                {datastreams.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    [{ds.virtualPin}] {ds.name} &mdash; Type: {ds.dataType}
                    {ds.unit ? ` (${ds.unit})` : ''}
                  </option>
                ))}
              </select>
            )}
            {selectedDatastream && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                <span>Selected Pin: <strong className="text-sky-400 font-mono">{selectedDatastream.virtualPin}</strong></span>
                <span>&bull;</span>
                <span>Type: <strong className="text-slate-300">{selectedDatastream.dataType}</strong></span>
                {selectedDatastream.unit && (
                  <>
                    <span>&bull;</span>
                    <span>Unit: <strong className="text-slate-300">{selectedDatastream.unit}</strong></span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Custom Title (Optional) */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              3. Widget Display Title (Optional)
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={selectedDatastream ? selectedDatastream.name : 'e.g., Living Room Temp'}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Footer Controls */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedDatastreamId}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Widget</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
