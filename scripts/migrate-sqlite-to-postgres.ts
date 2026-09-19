import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';

async function migrateData() {
  const sqliteFile = path.resolve(process.cwd(), 'esp32_monitor.db');
  if (!fs.existsSync(sqliteFile)) {
    console.log('[MIGRATION] No existing SQLite file found. Skipping data transfer.');
    return;
  }

  const sqlite = new DatabaseSync(sqliteFile);
  const prisma = new PrismaClient();

  try {
    console.log('[MIGRATION] Reading SQLite database...');

    // 1. Users
    const users = sqlite.prepare('SELECT * FROM users').all() as any[];
    for (const u of users) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: {
          email: u.email,
          passwordHash: u.passwordHash,
          updatedAt: new Date(u.updatedAt),
        },
        create: {
          id: u.id,
          email: u.email,
          passwordHash: u.passwordHash,
          createdAt: new Date(u.createdAt),
          updatedAt: new Date(u.updatedAt),
        },
      });
    }
    console.log(`[MIGRATION] Migrated ${users.length} users.`);

    // 2. Projects
    const projects = sqlite.prepare('SELECT * FROM projects').all() as any[];
    for (const p of projects) {
      await prisma.project.upsert({
        where: { id: p.id },
        update: {
          name: p.name,
          description: p.description,
          updatedAt: new Date(p.updatedAt),
        },
        create: {
          id: p.id,
          userId: p.userId,
          name: p.name,
          description: p.description,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        },
      });
    }
    console.log(`[MIGRATION] Migrated ${projects.length} projects.`);

    // 3. Devices
    const devices = sqlite.prepare('SELECT * FROM devices').all() as any[];
    for (const d of devices) {
      await prisma.device.upsert({
        where: { id: d.id },
        update: {
          name: d.name,
          deviceIdentifier: d.deviceIdentifier,
          tokenHash: d.tokenHash,
          lastSeen: d.lastSeen ? new Date(d.lastSeen) : null,
          updatedAt: new Date(d.updatedAt),
        },
        create: {
          id: d.id,
          projectId: d.projectId,
          name: d.name,
          deviceIdentifier: d.deviceIdentifier,
          tokenHash: d.tokenHash,
          lastSeen: d.lastSeen ? new Date(d.lastSeen) : null,
          createdAt: new Date(d.createdAt),
          updatedAt: new Date(d.updatedAt),
        },
      });
    }
    console.log(`[MIGRATION] Migrated ${devices.length} devices.`);

    // 4. Datastreams
    const datastreams = sqlite.prepare('SELECT * FROM datastreams').all() as any[];
    for (const ds of datastreams) {
      await prisma.datastream.upsert({
        where: { id: ds.id },
        update: {
          virtualPin: ds.virtualPin,
          name: ds.name,
          dataType: ds.dataType,
          unit: ds.unit,
          minValue: ds.minValue,
          maxValue: ds.maxValue,
          description: ds.description,
          updatedAt: new Date(ds.updatedAt),
        },
        create: {
          id: ds.id,
          deviceId: ds.deviceId,
          virtualPin: ds.virtualPin,
          name: ds.name,
          dataType: ds.dataType,
          unit: ds.unit,
          minValue: ds.minValue,
          maxValue: ds.maxValue,
          description: ds.description,
          createdAt: new Date(ds.createdAt),
          updatedAt: new Date(ds.updatedAt),
        },
      });
    }
    console.log(`[MIGRATION] Migrated ${datastreams.length} datastreams.`);

    // 5. Sensor Data
    const sensorData = sqlite.prepare('SELECT * FROM sensor_data').all() as any[];
    for (const sd of sensorData) {
      await prisma.sensorData.upsert({
        where: { id: sd.id },
        update: {
          value: sd.value,
          numericValue: sd.numericValue,
          timestamp: new Date(sd.timestamp),
        },
        create: {
          id: sd.id,
          deviceId: sd.deviceId,
          datastreamId: sd.datastreamId,
          value: sd.value,
          numericValue: sd.numericValue,
          timestamp: new Date(sd.timestamp),
        },
      });
    }
    console.log(`[MIGRATION] Migrated ${sensorData.length} sensor readings.`);

    console.log('[MIGRATION] Data transfer from SQLite to PostgreSQL completed successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

migrateData().catch((err) => {
  console.error('[MIGRATION] Error during data transfer:', err);
  process.exit(1);
});
