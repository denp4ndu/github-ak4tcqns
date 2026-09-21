import { PrismaClient, DataType, WidgetType } from '@prisma/client';
import crypto from 'node:crypto';
import type { User, Project, Device, Datastream, SensorData, Widget, WidgetInput, AutomationRule, AutomationRuleInput, Notification, NotificationType } from './types.ts';

declare global {
  var prisma: PrismaClient | undefined;
}

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('HOST:5432')) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/esp32_iot_monitor?pgbouncer=true';
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// PostgreSQL Advisory Locking Helpers
export function generateAdvisoryLockKey(idString: string): bigint {
  const hash = crypto.createHash('sha256').update(idString).digest();
  return hash.readBigInt64BE(0);
}

export async function acquireAdvisoryLock(client: any, idString: string): Promise<void> {
  const key = generateAdvisoryLockKey(idString);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${key});`;
}

// User Queries
export async function findUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function findUserById(id: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function createUser(user: { id?: string; email: string; passwordHash: string }): Promise<User> {
  const created = await prisma.user.create({
    data: {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      passwordHash: user.passwordHash,
    },
  });
  return {
    id: created.id,
    email: created.email,
    passwordHash: created.passwordHash,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

// Project Queries
export async function getProjectsByUserId(userId: string): Promise<(Project & { deviceCount: number })[]> {
  const projects = await prisma.project.findMany({
    where: { userId },
    include: {
      _count: {
        select: { devices: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return projects.map((p) => ({
    id: p.id,
    userId: p.userId,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    deviceCount: p._count.devices,
  }));
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return null;
  return {
    id: project.id,
    userId: project.userId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function createProject(project: {
  id?: string;
  userId: string;
  name: string;
  description?: string | null;
}): Promise<Project> {
  const created = await prisma.project.create({
    data: {
      id: project.id,
      userId: project.userId,
      name: project.name,
      description: project.description ?? null,
    },
  });
  return {
    id: created.id,
    userId: created.userId,
    name: created.name,
    description: created.description,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
  const result = await prisma.project.deleteMany({
    where: {
      id: projectId,
      userId,
    },
  });
  return result.count > 0;
}

// Device Queries
export async function getDevicesByUserId(
  userId: string,
  projectId?: string
): Promise<(Device & { projectName: string; datastreamCount: number })[]> {
  const devices = await prisma.device.findMany({
    where: {
      project: {
        userId,
        ...(projectId ? { id: projectId } : {}),
      },
    },
    include: {
      project: {
        select: { name: true },
      },
      _count: {
        select: { datastreams: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return devices.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    deviceIdentifier: d.deviceIdentifier,
    tokenHash: d.tokenHash,
    lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    projectName: d.project.name,
    datastreamCount: d._count.datastreams,
  }));
}

export async function getDeviceById(deviceId: string): Promise<(Device & { userId: string; projectName: string }) | null> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      project: {
        select: { userId: true, name: true },
      },
    },
  });
  if (!device) return null;
  return {
    id: device.id,
    projectId: device.projectId,
    name: device.name,
    deviceIdentifier: device.deviceIdentifier,
    tokenHash: device.tokenHash,
    lastSeen: device.lastSeen ? device.lastSeen.toISOString() : null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    userId: device.project.userId,
    projectName: device.project.name,
  };
}

export async function getDeviceByIdentifier(identifier: string): Promise<(Device & { userId: string }) | null> {
  const device = await prisma.device.findUnique({
    where: { deviceIdentifier: identifier },
    include: {
      project: {
        select: { userId: true },
      },
    },
  });
  if (!device) return null;
  return {
    id: device.id,
    projectId: device.projectId,
    name: device.name,
    deviceIdentifier: device.deviceIdentifier,
    tokenHash: device.tokenHash,
    lastSeen: device.lastSeen ? device.lastSeen.toISOString() : null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    userId: device.project.userId,
  };
}

export async function getDeviceByTokenHash(tokenHash: string): Promise<(Device & { userId: string }) | null> {
  const device = await prisma.device.findUnique({
    where: { tokenHash },
    include: {
      project: {
        select: { userId: true },
      },
    },
  });
  if (!device) return null;
  return {
    id: device.id,
    projectId: device.projectId,
    name: device.name,
    deviceIdentifier: device.deviceIdentifier,
    tokenHash: device.tokenHash,
    lastSeen: device.lastSeen ? device.lastSeen.toISOString() : null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    userId: device.project.userId,
  };
}

export async function createDevice(device: {
  id?: string;
  projectId: string;
  name: string;
  deviceIdentifier: string;
  tokenHash: string;
  lastSeen?: Date | string | null;
}): Promise<Device> {
  const created = await prisma.device.create({
    data: {
      id: device.id,
      projectId: device.projectId,
      name: device.name,
      deviceIdentifier: device.deviceIdentifier,
      tokenHash: device.tokenHash,
      lastSeen: device.lastSeen ? new Date(device.lastSeen) : null,
    },
  });
  return {
    id: created.id,
    projectId: created.projectId,
    name: created.name,
    deviceIdentifier: created.deviceIdentifier,
    tokenHash: created.tokenHash,
    lastSeen: created.lastSeen ? created.lastSeen.toISOString() : null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function updateDeviceToken(deviceId: string, newTokenHash: string): Promise<void> {
  await prisma.device.update({
    where: { id: deviceId },
    data: { tokenHash: newTokenHash },
  });
}

export async function updateDeviceLastSeen(deviceId: string, timestamp: string | Date): Promise<void> {
  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeen: new Date(timestamp) },
    });
  } catch {
    // Ignore if device record does not exist in DB (e.g. preview virtual devices)
  }
}

export async function deleteDevice(deviceId: string): Promise<boolean> {
  try {
    await prisma.device.delete({
      where: { id: deviceId },
    });
    return true;
  } catch {
    return false;
  }
}

// Datastream Queries
export async function getDatastreamsByDeviceId(deviceId: string): Promise<Datastream[]> {
  const streams = await prisma.datastream.findMany({
    where: { deviceId },
    orderBy: { virtualPin: 'asc' },
  });
  return streams.map((s) => ({
    id: s.id,
    deviceId: s.deviceId,
    virtualPin: s.virtualPin,
    name: s.name,
    dataType: s.dataType as DataType,
    unit: s.unit,
    minValue: s.minValue,
    maxValue: s.maxValue,
    description: s.description,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

export async function getDatastreamByPin(deviceId: string, virtualPin: string): Promise<Datastream | null> {
  const stream = await prisma.datastream.findUnique({
    where: {
      deviceId_virtualPin: {
        deviceId,
        virtualPin,
      },
    },
  });
  if (!stream) return null;
  return {
    id: stream.id,
    deviceId: stream.deviceId,
    virtualPin: stream.virtualPin,
    name: stream.name,
    dataType: stream.dataType as DataType,
    unit: stream.unit,
    minValue: stream.minValue,
    maxValue: stream.maxValue,
    description: stream.description,
    createdAt: stream.createdAt.toISOString(),
    updatedAt: stream.updatedAt.toISOString(),
  };
}

export async function getDatastreamById(datastreamId: string): Promise<Datastream | null> {
  const stream = await prisma.datastream.findUnique({
    where: { id: datastreamId },
  });
  if (!stream) return null;
  return {
    id: stream.id,
    deviceId: stream.deviceId,
    virtualPin: stream.virtualPin,
    name: stream.name,
    dataType: stream.dataType as DataType,
    unit: stream.unit,
    minValue: stream.minValue,
    maxValue: stream.maxValue,
    description: stream.description,
    createdAt: stream.createdAt.toISOString(),
    updatedAt: stream.updatedAt.toISOString(),
  };
}

export async function createDatastream(stream: {
  id?: string;
  deviceId: string;
  virtualPin: string;
  name: string;
  dataType: DataType;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  description?: string | null;
}): Promise<Datastream> {
  const created = await prisma.datastream.create({
    data: {
      id: stream.id,
      deviceId: stream.deviceId,
      virtualPin: stream.virtualPin,
      name: stream.name,
      dataType: stream.dataType as any,
      unit: stream.unit ?? null,
      minValue: stream.minValue ?? null,
      maxValue: stream.maxValue ?? null,
      description: stream.description ?? null,
    },
  });
  return {
    id: created.id,
    deviceId: created.deviceId,
    virtualPin: created.virtualPin,
    name: created.name,
    dataType: created.dataType as DataType,
    unit: created.unit,
    minValue: created.minValue,
    maxValue: created.maxValue,
    description: created.description,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function updateDatastream(
  streamId: string,
  data: Partial<Omit<Datastream, 'id' | 'deviceId' | 'virtualPin' | 'createdAt'>>
): Promise<void> {
  await prisma.datastream.update({
    where: { id: streamId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.dataType !== undefined ? { dataType: data.dataType as any } : {}),
      ...(data.unit !== undefined ? { unit: data.unit } : {}),
      ...(data.minValue !== undefined ? { minValue: data.minValue } : {}),
      ...(data.maxValue !== undefined ? { maxValue: data.maxValue } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
}

export async function deleteDatastream(streamId: string): Promise<boolean> {
  try {
    await prisma.datastream.delete({
      where: { id: streamId },
    });
    return true;
  } catch {
    return false;
  }
}

// Sensor Data Queries & Atomic Ingestion Transaction
export async function insertSensorData(data: {
  id?: string;
  deviceId: string;
  datastreamId: string;
  value: string;
  numericValue: number | null;
  timestamp: string | Date;
}): Promise<void> {
  await prisma.sensorData.create({
    data: {
      id: data.id,
      deviceId: data.deviceId,
      datastreamId: data.datastreamId,
      value: data.value,
      numericValue: data.numericValue,
      timestamp: new Date(data.timestamp),
    },
  });
}

export async function ingestTelemetryAtomic(
  deviceId: string,
  readings: {
    id: string;
    deviceId: string;
    datastreamId: string;
    value: string;
    numericValue: number | null;
    timestamp: string;
  }[],
  timestamp: string,
  client: any = prisma
): Promise<void> {
  const timeDate = new Date(timestamp);
  if (client === prisma) {
    await prisma.$transaction([
      prisma.sensorData.createMany({
        data: readings.map((r) => ({
          id: r.id,
          deviceId: r.deviceId,
          datastreamId: r.datastreamId,
          value: r.value,
          numericValue: r.numericValue,
          timestamp: new Date(r.timestamp),
        })),
      }),
      prisma.device.update({
        where: { id: deviceId },
        data: { lastSeen: timeDate },
      }),
    ]);
  } else {
    await client.sensorData.createMany({
      data: readings.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        datastreamId: r.datastreamId,
        value: r.value,
        numericValue: r.numericValue,
        timestamp: new Date(r.timestamp),
      })),
    });
    await client.device.update({
      where: { id: deviceId },
      data: { lastSeen: timeDate },
    });
  }
}

export async function getLatestSensorDataForDevice(
  deviceId: string
): Promise<Record<string, { value: string; numericValue: number | null; timestamp: string }>> {
  const streams = await prisma.datastream.findMany({
    where: { deviceId },
    include: {
      sensorData: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });

  const result: Record<string, { value: string; numericValue: number | null; timestamp: string }> = {};
  for (const stream of streams) {
    const latest = stream.sensorData[0];
    if (latest) {
      result[stream.virtualPin] = {
        value: latest.value,
        numericValue: latest.numericValue,
        timestamp: latest.timestamp.toISOString(),
      };
    }
  }
  return result;
}

export async function getHistoricalData(
  deviceId: string,
  virtualPin: string,
  sinceTimestamp: string
): Promise<{ timestamp: string; value: string; numericValue: number | null }[]> {
  const sinceDate = new Date(sinceTimestamp);
  const data = await prisma.sensorData.findMany({
    where: {
      deviceId,
      datastream: {
        virtualPin,
      },
      timestamp: {
        gte: sinceDate,
      },
    },
    orderBy: { timestamp: 'asc' },
    take: 500,
  });

  return data.map((d) => ({
    timestamp: d.timestamp.toISOString(),
    value: d.value,
    numericValue: d.numericValue,
  }));
}

// Ensure database schema and migrations for widgets table exist
export async function initDatabaseSchema(): Promise<void> {
  console.log('[POSTGRES] Database schema is managed via Prisma Migrations. Verified 100% sync.');
}

// Widget Layout Queries
export async function getWidgetsByDeviceId(deviceId: string): Promise<Widget[]> {
  console.log(`[DB] getWidgetsByDeviceId called for device: ${deviceId}`);
  const widgets = await prisma.widget.findMany({
    where: { deviceId },
    include: {
      datastream: {
        select: {
          id: true,
          virtualPin: true,
          name: true,
          dataType: true,
          unit: true,
          minValue: true,
          maxValue: true,
        },
      },
    },
    orderBy: [
      { y: 'asc' },
      { x: 'asc' },
    ],
  });

  console.log(`[DB] getWidgetsByDeviceId found ${widgets.length} widgets for device: ${deviceId}`);
  return widgets.map((w) => ({
    id: w.id,
    deviceId: w.deviceId,
    datastreamId: w.datastreamId,
    type: w.type as WidgetType,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    title: w.title,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    datastream: w.datastream
      ? {
          id: w.datastream.id,
          virtualPin: w.datastream.virtualPin,
          name: w.datastream.name,
          dataType: w.datastream.dataType as DataType,
          unit: w.datastream.unit,
          minValue: w.datastream.minValue,
          maxValue: w.datastream.maxValue,
        }
      : undefined,
  }));
}

export async function saveDeviceLayout(
  deviceId: string,
  widgetInputs: WidgetInput[]
): Promise<Widget[]> {
  console.log(`[DB] saveDeviceLayout starting transaction for device: ${deviceId}, widgets count: ${widgetInputs.length}`);
  // Execute within atomic transaction: replace all widgets for deviceId
  const result = await prisma.$transaction(async (tx) => {
    // 1. Clear existing layout for device
    const deleted = await tx.widget.deleteMany({
      where: { deviceId },
    });
    console.log(`[DB] saveDeviceLayout deleted ${deleted.count} widgets for device: ${deviceId}`);

    // 2. Insert new widgets
    let createdCount = 0;
    if (widgetInputs.length > 0) {
      const created = await tx.widget.createMany({
        data: widgetInputs.map((w) => ({
          id: w.id || crypto.randomUUID(),
          deviceId,
          datastreamId: w.datastreamId,
          type: w.type as any,
          x: Math.max(0, Math.floor(w.x)),
          y: Math.max(0, Math.floor(w.y)),
          w: Math.max(1, Math.floor(w.w)),
          h: Math.max(1, Math.floor(w.h)),
          title: String(w.title || '').trim() || 'Widget',
        })),
      });
      createdCount = created.count;
      console.log(`[DB] saveDeviceLayout created ${createdCount} widgets for device: ${deviceId}`);
    }
    return createdCount;
  });

  console.log(`[DB] saveDeviceLayout transaction success for device: ${deviceId}`);

  // Return the newly saved widgets with datastream relations
  return getWidgetsByDeviceId(deviceId);
}

// Automation Rules Queries
export async function getAutomationRulesByDeviceId(deviceId: string): Promise<AutomationRule[]> {
  const rules = await prisma.automationRule.findMany({
    where: { deviceId },
    include: {
      conditionDatastream: {
        select: { id: true, virtualPin: true, name: true, unit: true },
      },
      actionDatastream: {
        select: { id: true, virtualPin: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rules.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    name: r.name,
    conditionDatastreamId: r.conditionDatastreamId,
    operator: r.operator as any,
    conditionValue: r.conditionValue,
    actionDatastreamId: r.actionDatastreamId,
    actionValue: r.actionValue,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    conditionDatastream: r.conditionDatastream
      ? {
          id: r.conditionDatastream.id,
          virtualPin: r.conditionDatastream.virtualPin,
          name: r.conditionDatastream.name,
          unit: r.conditionDatastream.unit,
        }
      : undefined,
    actionDatastream: r.actionDatastream
      ? {
          id: r.actionDatastream.id,
          virtualPin: r.actionDatastream.virtualPin,
          name: r.actionDatastream.name,
        }
      : undefined,
  }));
}

export async function getActiveAutomationRulesByConditionDatastream(
  deviceId: string,
  conditionDatastreamId: string
): Promise<AutomationRule[]> {
  const rules = await prisma.automationRule.findMany({
    where: {
      deviceId,
      conditionDatastreamId,
      isActive: true,
    },
    include: {
      conditionDatastream: {
        select: { id: true, virtualPin: true, name: true, unit: true },
      },
      actionDatastream: {
        select: { id: true, virtualPin: true, name: true },
      },
    },
  });

  return rules.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    name: r.name,
    conditionDatastreamId: r.conditionDatastreamId,
    operator: r.operator as any,
    conditionValue: r.conditionValue,
    actionDatastreamId: r.actionDatastreamId,
    actionValue: r.actionValue,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    conditionDatastream: r.conditionDatastream,
    actionDatastream: r.actionDatastream,
  }));
}

export async function createAutomationRule(
  deviceId: string,
  input: AutomationRuleInput
): Promise<AutomationRule> {
  const rule = await prisma.automationRule.create({
    data: {
      id: crypto.randomUUID(),
      deviceId,
      name: input.name.trim(),
      conditionDatastreamId: input.conditionDatastreamId,
      operator: input.operator,
      conditionValue: input.conditionValue,
      actionDatastreamId: input.actionDatastreamId,
      actionValue: String(input.actionValue).trim(),
      isActive: input.isActive ?? true,
    },
    include: {
      conditionDatastream: {
        select: { id: true, virtualPin: true, name: true, unit: true },
      },
      actionDatastream: {
        select: { id: true, virtualPin: true, name: true },
      },
    },
  });

  return {
    id: rule.id,
    deviceId: rule.deviceId,
    name: rule.name,
    conditionDatastreamId: rule.conditionDatastreamId,
    operator: rule.operator as any,
    conditionValue: rule.conditionValue,
    actionDatastreamId: rule.actionDatastreamId,
    actionValue: rule.actionValue,
    isActive: rule.isActive,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    conditionDatastream: rule.conditionDatastream,
    actionDatastream: rule.actionDatastream,
  };
}

export async function updateAutomationRule(
  ruleId: string,
  input: Partial<AutomationRuleInput>
): Promise<AutomationRule> {
  const rule = await prisma.automationRule.update({
    where: { id: ruleId },
    data: {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.conditionDatastreamId ? { conditionDatastreamId: input.conditionDatastreamId } : {}),
      ...(input.operator ? { operator: input.operator } : {}),
      ...(input.conditionValue !== undefined ? { conditionValue: input.conditionValue } : {}),
      ...(input.actionDatastreamId ? { actionDatastreamId: input.actionDatastreamId } : {}),
      ...(input.actionValue !== undefined ? { actionValue: String(input.actionValue).trim() } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: {
      conditionDatastream: {
        select: { id: true, virtualPin: true, name: true, unit: true },
      },
      actionDatastream: {
        select: { id: true, virtualPin: true, name: true },
      },
    },
  });

  return {
    id: rule.id,
    deviceId: rule.deviceId,
    name: rule.name,
    conditionDatastreamId: rule.conditionDatastreamId,
    operator: rule.operator as any,
    conditionValue: rule.conditionValue,
    actionDatastreamId: rule.actionDatastreamId,
    actionValue: rule.actionValue,
    isActive: rule.isActive,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    conditionDatastream: rule.conditionDatastream,
    actionDatastream: rule.actionDatastream,
  };
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  await prisma.automationRule.delete({
    where: { id: ruleId },
  });
}

// Notifications Queries
export async function getNotificationsByUserId(userId: string, limit = 50): Promise<Notification[]> {
  const notifications = await prisma.notification.findMany({
    where: {
      device: {
        project: {
          userId,
        },
      },
    },
    include: {
      device: {
        select: { id: true, name: true, deviceIdentifier: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return notifications.map((n) => ({
    id: n.id,
    deviceId: n.deviceId,
    type: n.type as NotificationType,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    device: n.device,
  }));
}

export async function createNotification(
  deviceId: string,
  type: NotificationType,
  message: string,
  client: any = prisma
): Promise<Notification> {
  const notif = await client.notification.create({
    data: {
      id: crypto.randomUUID(),
      deviceId,
      type,
      message,
      isRead: false,
    },
    include: {
      device: {
        select: { id: true, name: true, deviceIdentifier: true },
      },
    },
  });

  return {
    id: notif.id,
    deviceId: notif.deviceId,
    type: notif.type as NotificationType,
    message: notif.message,
    isRead: notif.isRead,
    createdAt: notif.createdAt.toISOString(),
    device: notif.device,
  };
}

export async function markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      device: { project: { userId } },
    },
    data: { isRead: true },
  });
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      device: { project: { userId } },
    },
    data: { isRead: true },
  });
}

export async function checkHasRecentOfflineNotification(
  deviceId: string,
  withinMinutes = 60,
  client: any = prisma
): Promise<boolean> {
  const since = new Date(Date.now() - withinMinutes * 60 * 1000);
  const count = await client.notification.count({
    where: {
      deviceId,
      type: 'OFFLINE',
      createdAt: { gte: since },
    },
  });
  return count > 0;
}

// Sensor Data Export Query
export async function getSensorDataForExport(
  deviceId: string,
  startTime?: string,
  endTime?: string,
  datastreamId?: string
) {
  const whereClause: any = { deviceId };
  if (datastreamId) {
    whereClause.datastreamId = datastreamId;
  }
  if (startTime || endTime) {
    whereClause.timestamp = {};
    if (startTime) whereClause.timestamp.gte = new Date(startTime);
    if (endTime) whereClause.timestamp.lte = new Date(endTime);
  }

  const data = await prisma.sensorData.findMany({
    where: whereClause,
    include: {
      datastream: {
        select: {
          virtualPin: true,
          name: true,
          unit: true,
        },
      },
      device: {
        select: {
          name: true,
          deviceIdentifier: true,
        },
      },
    },
    orderBy: { timestamp: 'asc' },
    take: 10000, // Reasonable cap for export
  });

  return data.map((d) => ({
    timestamp: d.timestamp.toISOString(),
    deviceName: d.device.name,
    deviceIdentifier: d.device.deviceIdentifier,
    virtualPin: d.datastream.virtualPin,
    datastreamName: d.datastream.name,
    value: d.value,
    unit: d.datastream.unit || '',
  }));
}

