import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/esp32_iot_monitor?pgbouncer=true',
});
const BASE_URL = 'http://127.0.0.1:3000';

async function runAudit() {
  console.log('====================================================');
  console.log('ESP32 IOT MONITOR — ARCHITECTURE AUDIT VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`[PASS] ${title}${detail ? ` -> ${detail}` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // 1. MULTI-TENANT AUTHORIZATION AUDIT (User A vs User B)
    // ----------------------------------------------------
    console.log('--- 1. Multi-Tenant Authorization Audit ---');
    // User A
    const emailA = `user_a_${Date.now()}@esp32.io`;
    const resA = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: 'PasswordA123!' }),
    });
    const dataA = await resA.json();
    const tokenA = dataA.token;

    // User B
    const emailB = `user_b_${Date.now()}@esp32.io`;
    const resB = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'PasswordB123!' }),
    });
    const dataB = await resB.json();
    const tokenB = dataB.token;

    // User A creates project
    const projResA = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ name: "User A's Secret Project" }),
    });
    const projDataA = await projResA.json();
    const projIdA = projDataA.project.id;

    // User A creates device
    const devResA = await fetch(`${BASE_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ projectId: projIdA, name: 'Device A', deviceIdentifier: `DEV-A-${Date.now()}` }),
    });
    const devDataA = await devResA.json();
    const devIdA = devDataA.device.id;
    const devTokenA = devDataA.deviceToken;

    // User A creates datastream V0
    const dsResA = await fetch(`${BASE_URL}/api/devices/${devIdA}/datastreams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ virtualPin: 'V0', name: 'Sensor A0', dataType: 'INTEGER', minValue: 0, maxValue: 100 }),
    });
    const dsDataA = await dsResA.json();
    const dsIdA = dsDataA.datastream.id;

    // User B tries to GET User A's device -> Expect 404
    const bGetDev = await fetch(`${BASE_URL}/api/devices/${devIdA}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert('User B cannot GET User A device', bGetDev.status === 404, `Status ${bGetDev.status}`);

    // User B tries to DELETE User A's project -> Expect 404
    const bDelProj = await fetch(`${BASE_URL}/api/projects/${projIdA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert('User B cannot DELETE User A project', bDelProj.status === 404, `Status ${bDelProj.status}`);

    // User B tries to GET User A's datastreams -> Expect 404
    const bGetDs = await fetch(`${BASE_URL}/api/devices/${devIdA}/datastreams`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert('User B cannot GET User A datastreams', bGetDs.status === 404, `Status ${bGetDs.status}`);

    // User B tries to PUT User A's datastream -> Expect 403
    const bPutDs = await fetch(`${BASE_URL}/api/datastreams/${dsIdA}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ name: 'Hacked Name' }),
    });
    assert('User B cannot PUT User A datastream', bPutDs.status === 403, `Status ${bPutDs.status}`);

    // User B tries to GET User A's live sensor data -> Expect 404
    const bGetData = await fetch(`${BASE_URL}/api/devices/${devIdA}/data`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert('User B cannot GET User A device data', bGetData.status === 404, `Status ${bGetData.status}`);

    // User B tries to GET User A's historical data -> Expect 404
    const bGetHistory = await fetch(`${BASE_URL}/api/devices/${devIdA}/data/history?datastream=V0&range=1h`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert('User B cannot GET User A history', bGetHistory.status === 404, `Status ${bGetHistory.status}`);

    // ----------------------------------------------------
    // 2. TRANSACTION ATOMICITY & ROLLBACK AUDIT
    // ----------------------------------------------------
    console.log('\n--- 2. Transaction Atomicity & Partial Write Audit ---');
    // Ensure 0 records before
    const initialCount = await prisma.sensorData.count({ where: { deviceId: devIdA } });
    const initialDev = await prisma.device.findUnique({ where: { id: devIdA } });
    const initialLastSeen = initialDev?.lastSeen;

    // Send payload with valid V0 and invalid V99 (unknown virtual pin)
    const atomicFailRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken: devTokenA,
        data: {
          V0: 50,
          V99: 100, // Invalid pin!
        },
      }),
    });
    const atomicFailData = await atomicFailRes.json();
    const countAfterFail = await prisma.sensorData.count({ where: { deviceId: devIdA } });
    const devAfterFail = await prisma.device.findUnique({ where: { id: devIdA } });

    assert(
      'Atomic rejection on unknown pin (HTTP 400)',
      atomicFailRes.status === 400 && atomicFailData.error === 'UNKNOWN_VIRTUAL_PIN',
      `Status ${atomicFailRes.status}, Error: ${atomicFailData.error}`
    );
    assert(
      'Zero partial writes committed to PostgreSQL on validation error',
      countAfterFail === initialCount,
      `Readings count before: ${initialCount}, after: ${countAfterFail}`
    );
    assert(
      'Device lastSeen NOT updated on failed transaction',
      devAfterFail?.lastSeen?.toISOString() === initialLastSeen?.toISOString(),
      `lastSeen remains unchanged`
    );

    // Range violation test (V0 is 0-100, sending 150)
    const rangeFailRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken: devTokenA,
        data: { V0: 150 },
      }),
    });
    const rangeFailData = await rangeFailRes.json();
    assert(
      'Range validation rejection (VALUE_OUT_OF_RANGE)',
      rangeFailRes.status === 400 && rangeFailData.error === 'VALUE_OUT_OF_RANGE',
      `Status ${rangeFailRes.status}, Code: ${rangeFailData.error}`
    );

    // ----------------------------------------------------
    // 3. DEVICE TOKEN REGENERATION & INVALIDATION AUDIT
    // ----------------------------------------------------
    console.log('\n--- 3. Device Token Security & Regeneration Audit ---');
    // Verify raw token is NOT in database
    const pgDevRow = await prisma.device.findUnique({ where: { id: devIdA } });
    assert(
      'Raw token is NOT stored in PostgreSQL (only tokenHash exists)',
      !pgDevRow?.tokenHash.includes('esp32_tok_') && pgDevRow?.tokenHash.length === 64,
      `tokenHash is 64-char SHA256 hex: ${pgDevRow?.tokenHash.slice(0, 16)}...`
    );

    // Regenerate token
    const regenRes = await fetch(`${BASE_URL}/api/devices/${devIdA}/regenerate-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const regenData = await regenRes.json();
    const newDevTokenA = regenData.deviceToken;
    assert('Token regenerated successfully', regenRes.status === 200 && !!newDevTokenA, `New token received`);

    // Old token should now be REJECTED (401 INVALID_DEVICE_TOKEN)
    const oldTokRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken: devTokenA, // Old token!
        data: { V0: 60 },
      }),
    });
    const oldTokData = await oldTokRes.json();
    assert(
      'Old device token is immediately invalidated (HTTP 401)',
      oldTokRes.status === 401 && oldTokData.error === 'INVALID_DEVICE_TOKEN',
      `Status: ${oldTokRes.status}, Error: ${oldTokData.error}`
    );

    // New token works with X-Device-Token header
    const newTokRes = await fetch(`${BASE_URL}/api/device/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': newDevTokenA,
      },
      body: JSON.stringify({
        data: { V0: 67 },
      }),
    });
    const newTokData = await newTokRes.json();
    assert(
      'New device token authenticates via X-Device-Token header (HTTP 200)',
      newTokRes.status === 200 && newTokData.received?.V0 === 67,
      `Status: ${newTokRes.status}, V0: ${newTokData.received?.V0}`
    );

    // ----------------------------------------------------
    // 4. HISTORICAL DATA RANGES AUDIT (1m, 5m, 1h, 6h, 24h, 7d)
    // ----------------------------------------------------
    console.log('\n--- 4. Historical Data Ranges & PostgreSQL Query Audit ---');
    const ranges = ['1m', '5m', '1h', '6h', '24h', '7d'];
    for (const r of ranges) {
      const histRes = await fetch(`${BASE_URL}/api/devices/${devIdA}/data/history?datastream=V0&range=${r}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      const histData = await histRes.json();
      assert(
        `Historical query for range "${r}" executes via PostgreSQL`,
        histRes.status === 200 && Array.isArray(histData.points),
        `Points returned: ${histData.points?.length}`
      );
    }

    // ----------------------------------------------------
    // 5. POSTGRESQL INDEX AUDIT VIA pg_indexes
    // ----------------------------------------------------
    console.log('\n--- 5. PostgreSQL Index Audit ---');
    const indexes: any = await prisma.$queryRaw`
      SELECT tablename, indexname, indexdef 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      ORDER BY tablename, indexname;
    `;
    console.log(`Found ${indexes.length} PostgreSQL indexes in schema public:`);
    for (const idx of indexes) {
      console.log(` - [${idx.tablename}] ${idx.indexname}: ${idx.indexdef}`);
    }

    const hasSensorDeviceTime = indexes.some((i: any) => i.indexname === 'sensor_data_deviceId_timestamp_idx');
    const hasSensorStreamTime = indexes.some((i: any) => i.indexname === 'sensor_data_datastreamId_timestamp_idx');
    const hasDatastreamPinKey = indexes.some((i: any) => i.indexname === 'datastreams_deviceId_virtualPin_key');
    const hasDeviceIdentifierKey = indexes.some((i: any) => i.indexname === 'devices_deviceIdentifier_key');

    assert('sensor_data(deviceId, timestamp) index exists', hasSensorDeviceTime);
    assert('sensor_data(datastreamId, timestamp) index exists', hasSensorStreamTime);
    assert('datastreams(deviceId, virtualPin) unique constraint index exists', hasDatastreamPinKey);
    assert('devices(deviceIdentifier) unique index exists', hasDeviceIdentifierKey);

    console.log('\n====================================================');
    console.log(`AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
