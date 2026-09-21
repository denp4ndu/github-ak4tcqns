import React, { useState, useEffect, useRef } from 'react';
import { Power, Loader2, AlertCircle, CheckCircle2, WifiOff, Clock } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket.ts';
import type { Device, Datastream } from '../../types/index.ts';

interface ActuatorToggleWidgetProps {
  device: Device;
  datastream: Datastream;
  isDeviceOffline?: boolean;
  onStateConfirmed?: (virtualPin: string, newValue: boolean) => void;
}

export const ActuatorToggleWidget: React.FC<ActuatorToggleWidgetProps> = ({
  device,
  datastream,
  isDeviceOffline = false,
  onStateConfirmed,
}) => {
  const { sendCommand, subscribeStateUpdate } = useWebSocket();

  // Determine physical state from datastream (PostgreSQL source of truth)
  const parseCurrentBool = (val: any): boolean => {
    if (val === null || val === undefined) return false;
    if (typeof val === 'boolean') return val;
    const str = String(val).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'on' || val === 1;
  };

  const hasData = datastream.currentValue !== null && datastream.currentValue !== undefined;
  const initialValue = parseCurrentBool(datastream.currentValue);

  // Closed-loop local states
  const [confirmedValue, setConfirmedValue] = useState<boolean>(initialValue);
  const [isPending, setIsPending] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize when parent datastream currentValue updates from DB or external events
  useEffect(() => {
    if (!isPending) {
      setConfirmedValue(parseCurrentBool(datastream.currentValue));
    }
  }, [datastream.currentValue, isPending]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // Listen for closed-loop 'state_updated' events from ESP32 ACK
  useEffect(() => {
    const unsubscribe = subscribeStateUpdate((payload) => {
      const matchDevice =
        payload.deviceId === device.id || payload.deviceIdentifier === device.deviceIdentifier;
      const matchPin = payload.virtualPin.toUpperCase() === datastream.virtualPin.toUpperCase();

      if (matchDevice && matchPin) {
        console.log(`[WIDGET-ACK] Received state_updated for ${payload.virtualPin}:`, payload);

        // Cancel the 5-second timeout immediately
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }

        setIsPending(false);

        if (payload.status === 'SUCCESS') {
          const nextVal = parseCurrentBool(payload.value);
          setConfirmedValue(nextVal);
          setErrorNotice(null);
          setSuccessNotice(`ESP32 Confirmed: ${datastream.virtualPin} is now ${nextVal ? 'ON' : 'OFF'}`);

          onStateConfirmed?.(datastream.virtualPin, nextVal);

          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = setTimeout(() => {
            setSuccessNotice(null);
          }, 3500);
        } else if (payload.status === 'TIMEOUT') {
          setErrorNotice('Device Timeout / Unreachable — ESP32 did not acknowledge within 5s');
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = setTimeout(() => {
            setErrorNotice(null);
          }, 5000);
        } else {
          setErrorNotice('ESP32 reported hardware execution failure.');
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = setTimeout(() => {
            setErrorNotice(null);
          }, 5000);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [device.id, device.deviceIdentifier, datastream.virtualPin, subscribeStateUpdate, onStateConfirmed]);

  // Handle Toggle Switch Click (Step 1 -> 5)
  const handleToggleClick = async () => {
    if (isPending) return;

    if (isDeviceOffline) {
      setErrorNotice('Device is OFFLINE. Commands cannot be transmitted.');
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => {
        setErrorNotice(null);
      }, 5000);
      return;
    }

    const targetValue = !confirmedValue;
    setErrorNotice(null);
    setSuccessNotice(null);

    // 1. Enter Loading state immediately
    setIsPending(true);

    // 2. Start 5-Second Timeout Timer (Requirement #4 & Test #6)
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      console.warn(`[TIMEOUT] 5s timeout reached for ${datastream.virtualPin} on device ${device.deviceIdentifier}`);
      setIsPending(false);
      // Revert switch position to initial unconfirmed state
      setErrorNotice('Device Timeout / Unreachable — ESP32 did not acknowledge within 5s');

      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => {
        setErrorNotice(null);
      }, 6000);
    }, 5000);

    // 3. Emit 'send_command' via WebSocket
    try {
      const res = await sendCommand(device.id, datastream.virtualPin, targetValue);
      if (!res.success) {
        console.warn('[WIDGET-CMD] sendCommand failed immediately:', res.message);
      }
    } catch (err: any) {
      console.error('[WIDGET-CMD] Error dispatching send_command:', err);
    }
  };

  return (
    <div
      id={`actuator-widget-${datastream.virtualPin.toLowerCase()}`}
      className={`relative bg-slate-900/80 border rounded-2xl p-5 shadow-sm transition-all duration-300 flex flex-col justify-between ${
        confirmedValue
          ? 'border-emerald-500/30 bg-emerald-950/10 shadow-[0_4px_24px_rgba(16,185,129,0.06)]'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header Info */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">
                {datastream.virtualPin}
              </span>
              <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
                OUTPUT / RELAY
              </span>
            </div>
            <h3 className="text-base font-semibold text-slate-100 mt-1.5 line-clamp-1">
              {datastream.name}
            </h3>
            {datastream.description && (
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{datastream.description}</p>
            )}
          </div>

          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              confirmedValue
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800/80 text-slate-400 border border-slate-700/60'
            }`}
          >
            <Power className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Main Control & Physical State Display */}
      <div className="my-6">
        <div className="flex items-center justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
          {/* Status Label */}
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              Physical State
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  confirmedValue
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                    : 'bg-slate-600'
                }`}
              />
              <span
                className={`text-lg font-black font-mono tracking-wider ${
                  confirmedValue ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {hasData ? (confirmedValue ? 'ON / ACTIVE' : 'OFF / IDLE') : 'NO DATA'}
              </span>
            </div>
          </div>

          {/* Interactive Toggle Switch Button */}
          <button
            id={`toggle-btn-${datastream.virtualPin.toLowerCase()}`}
            type="button"
            disabled={isPending}
            onClick={handleToggleClick}
            title={
              isDeviceOffline
                ? 'Device is OFFLINE. Toggle will attempt to send and timeout in 5s.'
                : `Click to switch ${confirmedValue ? 'OFF' : 'ON'}`
            }
            className={`relative inline-flex h-9 w-16 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900 ${
              confirmedValue ? 'bg-emerald-500' : 'bg-slate-700'
            } ${isPending ? 'opacity-70 cursor-wait' : ''}`}
          >
            <span className="sr-only">Toggle actuator</span>
            <span
              className={`pointer-events-none flex items-center justify-center h-8 w-8 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                confirmedValue ? 'translate-x-7' : 'translate-x-0'
              }`}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 text-slate-800 animate-spin" />
              ) : (
                <Power
                  className={`w-3.5 h-3.5 ${confirmedValue ? 'text-emerald-600' : 'text-slate-400'}`}
                />
              )}
            </span>
          </button>
        </div>

        {/* Closed-Loop Transmitting Status */}
        {isPending && (
          <div className="mt-2.5 flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Transmitting to ESP32 & awaiting hardware ACK...</span>
          </div>
        )}

        {/* Success Notice */}
        {successNotice && !isPending && (
          <div className="mt-2.5 flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-medium">{successNotice}</span>
          </div>
        )}

        {/* Timeout / Error Notice (Requirement #4) */}
        {errorNotice && !isPending && (
          <div
            id={`error-toast-${datastream.virtualPin.toLowerCase()}`}
            className="mt-2.5 flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-1.5"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <span className="font-medium">{errorNotice}</span>
          </div>
        )}
      </div>

      {/* Footer Meta */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          <span>
            {datastream.lastUpdated
              ? `Updated ${new Date(datastream.lastUpdated).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}`
              : hasData
              ? 'Synchronized'
              : 'Awaiting first ACK'}
          </span>
        </div>

        {isDeviceOffline && (
          <span className="text-amber-400/80 flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            <span>Offline</span>
          </span>
        )}
      </div>
    </div>
  );
};
