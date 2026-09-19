// Centralized API client service
import type { Widget, WidgetInput } from '../types/index.ts';

const BASE_URL = '/api';
const STACKBLITZ_PREVIEW = import.meta.env.DEV;

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('esp32_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function getPreviewUser() {
  return {
    id: 'preview-user-001',
    email: 'demo@esp32.io',
  };
}

function getPreviewToken() {
  return 'stackblitz-preview-token';
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.message || data.error || `HTTP error ${response.status}`;
    const err = new Error(message) as any;
    err.status = response.status;
    err.code = data.error;
    throw err;
  }

  return data as T;
}
const previewProject = {
  id: 'preview-project-001',
  name: 'Smart Irrigation',
  description: 'StackBlitz Preview Project',
};

const previewDevice = {
  id: 'preview-device-001',
  projectId: 'preview-project-001',
  projectName: 'Smart Irrigation',
  name: 'ESP32-001',
  deviceIdentifier: 'ESP32-001',
  status: 'ONLINE',
  lastSeen: new Date().toISOString(),
  secondsSinceLastSeen: 0,
};

const previewDatastreams = [
  {
    id: 'preview-ds-v0',
    deviceId: 'preview-device-001',
    virtualPin: 'V0',
    name: 'Temperature',
    dataType: 'FLOAT',
    unit: '°C',
    minValue: 0,
    maxValue: 50,
    currentValue: '28.5',
    numericValue: 28.5,
    lastUpdatedAt: new Date().toISOString(),
  },
  {
    id: 'preview-ds-v1',
    deviceId: 'preview-device-001',
    virtualPin: 'V1',
    name: 'Humidity',
    dataType: 'FLOAT',
    unit: '%',
    minValue: 0,
    maxValue: 100,
    currentValue: '72',
    numericValue: 72,
    lastUpdatedAt: new Date().toISOString(),
  },
  {
    id: 'preview-ds-v2',
    deviceId: 'preview-device-001',
    virtualPin: 'V2',
    name: 'Soil Moisture',
    dataType: 'INTEGER',
    unit: '%',
    minValue: 0,
    maxValue: 100,
    currentValue: '61',
    numericValue: 61,
    lastUpdatedAt: new Date().toISOString(),
  },
  {
    id: 'preview-ds-v3',
    deviceId: 'preview-device-001',
    virtualPin: 'V3',
    name: 'Relay',
    dataType: 'BOOLEAN',
    unit: '',
    minValue: 0,
    maxValue: 1,
    currentValue: 'false',
    numericValue: 0,
    lastUpdatedAt: new Date().toISOString(),
  },
];
const previewHistory: Record<
  string,
  Array<{
    timestamp: string;
    value: string;
    numericValue: number | null;
  }>
> = {};

function addPreviewHistory(virtualPin: string, value: any) {
  const timestamp = new Date().toISOString();

  if (!previewHistory[virtualPin]) {
    previewHistory[virtualPin] = [];
  }

  const stream = previewDatastreams.find(
    (item) => item.virtualPin === virtualPin
  );

  const numericValue =
    stream?.dataType === 'BOOLEAN'
      ? value === true || value === 'true'
        ? 1
        : 0
      : Number(value);

  previewHistory[virtualPin].push({
    timestamp,
    value: String(value),
    numericValue: Number.isFinite(numericValue) ? numericValue : null,
  });

  // Simpan maksimal 100 titik agar preview tidak terus membesar.
  if (previewHistory[virtualPin].length > 100) {
    previewHistory[virtualPin].shift();
  }
}
export const api = {
  // Auth
  register: async (payload: { email: string; password: string }) => {
    if (STACKBLITZ_PREVIEW) {
      return {
        success: true,
        token: getPreviewToken(),
        user: getPreviewUser(),
      };
    }

    return request<{
      success: boolean;
      token: string;
      user: { id: string; email: string };
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login: async (payload: { email: string; password: string }) => {
    if (STACKBLITZ_PREVIEW) {
      const validEmail = 'demo@esp32.io';
      const validPassword = 'esp32demo123';

      if (payload.email !== validEmail || payload.password !== validPassword) {
        throw new Error(
          'Preview login: gunakan tombol "Fill Demo Credentials".'
        );
      }

      return {
        success: true,
        token: getPreviewToken(),
        user: getPreviewUser(),
      };
    }

    return request<{
      success: boolean;
      token: string;
      user: { id: string; email: string };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  logout: async () => {
    if (STACKBLITZ_PREVIEW) {
      return {
        success: true,
      };
    }

    return request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    });
  },

  getMe: async () => {
    if (STACKBLITZ_PREVIEW) {
      const token = localStorage.getItem('esp32_auth_token');

      if (token !== getPreviewToken()) {
        throw new Error('Preview session not found');
      }

      return {
        success: true,
        user: getPreviewUser(),
      };
    }

    return request<{
      success: boolean;
      user: { id: string; email: string };
    }>('/auth/me');
  },
  // Projects
  getProjects: async () => {
    if (STACKBLITZ_PREVIEW) {
      return {
        success: true,
        projects: [previewProject],
      };
    }

    return request<{ success: boolean; projects: any[] }>('/projects');
  },
  createProject: (payload: { name: string; description?: string }) =>
    request<{ success: boolean; project: any }>('/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteProject: (id: string) =>
    request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  seedExampleProject: () =>
    request<{
      success: boolean;
      project: any;
      device: any;
      deviceToken: string;
      datastreams: any[];
    }>('/projects/seed-example', { method: 'POST' }),

  // Devices
  getDevices: async (projectId?: string) => {
    if (STACKBLITZ_PREVIEW) {
      return {
        success: true,
        devices:
          !projectId || projectId === previewProject.id ? [previewDevice] : [],
      };
    }

    return request<{ success: boolean; devices: any[] }>(
      projectId ? `/devices?projectId=${projectId}` : '/devices'
    );
  },
  getDevice: (id: string) =>
    request<{ success: boolean; device: any; datastreams: any[] }>(
      `/devices/${id}`
    ),

  createDevice: (payload: {
    projectId: string;
    name: string;
    deviceIdentifier: string;
  }) =>
    request<{ success: boolean; device: any; deviceToken: string }>(
      '/devices',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteDevice: (id: string) =>
    request<{ success: boolean }>(`/devices/${id}`, { method: 'DELETE' }),

  regenerateDeviceToken: (id: string) =>
    request<{ success: boolean; deviceToken: string; message: string }>(
      `/devices/${id}/regenerate-token`,
      {
        method: 'POST',
      }
    ),

  // Datastreams
  getDatastreams: (deviceId: string) =>
    request<{ success: boolean; datastreams: any[] }>(
      `/devices/${deviceId}/datastreams`
    ),

  createDatastream: (
    deviceId: string,
    payload: {
      virtualPin: string;
      name: string;
      dataType: string;
      unit?: string;
      minValue?: number | null;
      maxValue?: number | null;
      description?: string;
    }
  ) =>
    request<{ success: boolean; datastream: any }>(
      `/devices/${deviceId}/datastreams`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateDatastream: (id: string, payload: any) =>
    request<{ success: boolean; datastream: any }>(`/datastreams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteDatastream: (id: string) =>
    request<{ success: boolean }>(`/datastreams/${id}`, { method: 'DELETE' }),

  // Live Data & History
  getDeviceLiveData: async (deviceId: string) => {
    if (STACKBLITZ_PREVIEW) {
      if (deviceId !== previewDevice.id) {
        throw new Error('Preview device not found');
      }

      const now = new Date().toISOString();

      const streams = previewDatastreams.map((stream) => ({
        ...stream,
        lastUpdatedAt: now,
      }));

      return {
        success: true,
        device: {
          ...previewDevice,
          lastSeen: now,
          secondsSinceLastSeen: 0,
        },
        datastreams: streams,
      };
    }

    return request<{
      success: boolean;
      device: any;
      datastreams: any[];
    }>(`/devices/${deviceId}/data`);
  },
  getDeviceHistory: async (
    deviceId: string,
    virtualPin: string,
    range: string
  ) => {
    if (STACKBLITZ_PREVIEW) {
      if (deviceId !== previewDevice.id) {
        throw new Error('Preview device not found');
      }

      const points = previewHistory[virtualPin] || [];

      return {
        success: true,
        deviceId,
        virtualPin,
        range,
        count: points.length,
        points,
      };
    }

    return request<{
      success: boolean;
      deviceId: string;
      virtualPin: string;
      range: string;
      count: number;
      points: {
        timestamp: string;
        value: string;
        numericValue: number | null;
      }[];
    }>(
      `/devices/${deviceId}/data/history?datastream=${virtualPin}&range=${range}`
    );
  },
  // Direct Ingestion (used for Simulator / Testing)
  ingestDeviceData: async (payload: {
    deviceToken: string;
    data: Record<string, any>;
  }) => {
    if (STACKBLITZ_PREVIEW) {
      if (payload.deviceToken !== 'preview-device-token') {
        throw new Error('Preview simulator: gunakan Device Token preview.');
      }

      const timestamp = new Date().toISOString();

      Object.entries(payload.data).forEach(([virtualPin, value]) => {
        const stream = previewDatastreams.find(
          (item) => item.virtualPin === virtualPin
        );

        if (!stream) return;

        stream.currentValue = String(value);

        if (stream.dataType === 'BOOLEAN') {
          stream.numericValue = value === true || value === 'true' ? 1 : 0;
          stream.currentValue =
            value === true || value === 'true' ? 'true' : 'false';
        } else {
          const numericValue = Number(value);

          stream.numericValue = Number.isFinite(numericValue)
            ? numericValue
            : null;

          stream.currentValue = String(value);
        }

        stream.lastUpdatedAt = timestamp;

        addPreviewHistory(virtualPin, value);
      });

      previewDevice.status = 'ONLINE';
      previewDevice.lastSeen = timestamp;
      previewDevice.secondsSinceLastSeen = 0;

      return {
        success: true,
        message: 'Preview sensor data accepted',
        deviceId: previewDevice.id,
        received: payload.data,
        timestamp,
      };
    }

    return request<{
      success: boolean;
      message: string;
      deviceId: string;
      received: Record<string, any>;
      timestamp: string;
    }>('/device/data', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  sendDeviceHeartbeat: async (deviceToken: string) => {
    if (STACKBLITZ_PREVIEW) {
      if (deviceToken !== 'preview-device-token') {
        throw new Error('Preview simulator: gunakan Device Token preview.');
      }

      const serverTime = new Date().toISOString();

      previewDevice.status = 'ONLINE';
      previewDevice.lastSeen = serverTime;
      previewDevice.secondsSinceLastSeen = 0;

      return {
        success: true,
        status: 'ONLINE',
        deviceId: previewDevice.id,
        serverTime,
      };
    }

    return request<{
      success: boolean;
      status: string;
      deviceId: string;
      serverTime: string;
    }>('/device/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ deviceToken }),
    });
  },

  // Phase 4: Dashboard Layout CRUD
  getDashboardLayout: async (deviceId: string) => {
    if (STACKBLITZ_PREVIEW) {
      return {
        success: true,
        deviceId,
        widgets: [],
      };
    }

    return request<{
      success: boolean;
      deviceId: string;
      widgets: Widget[];
    }>(`/devices/${deviceId}/dashboard/layout`);
  },
  saveDashboardLayout: async (deviceId: string, widgets: WidgetInput[]) => {
    if (STACKBLITZ_PREVIEW) {
      localStorage.setItem(
        `preview_dashboard_layout_${deviceId}`,
        JSON.stringify(widgets)
      );

      return {
        success: true,
        message: 'Preview dashboard layout saved',
        deviceId,
        widgets: widgets as Widget[],
      };
    }

    return request<{
      success: boolean;
      message: string;
      deviceId: string;
      widgets: Widget[];
    }>(`/devices/${deviceId}/dashboard/layout`, {
      method: 'PUT',
      body: JSON.stringify({ widgets }),
    });
  },

  // Phase 5: Automation Rules
  getAutomationRules: (deviceId: string) =>
    request<{ success: boolean; rules: any[] }>(`/devices/${deviceId}/rules`),

  createAutomationRule: (deviceId: string, payload: any) =>
    request<{ success: boolean; message: string; rule: any }>(
      `/devices/${deviceId}/rules`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateAutomationRule: (deviceId: string, ruleId: string, payload: any) =>
    request<{ success: boolean; message: string; rule: any }>(
      `/devices/${deviceId}/rules/${ruleId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteAutomationRule: (deviceId: string, ruleId: string) =>
    request<{ success: boolean; message: string }>(
      `/devices/${deviceId}/rules/${ruleId}`,
      {
        method: 'DELETE',
      }
    ),

  // Phase 5: Notifications
  getNotifications: (limit = 50) =>
    request<{ success: boolean; notifications: any[]; unreadCount: number }>(
      `/notifications?limit=${limit}`
    ),

  markNotificationRead: (id: string) =>
    request<{ success: boolean; message: string }>(
      `/notifications/${id}/read`,
      {
        method: 'PUT',
      }
    ),

  markAllNotificationsRead: () =>
    request<{ success: boolean; message: string }>('/notifications/read-all', {
      method: 'PUT',
    }),

  // Phase 5: CSV Export
  getExportUrl: (
    deviceId: string,
    start?: string,
    end?: string,
    datastreamId?: string
  ) => {
    let url = `/api/devices/${deviceId}/export?`;
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (datastreamId) params.append('datastreamId', datastreamId);
    return url + params.toString();
  },
};
