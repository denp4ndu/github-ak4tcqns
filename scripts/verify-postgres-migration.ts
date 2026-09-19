import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://127.0.0.1:3000';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 1 POSTGRESQL + PRISMA VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function report(num: number, title: string, ok: boolean, details?: string) {
    if (ok) {
      console.log(`[PASS] Test ${num}: ${title}${details ? ` -> ${details}` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${num}: ${title}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  const testEmail = `test_${Date.now()}@esp32.io`;
  const testPassword = 'Password123!';
  let jwtToken = '';
  let userId = '';
  let projectId = '';
  let deviceId = '';
  let deviceToken = '';
  let deviceIdentifier = `ESP32-TEST-${Date.now().toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // TEST 1: User Registration
    // ----------------------------------------------------
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const regData = await regRes.json();
    const t1Ok = regRes.status === 201 && regData.success && !!regData.token && !!regData.user?.id;
    jwtToken = regData.token;
    userId = regData.user?.id;
    report(1, 'User Registration', t1Ok, `Status ${regRes.status}, User ID: ${userId}`);

    // ----------------------------------------------------
    // TEST 2: Duplicate Email Rejection
    // ----------------------------------------------------
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const dupData = await dupRes.json();
    const t2Ok = dupRes.status === 400 && dupData.error === 'VALIDATION_ERROR';
    report(2, 'Duplicate Email Rejection', t2Ok, `Status ${dupRes.status}, Code: ${dupData.error}`);

    // ----------------------------------------------------
    // TEST 3: User Login
    // ----------------------------------------------------
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginData = await loginRes.json();
    const t3Ok = loginRes.status === 200 && loginData.success && !!loginData.token;
    report(3, 'User Login', t3Ok, `Status ${loginRes.status}, Token received`);

    // ----------------------------------------------------
    // TEST 4: Project Creation
    // ----------------------------------------------------
    const projRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        name: 'Automated Test Greenhouse',
        description: 'PostgreSQL verification project',
      }),
    });
    const projData = await projRes.json();
    const t4Ok = projRes.status === 201 && projData.success && !!projData.project?.id;
    projectId = projData.project?.id;
    report(4, 'Project Creation', t4Ok, `Status ${projRes.status}, Project ID: ${projectId}`);

    // ----------------------------------------------------
    // TEST 5: Device Creation
    // ----------------------------------------------------
    const devRes = await fetch(`${BASE_URL}/api/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        projectId,
        name: 'ESP32 Node 01',
        deviceIdentifier,
      }),
    });
    const devData = await devRes.json();
    const t5Ok = devRes.status === 201 && devData.success && !!devData.device?.id && !!devData.deviceToken;
    deviceId = devData.device?.id;
    deviceToken = devData.deviceToken;
    report(5, 'Device Creation', t5Ok, `Status ${devRes.status}, Device ID: ${deviceId}`);

    // ----------------------------------------------------
    // TEST 6: Device Token Format & Hash Validation
    // ----------------------------------------------------
    const tokenFormatValid = /^esp32_tok_[0-9a-f]{48}$/.test(deviceToken);
    const expectedHash = crypto.createHash('sha256').update(deviceToken.trim()).digest('hex');
    const pgDevice = await prisma.device.findUnique({ where: { id: deviceId } });
    const t6Ok = tokenFormatValid && pgDevice?.tokenHash === expectedHash;
    report(
      6,
      'Device Token Generation (SHA-256 Hashing)',
      t6Ok,
      `Prefix: ${deviceToken.slice(0, 14)}..., TokenHash in PG matches SHA-256`
    );

    // ----------------------------------------------------
    // TEST 7: Datastream Creation (V0 - INTEGER, V1 - FLOAT, V3 - BOOLEAN)
    // ----------------------------------------------------
    const dsRes = await fetch(`${BASE_URL}/api/devices/${deviceId}/datastreams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        virtualPin: 'V0',
        name: 'Soil Moisture',
        dataType: 'INTEGER',
        unit: '%',
        minValue: 0,
        maxValue: 100,
      }),
    });
    const dsData = await dsRes.json();
    const t7Ok = dsRes.status === 201 && dsData.success && dsData.datastream?.virtualPin === 'V0';
    report(7, 'Datastream Creation', t7Ok, `Status ${dsRes.status}, Pin V0 created`);

    // Create companion datastreams V1 and V3
    await fetch(`${BASE_URL}/api/devices/${deviceId}/datastreams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ virtualPin: 'V1', name: 'Temperature', dataType: 'FLOAT', unit: '°C' }),
    });
    await fetch(`${BASE_URL}/api/devices/${deviceId}/datastreams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ virtualPin: 'V3', name: 'Water Relay', dataType: 'BOOLEAN' }),
    });

    // ----------------------------------------------------
    // TEST 8: Duplicate Datastream Rejection
    // ----------------------------------------------------
    const dupDsRes = await fetch(`${BASE_URL}/api/devices/${deviceId}/datastreams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        virtualPin: 'V0',
        name: 'Duplicate Pin Test',
        dataType: 'INTEGER',
      }),
    });
    const dupDsData = await dupDsRes.json();
    const t8Ok = dupDsRes.status === 400 && dupDsData.error === 'VALIDATION_ERROR';
    report(8, 'Duplicate Datastream Rejection', t8Ok, `Status ${dupDsRes.status}, Code: ${dupDsData.error}`);

    // ----------------------------------------------------
    // TEST 9: Valid Sensor Data Ingestion
    // ----------------------------------------------------
    const ingestRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        data: {
          V0: 67,
          V1: 28.5,
          V3: true,
        },
      }),
    });
    const ingestData = await ingestRes.json();
    const t9Ok = ingestRes.status === 200 && ingestData.success && ingestData.received?.V0 === 67;
    report(9, 'Valid Sensor Data Ingestion', t9Ok, `Status ${ingestRes.status}, Response: ${JSON.stringify(ingestData.received)}`);

    // ----------------------------------------------------
    // TEST 10: Database Persistence in PostgreSQL
    // ----------------------------------------------------
    const pgReadings = await prisma.sensorData.findMany({
      where: { deviceId },
      include: { datastream: true },
      orderBy: { timestamp: 'desc' },
    });
    const v0Reading = pgReadings.find((r) => r.datastream.virtualPin === 'V0');
    const t10Ok = pgReadings.length === 3 && v0Reading?.value === '67' && v0Reading?.numericValue === 67;
    report(
      10,
      'Database Persistence in PostgreSQL',
      t10Ok,
      `Found ${pgReadings.length} rows in sensor_data table. V0 value: ${v0Reading?.value}`
    );

    // ----------------------------------------------------
    // TEST 11: Device Status ONLINE
    // ----------------------------------------------------
    const statusOnlineRes = await fetch(`${BASE_URL}/api/devices/${deviceId}`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    const statusOnlineData = await statusOnlineRes.json();
    const t11Ok = statusOnlineRes.status === 200 && statusOnlineData.device?.status === 'ONLINE';
    report(
      11,
      'Device Status ONLINE',
      t11Ok,
      `Status: ${statusOnlineData.device?.status}, secondsSinceLastSeen: ${statusOnlineData.device?.secondsSinceLastSeen}`
    );

    // ----------------------------------------------------
    // TEST 12: Device Timeout OFFLINE
    // ----------------------------------------------------
    // Artificially age the lastSeen timestamp by 45 seconds in PostgreSQL
    const pastTime = new Date(Date.now() - 45 * 1000);
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeen: pastTime },
    });
    const statusOfflineRes = await fetch(`${BASE_URL}/api/devices/${deviceId}`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    const statusOfflineData = await statusOfflineRes.json();
    const t12Ok =
      statusOfflineRes.status === 200 &&
      statusOfflineData.device?.status === 'OFFLINE' &&
      statusOfflineData.device?.secondsSinceLastSeen >= 30;
    report(
      12,
      'Device Timeout OFFLINE (> 30s)',
      t12Ok,
      `Status: ${statusOfflineData.device?.status}, secondsSinceLastSeen: ${statusOfflineData.device?.secondsSinceLastSeen}s`
    );

    // ----------------------------------------------------
    // TEST 13: Historical Data Query
    // ----------------------------------------------------
    // Re-ingest reading with current timestamp
    await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        data: { V0: 68 },
      }),
    });
    const historyRes = await fetch(`${BASE_URL}/api/devices/${deviceId}/data/history?datastream=V0&range=1h`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    const historyData = await historyRes.json();
    const t13Ok = historyRes.status === 200 && historyData.success && historyData.points.length >= 2;
    report(13, 'Historical Data Query', t13Ok, `Retrieved ${historyData.points?.length} points for V0`);

    // ----------------------------------------------------
    // TEST 14: Unknown Virtual Pin Rejection
    // ----------------------------------------------------
    const unkPinRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        data: { V99: 100 },
      }),
    });
    const unkPinData = await unkPinRes.json();
    const t14Ok = unkPinRes.status === 400 && unkPinData.error === 'UNKNOWN_VIRTUAL_PIN';
    report(14, 'Unknown Virtual Pin Rejection', t14Ok, `Status ${unkPinRes.status}, Error: ${unkPinData.error}`);

    // ----------------------------------------------------
    // TEST 15: Invalid Data Type Rejection (and Range check)
    // ----------------------------------------------------
    const invTypeRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        data: { V0: 'invalid_string_instead_of_int' },
      }),
    });
    const invTypeData = await invTypeRes.json();
    const t15Ok = invTypeRes.status === 400 && invTypeData.error === 'INVALID_DATA_TYPE';
    report(15, 'Invalid Data Type Rejection', t15Ok, `Status ${invTypeRes.status}, Error: ${invTypeData.error}`);

    console.log('\n====================================================');
    console.log(`TEST SUITE RESULTS: ${passed}/15 PASSED, ${failed}/15 FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
