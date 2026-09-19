// Frontend TypeScript Interfaces for ESP32 IoT Monitor

export type DataType = 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'STRING';

export interface User {
  id: string;
  email: string;
  createdAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  deviceCount?: number;
  createdAt: string;
}

export interface Device {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  deviceIdentifier: string;
  lastSeen: string | null;
  status: 'ONLINE' | 'OFFLINE';
  secondsSinceLastSeen?: number | null;
  datastreamCount?: number;
  createdAt: string;
}

export interface Datastream {
  id: string;
  deviceId: string;
  virtualPin: string;
  name: string;
  dataType: DataType;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  currentValue?: string | null;
  numericValue?: number | null;
  lastUpdated?: string | null;
  createdAt?: string;
}

export interface HistoricalPoint {
  timestamp: string;
  value: string;
  numericValue: number | null;
}

export type TimeRange = '1m' | '5m' | '1h' | '6h' | '24h' | '7d';

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
  createdAt?: string;
  updatedAt?: string;
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


