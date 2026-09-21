import { prisma, createNotification, checkHasRecentOfflineNotification, acquireAdvisoryLock } from '../src/backend/db.ts';
import { processAutomationRulesForReadings } from '../src/backend/services/automationEngine.ts';
import { computeDeviceStatus } from '../src/backend/services/iotService.ts';
import { randomUUID } from 'node:crypto';

async function runTests() {
  console.log('====================================================================');
  console.log('STAGE 9.2-E WAVE 1 — DISTRIBUTED CONCURRENCY VERIFICATION SUITE');
  console.log('====================================================================\n');

  let allPassed = true;

  // Setup test environment
  const testUserId = 'test-e1e2-user-' + randomUUID();
  const testUser = await prisma.user.create({
    data: {
      id: testUserId,
      email: `test-e1e2-${Date.now()}@example.com`,
      passwordHash: 'hash',
    },
  });

  const testProject = await prisma.project.create({
    data: {
      userId: testUser.id,
      name: 'E1E2 Concurrency Test Project',
    },
  });

  const deviceA = await prisma.device.create({
    data: {
      projectId: testProject.id,
      name: 'E1E2 Device A',
      deviceIdentifier: 'ESP32-E1E2-A-' + randomUUID(),
      tokenHash: 'hash-' + randomUUID(),
      lastSeen: new Date(Date.now() - 120000), // 2 mins ago -> OFFLINE
    },
  });

  const v0Stream = await prisma.datastream.create({
    data: {
      deviceId: deviceA.id,
      virtualPin: 'V0',
      name: 'Temperature',
      dataType: 'FLOAT',
    },
  });

  const v3Stream = await prisma.datastream.create({
    data: {
      deviceId: deviceA.id,
      virtualPin: 'V3',
      name: 'Relay',
      dataType: 'BOOLEAN',
    },
  });

  // Initial state for V3 = 'false'
  await prisma.sensorData.create({
    data: {
      deviceId: deviceA.id,
      datastreamId: v3Stream.id,
      value: 'false',
      numericValue: 0,
      timestamp: new Date(Date.now() - 10000),
    },
  });

  // Create automation rule: IF V0 > 90 THEN SET V3 = 'true'
  const rule = await prisma.automationRule.create({
    data: {
      deviceId: deviceA.id,
      name: 'E1 Rule High Temp',
      conditionDatastreamId: v0Stream.id,
      operator: '>',
      conditionValue: 90,
      actionDatastreamId: v3Stream.id,
      actionValue: 'true',
      isActive: true,
    },
  });

  console.log(`[SETUP] Seeded Device (${deviceA.id}), Rule (${rule.id}).\n`);

  // ------------------------------------------------------------------
  // TEST E1-A & E1-B & E1-C: CONCURRENT AUTOMATION EVALUATION
  // ------------------------------------------------------------------
  console.log('--- TEST E1-A / E1-B / E1-C: CONCURRENT AUTOMATION EVALUATIONS ---');
  const notifBeforeAutomation = await prisma.notification.count({
    where: { deviceId: deviceA.id, type: 'AUTOMATION_TRIGGERED' },
  });

  // Fire 10 concurrent processAutomationRulesForReadings calls
  console.log('[TEST E1-B] Launching 10 concurrent processAutomationRulesForReadings evaluations...');
  const evalPromises = [];
  for (let i = 0; i < 10; i++) {
    evalPromises.push(
      processAutomationRulesForReadings(deviceA.id, testUser.id, [
        {
          datastreamId: v0Stream.id,
          virtualPin: 'V0',
          value: '95',
          numericValue: 95,
        },
      ])
    );
  }

  await Promise.all(evalPromises);

  const notifAfterAutomation = await prisma.notification.count({
    where: { deviceId: deviceA.id, type: 'AUTOMATION_TRIGGERED' },
  });
  const automationNotifCount = notifAfterAutomation - notifBeforeAutomation;

  const latestV3 = await prisma.sensorData.findFirst({
    where: { deviceId: deviceA.id, datastreamId: v3Stream.id },
    orderBy: { timestamp: 'desc' },
  });

  const testE1Passed = automationNotifCount === 1 && latestV3?.value === 'true';
  console.log(`[TEST E1-A/B/C] Automation Notifications Created: ${automationNotifCount} (Expected: 1)`);
  console.log(`[TEST E1-C] Final Datastream V3 State: ${latestV3?.value} (Expected: 'true')`);
  console.log(`[TEST E1 RESULT] ${testE1Passed ? 'PASS (100% IDEMPOTENT)' : 'FAIL'}\n`);
  if (!testE1Passed) allPassed = false;

  // ------------------------------------------------------------------
  // TEST E2-A & E2-B & E2-C: CONCURRENT OFFLINE MONITOR CHECKS
  // ------------------------------------------------------------------
  console.log('--- TEST E2-A / E2-B / E2-C: CONCURRENT OFFLINE CHECKS ---');
  const notifBeforeOffline = await prisma.notification.count({
    where: { deviceId: deviceA.id, type: 'OFFLINE' },
  });

  // Simulate 10 concurrent offline heartbeat checks across simulated server instances
  console.log('[TEST E2-B] Launching 10 concurrent offline notification check transactions...');
  const offlineCheckWorker = async () => {
    await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, deviceA.id);
      const hasRecentNotif = await checkHasRecentOfflineNotification(deviceA.id, 60, tx);
      if (!hasRecentNotif) {
        await createNotification(deviceA.id, 'OFFLINE', `Device ${deviceA.name} is offline`, tx);
      }
    });
  };

  const offlinePromises = [];
  for (let i = 0; i < 10; i++) {
    offlinePromises.push(offlineCheckWorker());
  }

  await Promise.all(offlinePromises);

  const notifAfterOffline = await prisma.notification.count({
    where: { deviceId: deviceA.id, type: 'OFFLINE' },
  });
  const offlineNotifCount = notifAfterOffline - notifBeforeOffline;

  console.log(`[TEST E2-A/B] Offline Notifications Created: ${offlineNotifCount} (Expected: 1)`);

  // TEST E2-C: Subsequent offline check inside deduplication window
  console.log('[TEST E2-C] Performing subsequent offline check inside 60min window...');
  await offlineCheckWorker();

  const notifAfterSubsequent = await prisma.notification.count({
    where: { deviceId: deviceA.id, type: 'OFFLINE' },
  });
  const subsequentNotifCount = notifAfterSubsequent - notifAfterOffline;

  console.log(`[TEST E2-C] Subsequent Offline Notifications Created: ${subsequentNotifCount} (Expected: 0)`);

  const testE2Passed = offlineNotifCount === 1 && subsequentNotifCount === 0;
  console.log(`[TEST E2 RESULT] ${testE2Passed ? 'PASS (100% IDEMPOTENT)' : 'FAIL'}\n`);
  if (!testE2Passed) allPassed = false;

  // Clean up test data
  await prisma.user.delete({ where: { id: testUser.id } });

  console.log('====================================================================');
  console.log(`SUMMARY: ALL DISTRIBUTED CONCURRENCY TESTS: ${allPassed ? 'PASS (GREEN)' : 'FAIL'}`);
  console.log('====================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runTests()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Test error:', err);
    prisma.$disconnect();
    process.exit(1);
  });
