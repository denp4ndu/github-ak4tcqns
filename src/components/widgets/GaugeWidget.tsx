import React from 'react';
import { Gauge, AlertCircle } from 'lucide-react';
import type { Datastream } from '../../types/index.ts';

interface GaugeWidgetProps {
  datastream: Datastream;
}

export const GaugeWidget: React.FC<GaugeWidgetProps> = ({ datastream }) => {
  const hasData = datastream.currentValue !== null && datastream.currentValue !== undefined;
  const numVal = datastream.numericValue ?? (hasData ? parseFloat(datastream.currentValue!) : null);

  const min = datastream.minValue ?? 0;
  const max = datastream.maxValue ?? 100;

  // Calculate percentage for progress arc
  let percentage = 0;
  if (numVal !== null && !isNaN(numVal)) {
    percentage = Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100));
  }

  // Determine color based on percentage
  let strokeColor = '#38bdf8'; // sky blue
  if (percentage < 25) strokeColor = '#f59e0b'; // amber/warning
  else if (percentage >= 25 && percentage <= 75) strokeColor = '#10b981'; // emerald
  else strokeColor = '#06b6d4'; // cyan

  // SVG parameters
  const size = 160;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Use a 270 degree arc (3/4 circle)
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - (arcLength * percentage) / 100;

  return (
    <div
      id={`gauge-widget-${datastream.virtualPin.toLowerCase()}`}
      className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition-colors flex flex-col justify-between items-center text-center"
    >
      <div className="w-full flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
              {datastream.virtualPin}
            </span>
            <span className="text-xs text-slate-400 font-medium">GAUGE</span>
          </div>
          <h3 className="text-base font-semibold text-slate-100 mt-1 text-left line-clamp-1">
            {datastream.name}
          </h3>
        </div>
        <div className="w-8 h-8 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-400">
          <Gauge className="w-4 h-4 text-emerald-400" />
        </div>
      </div>

      <div className="my-3 relative flex items-center justify-center">
        {hasData && numVal !== null ? (
          <div className="relative flex items-center justify-center">
            <svg width={size} height={size} className="transform -rotate-135">
              {/* Track background */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#1e293b"
                strokeWidth={strokeWidth}
                strokeDasharray={`${arcLength} ${circumference}`}
                strokeLinecap="round"
              />
              {/* Dynamic Fill */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={`${arcLength} ${circumference}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-700 ease-out"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
              <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                {datastream.currentValue}
              </span>
              <span className="text-xs font-semibold text-slate-400">
                {datastream.unit || '%'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                {Math.round(percentage)}% of scale
              </span>
            </div>
          </div>
        ) : (
          <div className="h-36 flex flex-col items-center justify-center gap-2 text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-6 w-full">
            <AlertCircle className="w-6 h-6" />
            <span className="text-sm font-semibold">No data received</span>
            <span className="text-xs text-slate-400 text-center">Waiting for ESP32 to publish {datastream.virtualPin}</span>
          </div>
        )}
      </div>

      <div className="w-full pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500">
        <span>Min: {min}</span>
        <span>Max: {max}</span>
      </div>
    </div>
  );
};
