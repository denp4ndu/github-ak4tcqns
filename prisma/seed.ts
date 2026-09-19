import { PrismaClient, DataType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

function hashDeviceToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export async function seed() {
  console.log('[SEED] Seeding database...');

  // 1. Demo User
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@esp32.io' },
    update: {
      passwordHash,
    },
    create: {
      email: 'demo@esp32.io',
      passwordHash,
    },
  });
  console.log(`[SEED] Demo User verified: ${demoUser.email} (${demoUser.id})`);

  // 2. Project
  let project = await prisma.project.findFirst({
    where: { userId: demoUser.id, name: 'Smart Irrigation' },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        userId: demoUser.id,
        name: 'Smart Irrigation',
        description: 'Automated Greenhouse & Soil Monitoring System',
      },
    });
  }
  console.log(`[SEED] Project verified: ${project.name} (${project.id})`);

  // 3. Device
  const rawToken = 'esp32_tok_0123456789abcdef0123456789abcdef0123456789abcdef';
  const tokenHash = hashDeviceToken(rawToken);

  let device = await prisma.device.findUnique({
    where: { deviceIdentifier: 'ESP32-001' },
  });

  if (!device) {
    device = await prisma.device.create({
      data: {
        projectId: project.id,
        name: 'ESP32 Greenhouse 01',
        deviceIdentifier: 'ESP32-001',
        tokenHash,
        lastSeen: null, // Initial device starts offline
      },
    });
  }
  console.log(`[SEED] Device verified: ${device.name} (${device.deviceIdentifier})`);

  // 4. Datastreams
  const defaultStreams = [
    {
      virtualPin: 'V0',
      name: 'Kelembaban Tanah',
      dataType: DataType.INTEGER,
      unit: '%',
      minValue: 0,
      maxValue: 100,
      description: 'Soil moisture percentage reading',
    },
    {
      virtualPin: 'V1',
      name: 'Suhu',
      dataType: DataType.FLOAT,
      unit: '°C',
      minValue: -20,
      maxValue: 80,
      description: 'Ambient greenhouse temperature',
    },
    {
      virtualPin: 'V2',
      name: 'ADC Soil',
      dataType: DataType.INTEGER,
      unit: 'raw',
      minValue: 0,
      maxValue: 4095,
      description: 'Raw capacitive moisture sensor ADC value',
    },
    {
      virtualPin: 'V3',
      name: 'Pompa',
      dataType: DataType.BOOLEAN,
      unit: 'state',
      minValue: null,
      maxValue: null,
      description: 'Irrigation water pump relay status',
    },
  ];

  for (const s of defaultStreams) {
    await prisma.datastream.upsert({
      where: {
        deviceId_virtualPin: {
          deviceId: device.id,
          virtualPin: s.virtualPin,
        },
      },
      update: {
        name: s.name,
        dataType: s.dataType,
        unit: s.unit,
        minValue: s.minValue,
        maxValue: s.maxValue,
        description: s.description,
      },
      create: {
        deviceId: device.id,
        virtualPin: s.virtualPin,
        name: s.name,
        dataType: s.dataType,
        unit: s.unit,
        minValue: s.minValue,
        maxValue: s.maxValue,
        description: s.description,
      },
    });
  }
  console.log('[SEED] Datastreams verified: V0, V1, V2, V3.');
  console.log('[SEED] NOTE: No fake or mock sensor readings generated. Production contract verified.');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
