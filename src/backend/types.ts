// Backend Domain Types and Error Enums for ESP32 IoT Monitor

export type DataType = 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'STRING';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  projectId: string;
  name: string;
  deviceIdentifier: string;
  tokenHash: string;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Datastream {
  id: string;
  deviceId: string;
  virtualPin: string; // e.g. "V0", "V1"
  name: string;
  dataType: DataType;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SensorData {
  id: string;
  deviceId: string;
  datastreamId: string;
  value: string;
  numericValue: number | null;
  timestamp: string;
}

export type WidgetType = 'VALUE_CARD' | 'GAUGE' | 'LIVE_CHART' | 'SWITCH';

export interface Widget {
  id: string;
  deviceId: string;
  datastreamId: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  datastream?: {
    id: string;
    virtualPin: string;
    name: string;
    dataType: DataType;
    unit: string | null;
    minValue: number | null;
    maxValue: number | null;
  };
}

export interface WidgetInput {
  id?: string;
  datastreamId: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

export interface DeviceStatusInfo {
  id: string;
  name: string;
  deviceIdentifier: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeen: string | null;
  secondsSinceLastSeen: number | null;
}

export interface IngestDataPayload {
  deviceToken: string;
  data: Record<string, unknown>; // e.g. { "V0": 67, "V1": 29.5 }
}

export interface HeartbeatPayload {
  deviceToken: string;
}

export type RuleOperator = '>' | '<' | '==' | '!=' | '>=' | '<=';

export interface AutomationRule {
  id: string;
  deviceId: string;
  name: string;
  conditionDatastreamId: string;
  operator: RuleOperator;
  conditionValue: number;
  actionDatastreamId: string;
  actionValue: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  conditionDatastream?: {
    id: string;
    virtualPin: string;
    name: string;
    unit: string | null;
  };
  actionDatastream?: {
    id: string;
    virtualPin: string;
    name: string;
  };
}

export interface AutomationRuleInput {
  name: string;
  conditionDatastreamId: string;
  operator: RuleOperator;
  conditionValue: number;
  actionDatastreamId: string;
  actionValue: string;
  isActive?: boolean;
}

export type NotificationType = 'OFFLINE' | 'AUTOMATION_TRIGGERED' | 'SYSTEM';

export interface Notification {
  id: string;
  deviceId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: string;
  device?: {
    id: string;
    name: string;
    deviceIdentifier: string;
  };
}

export enum ErrorCode {
  INVALID_DEVICE_TOKEN = 'INVALID_DEVICE_TOKEN',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  UNKNOWN_VIRTUAL_PIN = 'UNKNOWN_VIRTUAL_PIN',
  INVALID_DATA_TYPE = 'INVALID_DATA_TYPE',
  VALUE_OUT_OF_RANGE = 'VALUE_OUT_OF_RANGE',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DATABASE_ERROR = 'DATABASE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
}
