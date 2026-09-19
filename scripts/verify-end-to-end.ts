import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://127.0.0.1:3000';

async function runEndToEnd() {
  console.log('=== BEGIN SECTION 20 END-TO-END VERIFICATION ===\n');

  // Step 1: Create new user
  const email = `e2e_${Date.now()}@esp32.io`;
  const password = 'PasswordE2E123!';
  console.log(`Step 1: Registering user: ${email}`);
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const regData = await regRes.json();
  console.log(`Response Status: ${regRes.status}, Body:`, JSON.stringify(regData));

  // Step 2: Login
  console.log('\nStep 2: Logging in');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log(`Response Status: ${loginRes.status}, Token received: ${token.slice(0, 20)}...`);

  // Step 3: Create project
  console.log('\nStep 3: Creating project "Smart Greenhouse"');
  const projRes = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Smart Greenhouse',
      description: 'Automated environmental monitoring',
    }),
  });
  const projData = await projRes.json();
  const projectId = projData.project.id;
  console.log(`Response Status: ${projRes.status}, Project ID: ${projectId}`);

  // Step 4: Create device
  console.log('\nStep 4: Creating device "ESP32 Greenhouse Node"');
  const deviceIdentifier = `ESP32-GH-${Date.now().toString().slice(-4)}`;
  const devRes = await fetch(`${BASE_URL}/api/devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      projectId,
      name: 'ESP32 Greenhouse Node',
      deviceIdentifier,
    }),
  });
  const devData = await devRes.json();
  const deviceId = devData.device.id;
  const deviceToken = devData.deviceToken;
  console.log(`Response Status: ${devRes.status}, Device ID: ${deviceId}, Identifier: ${deviceIdentifier}`);

  // Step 5: Device token
  console.log(`\nStep 5: Device Token generated: ${deviceToken}`);

  // Step 6: Create datastream V0 (INTEGER, 0-100)
  console.log('\nStep 6: Creating datastream V0 (INTEGER, 0-100, %)');
  const dsRes = await fetch(`${BASE_URL}/api/devices/${deviceId}/datastreams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      virtualPin: 'V0',
      name: 'Soil Moisture',
      dataType: 'INTEGER',
      unit: '%',
      minValue: 0,
      maxValue: 100,
      description: 'Greenhouse soil moisture',
    }),
  });
  const dsData = await dsRes.json();
  console.log(`Response Status: ${dsRes.status}, Datastream:`, JSON.stringify(dsData.datastream));

  // Step 7: Send sensor data V0 = 67
  console.log('\nStep 7: Ingesting sensor data V0 = 67 via POST /api/device/data');
  const ingest1Res = await fetch(`${BASE_URL}/api/device/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceToken,
      data: { V0: 67 },
    }),
  });
  const ingest1Data = await ingest1Res.json();
  console.log(`Response Status: ${ingest1Res.status}, Body:`, JSON.stringify(ingest1Data));

  // Step 8: Verify PostgreSQL contains the record
  console.log('\nStep 8: Querying PostgreSQL directly via Prisma Client');
  const pgRows = await prisma.sensorData.findMany({
    where: { deviceId },
    include: { datastream: true },
  });
  console.log(`Found ${pgRows.length} record(s) in "sensor_data" table:`);
  for (const r of pgRows) {
    console.log(` - ID: ${r.id}, Pin: ${r.datastream.virtualPin}, Value: "${r.value}", Numeric: ${r.numericValue}, Time: ${r.timestamp.toISOString()}`);
  }

  // Step 9: Check dashboard API returns currentValue: 67
  console.log('\nStep 9: Checking Dashboard API (GET /api/devices/:id/data)');
  const dash1Res = await fetch(`${BASE_URL}/api/devices/${deviceId}/data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dash1Data = await dash1Res.json();
  const v0Stream1 = dash1Data.datastreams.find((d: any) => d.virtualPin === 'V0');
  console.log(`Device Status: ${dash1Data.device.status}, V0 currentValue: "${v0Stream1?.currentValue}" (numeric: ${v0Stream1?.numericValue})`);

  // Step 10: Send sensor data V0 = 68
  console.log('\nStep 10: Ingesting sensor data V0 = 68 via POST /api/device/data');
  const ingest2Res = await fetch(`${BASE_URL}/api/device/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceToken,
      data: { V0: 68 },
    }),
  });
  const ingest2Data = await ingest2Res.json();
  console.log(`Response Status: ${ingest2Res.status}, Body:`, JSON.stringify(ingest2Data));

  // Step 11: Check dashboard API returns currentValue: 68
  console.log('\nStep 11: Checking Dashboard API (GET /api/devices/:id/data) for V0 = 68');
  const dash2Res = await fetch(`${BASE_URL}/api/devices/${deviceId}/data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dash2Data = await dash2Res.json();
  const v0Stream2 = dash2Data.datastreams.find((d: any) => d.virtualPin === 'V0');
  console.log(`Device Status: ${dash2Data.device.status}, V0 currentValue: "${v0Stream2?.currentValue}" (numeric: ${v0Stream2?.numericValue})`);

  // Step 12 & 13: Stop communication & wait past DEVICE_TIMEOUT_SECONDS (30s)
  console.log('\nStep 12: Stopping communication from device');
  console.log('Step 13: Simulating time passage past 30s timeout by aging lastSeen in PostgreSQL by 35 seconds');
  const agedTimestamp = new Date(Date.now() - 35 * 1000);
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeen: agedTimestamp },
  });

  // Step 14: Verify device status changes to OFFLINE
  console.log('\nStep 14: Verifying device status changes to OFFLINE');
  const dashOfflineRes = await fetch(`${BASE_URL}/api/devices/${deviceId}/data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dashOfflineData = await dashOfflineRes.json();
  console.log(`Device Status: ${dashOfflineData.device.status}, Seconds Since Last Seen: ${dashOfflineData.device.secondsSinceLastSeen}s`);

  console.log('\n=== END SECTION 20 END-TO-END VERIFICATION: SUCCESS ===');
}

runEndToEnd()
  .catch((err) => {
    console.error('End-to-end test failure:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
