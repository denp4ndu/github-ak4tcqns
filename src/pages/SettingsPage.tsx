import React from 'react';
import { Settings, Shield, Clock, Database, Radio, CheckCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-sky-400" />
          System Settings & Platform Architecture
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Configuration parameters and operational specifications for Phase 1 ESP32 IoT Monitor
        </p>
      </div>

      {/* Connection & Timeout Policy */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Device Status Timeout Policy</h3>
            <p className="text-xs text-slate-400">Specification Rule #13: Realtime Status & Keep-Alive</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">ONLINE Threshold</span>
            <span className="text-lg font-bold font-mono text-emerald-400">&le; 30 seconds</span>
            <p className="text-[11px] text-slate-500 mt-1">
              If lastSeen timestamp is within 30 seconds of server time, device is marked ONLINE.
            </p>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">OFFLINE Threshold</span>
            <span className="text-lg font-bold font-mono text-rose-400">&gt; 30 seconds</span>
            <p className="text-[11px] text-slate-500 mt-1">
              If no transmission or heartbeat is received after 30s, device status switches to OFFLINE.
            </p>
          </div>
        </div>
      </div>

      {/* Security Architecture */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Cryptographic Security Implementation</h3>
            <p className="text-xs text-slate-400">Specification Rules #26, #27, #28</p>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300">
              <strong>Device Token Hashing:</strong> Raw tokens are high-entropy (48 hex chars) and only stored in the database as SHA-256 hashes.
            </span>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300">
              <strong>User Authentication:</strong> Passwords hashed with bcrypt (salt rounds = 10).
            </span>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300">
              <strong>Session Management:</strong> Signed JWT tokens with 7-day expiration and Bearer verification.
            </span>
          </div>
        </div>
      </div>

      {/* Platform Information */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Phase 1 Architecture Status</h3>
            <p className="text-xs text-slate-400">Strict Monitoring-Only Scope (Rule #38)</p>
          </div>
        </div>

        <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1">
          <div>Architecture: <span className="text-sky-400">ESP32 &rarr; Internet &rarr; Backend REST API &rarr; Database &rarr; Web Dashboard</span></div>
          <div>Virtual Pin Decoupling: <span className="text-emerald-400">Active (Virtual Pin &ne; Physical GPIO)</span></div>
          <div>Database Persistence: <span className="text-emerald-400">Active (Relational Table Model)</span></div>
          <div>Target Phase: <span className="text-amber-400 font-bold">PHASE 1 (Monitoring Only)</span></div>
        </div>
      </div>
    </div>
  );
};
