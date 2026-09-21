import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { api } from './services/api.ts';
import { Sidebar, type TabType } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { DeviceSimulatorModal } from './components/DeviceSimulatorModal.tsx';

// Pages
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProjectsPage } from './pages/ProjectsPage.tsx';
import { DevicesPage } from './pages/DevicesPage.tsx';
import { DatastreamsPage } from './pages/DatastreamsPage.tsx';
import { AutomationsPage } from './pages/AutomationsPage.tsx';
import { DataHistoryPage } from './pages/DataHistoryPage.tsx';
import { SimulatorPage } from './pages/SimulatorPage.tsx';
import { ApiDocsPage } from './pages/ApiDocsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { RegisterPage } from './pages/RegisterPage.tsx';

import type { Project, Device, Datastream } from './types/index.ts';

const AppContent: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  // App state
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [datastreams, setDatastreams] = useState<Datastream[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const [isSimulatorModalOpen, setIsSimulatorModalOpen] = useState<boolean>(false);

  // Fetch projects and devices
  const loadProjectsAndDevices = useCallback(async () => {
    if (!user) return;
    try {
      const [projRes, devRes] = await Promise.all([
        api.getProjects(),
        api.getDevices(),
      ]);

      if (projRes.success) setProjects(projRes.projects);
      if (devRes.success) {
        setDevices(devRes.devices);
        if (devRes.devices.length > 0) {
          setSelectedDevice((prev) => {
            if (!prev) return devRes.devices[0];
            const updated = devRes.devices.find((d) => d.id === prev.id);
            return updated || devRes.devices[0];
          });
        } else {
          setSelectedDevice(null);
        }
      }
    } catch (err) {
      console.error('Error loading initial projects/devices:', err);
    }
  }, [user]);

  // Fetch live telemetry & datastreams for selected device
  const fetchSelectedDeviceData = useCallback(async () => {
    if (!selectedDevice) return;
    try {
      const res = await api.getDeviceLiveData(selectedDevice.id);
      if (res.success) {
        setDatastreams(res.datastreams);
        setSelectedDevice((prev) => (prev ? { ...prev, ...res.device } : res.device));
      }
    } catch (err) {
      console.error('Error polling device telemetry:', err);
    }
  }, [selectedDevice?.id]);

  // Initial load
  useEffect(() => {
    if (user) {
      loadProjectsAndDevices();
    }
  }, [user, loadProjectsAndDevices]);

  // Phase 4: Room management & telemetry subscription
  const { subscribe, subscribeStateUpdate, subscribeDevice, unsubscribeDevice } = useWebSocket();

  // Explicit device selector with immediate cleanup
  const handleSelectDevice = useCallback((dev: Device) => {
    setSelectedDevice((prev) => {
      if (prev?.id && prev.id !== dev.id) {
        unsubscribeDevice(prev.id);
      }
      return dev;
    });
    // Immediately clear previous datastreams memory to prevent cross-talk
    setDatastreams([]);
    subscribeDevice(dev.id);
  }, [unsubscribeDevice, subscribeDevice]);

  // When selectedDevice changes, load its data immediately and subscribe to its room
  useEffect(() => {
    if (selectedDevice?.id) {
      subscribeDevice(selectedDevice.id);
      fetchSelectedDeviceData();
      return () => {
        unsubscribeDevice(selectedDevice.id);
      };
    } else {
      setDatastreams([]);
    }
  }, [selectedDevice?.id, fetchSelectedDeviceData, subscribeDevice, unsubscribeDevice]);

  useEffect(() => {
    if (!user) return;

    const unsubscribeSensor = subscribe((payload) => {
      // 1. If payload matches currently viewed device, update datastreams and device status immediately
      if (selectedDevice && payload.deviceId === selectedDevice.deviceIdentifier) {
        setSelectedDevice((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: 'ONLINE',
            lastSeen: payload.timestamp,
            secondsSinceLastSeen: 0,
          };
        });

        if (payload.data) {
          setDatastreams((prevStreams) =>
            prevStreams.map((stream) => {
              if (payload.data[stream.virtualPin] !== undefined) {
                const rawVal = payload.data[stream.virtualPin];
                const strVal = String(rawVal);
                const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(strVal);
                return {
                  ...stream,
                  currentValue: strVal,
                  numericValue: isNaN(numVal) ? null : numVal,
                  lastUpdated: payload.timestamp,
                  lastUpdatedAt: payload.timestamp,
                };
              }
              return stream;
            })
          );
        }
      }

      // 2. Also keep device status updated in the global devices list
      setDevices((prevDevices) =>
        prevDevices.map((d) => {
          if (d.deviceIdentifier === payload.deviceId) {
            return {
              ...d,
              status: 'ONLINE',
              lastSeen: payload.timestamp,
              secondsSinceLastSeen: 0,
            };
          }
          return d;
        })
      );
    });

    const unsubscribeState = subscribeStateUpdate((payload) => {
      if (
        selectedDevice &&
        (payload.deviceId === selectedDevice.id || payload.deviceIdentifier === selectedDevice.deviceIdentifier)
      ) {
        setDatastreams((prevStreams) =>
          prevStreams.map((stream) => {
            if (stream.virtualPin.toUpperCase() === payload.virtualPin.toUpperCase()) {
              const strVal = String(payload.value);
              const isBool = typeof payload.value === 'boolean';
              const numVal = isBool
                ? payload.value
                  ? 1
                  : 0
                : typeof payload.value === 'number'
                ? payload.value
                : parseFloat(strVal);
              return {
                ...stream,
                currentValue: strVal,
                numericValue: isNaN(numVal) ? null : numVal,
                lastUpdated: payload.timestamp,
                lastUpdatedAt: payload.timestamp,
              };
            }
            return stream;
          })
        );
      }
    });

    return () => {
      unsubscribeSensor();
      unsubscribeState();
    };
  }, [user, selectedDevice?.id, selectedDevice?.deviceIdentifier, subscribe, subscribeStateUpdate]);


  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadProjectsAndDevices(), fetchSelectedDeviceData()]);
    setIsRefreshing(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3"></div>
        <span className="text-xs font-mono">Initializing ESP32 IoT Monitor...</span>
      </div>
    );
  }

  // Not authenticated view
  if (!user) {
    if (authView === 'register') {
      return <RegisterPage onSwitchToLogin={() => setAuthView('login')} />;
    }
    return <LoginPage onSwitchToRegister={() => setAuthView('register')} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        projects={projects}
        devices={devices}
        selectedDevice={selectedDevice}
        onSelectDevice={handleSelectDevice}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main App Canvas */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Sticky Header */}
        <Header
          devices={devices}
          selectedDevice={selectedDevice}
          onSelectDevice={handleSelectDevice}
          onRefresh={handleManualRefresh}
          isRefreshing={isRefreshing}
          onOpenSimulator={() => setIsSimulatorModalOpen(true)}
          onToggleMobileMenu={() => setIsMobileOpen((prev) => !prev)}
        />

        {/* Tab Page Views */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {currentTab === 'dashboard' && (
            <DashboardPage
              device={selectedDevice}
              datastreams={datastreams}
              onOpenSimulator={() => setIsSimulatorModalOpen(true)}
              onNavigateToDevices={() => setCurrentTab('devices')}
              onNavigateToDatastreams={() => setCurrentTab('datastreams')}
            />
          )}

          {currentTab === 'projects' && (
            <ProjectsPage
              projects={projects}
              onRefresh={loadProjectsAndDevices}
              onSelectProject={(_projId) => setCurrentTab('devices')}
            />
          )}

          {currentTab === 'devices' && (
            <DevicesPage
              devices={devices}
              projects={projects}
              onRefresh={loadProjectsAndDevices}
              onSelectDeviceForDashboard={(dev) => {
                handleSelectDevice(dev);
                setCurrentTab('dashboard');
              }}
              onManageDatastreams={(dev) => {
                handleSelectDevice(dev);
                setCurrentTab('datastreams');
              }}
            />
          )}

          {currentTab === 'datastreams' && (
            <DatastreamsPage
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={handleSelectDevice}
              onRefresh={handleManualRefresh}
            />
          )}

          {currentTab === 'automations' && (
            <AutomationsPage
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={handleSelectDevice}
              datastreams={datastreams}
            />
          )}

          {currentTab === 'history' && (
            <DataHistoryPage
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={handleSelectDevice}
              datastreams={datastreams}
            />
          )}

          {currentTab === 'simulator' && (
            <SimulatorPage
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={handleSelectDevice}
              datastreams={datastreams}
              onDataSent={handleManualRefresh}
            />
          )}

          {currentTab === 'api-docs' && <ApiDocsPage />}

          {currentTab === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* Interactive Simulator Modal */}
      {isSimulatorModalOpen && selectedDevice && (
        <DeviceSimulatorModal
          device={selectedDevice}
          datastreams={datastreams}
          onClose={() => setIsSimulatorModalOpen(false)}
          onDataSent={handleManualRefresh}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
