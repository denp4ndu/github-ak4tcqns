import React, { useState } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Cpu,
  Layers,
  Zap,
  BarChart3,
  FileCode2,
  Terminal,
  LogOut,
  Radio,
  Settings,
  ChevronDown,
  ChevronRight,
  Folder,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Project, Device } from '../types/index.ts';

export type TabType =
  | 'dashboard'
  | 'projects'
  | 'devices'
  | 'datastreams'
  | 'automations'
  | 'history'
  | 'simulator'
  | 'api-docs'
  | 'settings';

interface SidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  projects?: Project[];
  devices?: Device[];
  selectedDevice?: Device | null;
  onSelectDevice?: (device: Device) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  projects = [],
  devices = [],
  selectedDevice = null,
  onSelectDevice,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { logout, user } = useAuth();
  // Expanded project IDs state
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    // Expand all projects by default
    const init: Record<string, boolean> = {};
    projects.forEach((p) => {
      init[p.id] = true;
    });
    return init;
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const navItems: { id: TabType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'devices', label: 'Devices', icon: Cpu },
    { id: 'datastreams', label: 'Datastreams', icon: Layers },
    { id: 'automations', label: 'Automations (Rules)', icon: Zap },
    { id: 'history', label: 'Historical Data', icon: BarChart3 },
    { id: 'simulator', label: 'ESP32 Simulator', icon: Terminal },
    { id: 'api-docs', label: 'API Documentation', icon: FileCode2 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleNavClick = (tab: TabType) => {
    onSelectTab(tab);
    onCloseMobile?.();
  };

  const handleDeviceClick = (device: Device) => {
    if (onSelectDevice) {
      onSelectDevice(device);
    }
    onSelectTab('dashboard');
    onCloseMobile?.();
  };

  // Group devices by project
  const devicesByProject = React.useMemo(() => {
    const map = new Map<string, Device[]>();
    projects.forEach((p) => map.set(p.id, []));

    devices.forEach((d) => {
      const list = map.get(d.projectId);
      if (list) {
        list.push(d);
      } else {
        // Device with unknown or deleted project
        if (!map.has('unassigned')) map.set('unassigned', []);
        map.get('unassigned')!.push(d);
      }
    });

    return map;
  }, [projects, devices]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div>
          <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800/80 bg-slate-950/40">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Radio className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
                ESP32 IoT Monitor
                <span className="text-[9px] font-mono px-1 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30 shrink-0">
                  PHASE 5
                </span>
              </h1>
              <p className="text-[10px] text-slate-400 truncate">Rules &bull; Alerts &bull; CSV Export</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors text-left cursor-pointer ${
                    isActive
                      ? 'bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Phase 4: Multi-Project & Device Navigation Hierarchy */}
          <div className="px-3 pt-2 pb-1 border-t border-slate-800/60">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                Projects & Devices ({devices.length})
              </span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {projects.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-slate-500 italic">
                  No projects created yet
                </div>
              ) : (
                projects.map((project) => {
                  const projectDevices = devicesByProject.get(project.id) || [];
                  const isExpanded = expandedProjects[project.id] ?? true;

                  return (
                    <div key={project.id} className="rounded-lg bg-slate-900/40 border border-slate-800/60 overflow-hidden">
                      {/* Project Header Accordion */}
                      <button
                        type="button"
                        onClick={() => toggleProject(project.id)}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-left hover:bg-slate-850 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="font-semibold text-slate-200 truncate text-[11px]">
                            {project.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                          {projectDevices.length}
                        </span>
                      </button>

                      {/* Device List in Project */}
                      {isExpanded && (
                        <div className="px-1.5 py-1 space-y-0.5 bg-slate-950/40 border-t border-slate-800/40">
                          {projectDevices.length === 0 ? (
                            <p className="text-[10px] text-slate-500 italic px-2 py-1">
                              No devices in project
                            </p>
                          ) : (
                            projectDevices.map((dev) => {
                              const isSelected = selectedDevice?.id === dev.id;
                              const isOnline = dev.status === 'ONLINE';

                              return (
                                <button
                                  key={dev.id}
                                  id={`sidebar-device-btn-${dev.id}`}
                                  type="button"
                                  onClick={() => handleDeviceClick(dev)}
                                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-sky-500/15 border border-sky-500/40 text-sky-300 shadow-xs'
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isOnline
                                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                                          : 'bg-slate-600'
                                      }`}
                                    />
                                    <span className="text-[11px] font-medium truncate">
                                      {dev.name}
                                    </span>
                                  </div>
                                  <span className="text-[9px] font-mono text-slate-500 shrink-0">
                                    {dev.deviceIdentifier}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* User Account & Logout */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/60">
          <div className="mb-3 px-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
              Signed in as
            </span>
            <p className="text-xs font-medium text-slate-200 truncate mt-0.5" title={user?.email}>
              {user?.email}
            </p>
          </div>
          <button
            id="sidebar-logout-btn"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};
