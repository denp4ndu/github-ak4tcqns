import React from 'react';
import { ToggleLeft, Power, AlertCircle } from 'lucide-react';
import type { Datastream } from '../../types/index.ts';

interface StatusWidgetProps {
  datastream: Datastream;
}

export const StatusWidget: React.FC<StatusWidgetProps> = ({ datastream }) => {
  const hasData = datastream.currentValue !== null && datastream.currentValue !== undefined;
  const isTrue = hasData && (
    datastream.currentValue === 'true' ||
    datastream.currentValue === '1' ||
    datastream.currentValue?.toUpperCase() === 'ON' ||
    datastream.numericValue === 1
  );

  return (
    <div
      id={`status-widget-${datastream.virtualPin.toLowerCase()}`}
      className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition-colors flex flex-col justify-between"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded">
              {datastream.virtualPin}
            </span>
            <span className="text-xs text-slate-400 font-medium uppercase">ACTUATOR / STATE</span>
          </div>
          <h3 className="text-base font-semibold text-slate-100 mt-1.5 line-clamp-1">
            {datastream.name}
          </h3>
        </div>
        <div className="w-8 h-8 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-400">
          <Power className={`w-4 h-4 ${isTrue ? 'text-emerald-400' : 'text-slate-400'}`} />
        </div>
      </div>

      <div className="my-5 flex items-center justify-center">
        {hasData ? (
          <div className="flex items-center gap-4">
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all duration-300 ${
                isTrue
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                  : 'bg-slate-800 border-slate-700 text-slate-500'
              }`}
            >
              <Power className="w-7 h-7" />
            </div>
            <div>
              <span
                className={`text-2xl font-black font-mono tracking-wider ${
                  isTrue ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {isTrue ? 'ON' : 'OFF'}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                {isTrue ? 'Relay Energized' : 'Relay De-energized'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-3 text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 w-full justify-center">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-xs font-medium">No data received</span>
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500">
        <span>Type: BOOLEAN</span>
        {hasData && datastream.lastUpdated && (
          <span>
            {new Date(datastream.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
};
