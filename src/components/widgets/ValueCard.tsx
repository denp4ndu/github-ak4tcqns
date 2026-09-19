import React from 'react';
import { Activity, Hash, AlertCircle } from 'lucide-react';
import type { Datastream } from '../../types/index.ts';

interface ValueCardProps {
  datastream: Datastream;
  isDeviceOffline?: boolean;
}

export const ValueCard: React.FC<ValueCardProps> = ({ datastream, isDeviceOffline }) => {
  const hasData = datastream.currentValue !== null && datastream.currentValue !== undefined;

  return (
    <div
      id={`value-card-${datastream.virtualPin.toLowerCase()}`}
      className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition-colors flex flex-col justify-between"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded">
              {datastream.virtualPin}
            </span>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {datastream.dataType}
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-100 mt-1.5 line-clamp-1">
            {datastream.name}
          </h3>
        </div>
        <div className="w-8 h-8 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-400">
          <Activity className="w-4 h-4 text-sky-400" />
        </div>
      </div>

      <div className="my-4">
        {hasData ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
              {datastream.currentValue}
            </span>
            {datastream.unit && (
              <span className="text-base font-medium text-slate-400">
                {datastream.unit}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2 text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-xs font-medium">No data received</span>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500">
        <span>
          {datastream.minValue !== null && datastream.maxValue !== null
            ? `Range: ${datastream.minValue} - ${datastream.maxValue}`
            : datastream.description || 'No range limits'}
        </span>
        {hasData && datastream.lastUpdated && (
          <span title={new Date(datastream.lastUpdated).toLocaleString()}>
            {new Date(datastream.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
};
