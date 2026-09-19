import React from 'react';
import { Menu, RefreshCw, Terminal, Wifi, WifiOff, Clock, Layers, Radio } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import { NotificationBell } from './NotificationBell.tsx';
import type { Device } from '../types/index.ts';

interface HeaderProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenSimulator: () => void;
  onToggleMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  devices,
  selectedDevice,
  onSelectDevice,
  onRefresh,
  isRefreshing,
  onOpenSimulator,
  onToggleMobileMenu,
}) => {
  const isOnline = selectedDevice?.status === 'ONLINE';
  const { status: wsStatus, isConnected: isWsConnected, isReconnecting: isWsReconnecting } = useWebSocket();

  return (
    <header
      id="app-header"
      className="sticky top-0 z-30 h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between px-4 sm:px-8"
    >
      {/* Left: Mobile Toggle & Device Selector */}
      <div className="flex items-center gap-3">
        <button
          id="mobile-menu-toggle-btn"
          onClick={onToggleMobileMenu}
          className="p-2 text-slate-400 hover:text-white rounded-lg lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Device Switcher */}
        {devices.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium hidden sm:inline">Device:</span>
            <select
              id="header-device-select"
              value={selectedDevice?.id || ''}
              onChange={(e) => {
                const found = devices.find((d) => d.id === e.target.value);
                if (found) onSelectDevice(found);
              }}
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-sky-500"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.deviceIdentifier}) — {d.status}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">No devices registered</span>
        )}
      </div>

      {/* Right: Status Indicator & Quick Action Buttons */}
      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* WebSocket Real-time Connection Indicator */}
        <div
          id="header-ws-status-indicator"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border ${
            isWsConnected
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : isWsReconnecting
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}
          title={`WebSocket Status: ${wsStatus}`}
        >
          <span className="relative flex h-2 w-2">
            {isWsConnected ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </>
            ) : isWsReconnecting ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            )}
          </span>
          <span className="hidden sm:inline uppercase">
            {isWsConnected ? 'Connected' : isWsReconnecting ? 'Reconnecting' : 'Disconnected'}
          </span>
        </div>

        {selectedDevice && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border bg-slate-900/60">
            {isOnline ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-semibold font-mono">ONLINE</span>
              </>
            ) : (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
                <span className="text-rose-400 font-semibold font-mono">OFFLINE</span>
              </>
            )}

            {selectedDevice.lastSeen ? (
              <span className="text-slate-400 text-[11px] hidden md:inline border-l border-slate-700/80 pl-2">
                Last seen:{' '}
                {new Date(selectedDevice.lastSeen).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            ) : (
              <span className="text-slate-400 text-[11px] hidden md:inline border-l border-slate-700/80 pl-2 italic">
                Never connected
              </span>
            )}
          </div>
        )}

        {/* Real-time Notification Bell */}
        <NotificationBell />

        {/* Simulator Modal Trigger */}
        <button
          id="header-open-simulator-btn"
          onClick={onOpenSimulator}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold transition-all cursor-pointer shadow-xs"
          title="Open ESP32 Hardware Ingestion Simulator"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">ESP32 Simulator</span>
        </button>

        {/* Manual Refresh Button */}
        <button
          id="header-refresh-btn"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh dashboard data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-400' : ''}`} />
        </button>
      </div>
    </header>
  );
};
