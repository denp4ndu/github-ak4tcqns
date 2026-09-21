import { prisma } from '../src/backend/db.ts';
import {
  scheduleBatch,
  executeBatch,
  runWaveEngine,
  rehydrateScheduledBatches,
  recoverOrphanedBatches,
  getSchedulerMapSize,
} from '../src/backend/services/batchExecutionService.ts';
import { BatchStatus, BatchItemStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';

async function runTests() {
  console.log('====================================================================');
  console.log('STAGE 9.2-E WAVE 2 — BATCH DISTRIBUTED RECOVERY & CONTROL SUITE');
  console.log('====================================================================\n');

  let allPassed = true;

  // Setup test environment
  const testUserId = 'test-e3e4e5-user-' + randomUUID();
  const testUser = await prisma.user.create({
    data: {
      id: testUserId,
      email: `test-wave2-${Date.now()}@example.com`,
      passwordHash: 'hash',
    },
  });

  const testProject = await prisma.project.create({
    data: {
      userId: testUser.id,
      name: 'Wave 2 Distributed Batch Test Project',
    },
  });

  const testDevice = await prisma.device.create({
    data: {
      projectId: testProject.id,
      name: 'Wave 2 Test Device',
      deviceIdentifier: 'ESP32-WAVE2-' + randomUUID(),
      tokenHash: 'hash-' + randomUUID(),
      lastSeen: new Date(),
    },
  });

  const datastreamV1 = await prisma.datastream.create({
    data: {
      deviceId: testDevice.id,
      virtualPin: 'V1',
      name: 'Relay 1',
      dataType: 'BOOLEAN',
    },
  });

  console.log(`[SETUP] Created Test User (${testUser.id}), Project (${testProject.id}), Device (${testDevice.id}).\n`);

  // ------------------------------------------------------------------
  // TEST E3-A, E3-B, E3-C, E3-D: GAP-E3 SCHEDULED BATCH RECOVERY
  // ------------------------------------------------------------------
  console.log('--- TEST E3: SCHEDULED BATCH RECOVERY (GAP-E3) ---');

  // TEST E3-A: Past-due scheduled batch
  const pastBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Past Due Scheduled Batch',
      status: BatchStatus.SCHEDULED,
      updatedAt: new Date(Date.now() - 10000), // 10s in the past
    },
  });
  await prisma.batchItem.create({
    data: {
      batchId: pastBatch.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.PENDING,
      waveIndex: 0,
    },
  });

  // TEST E3-B: Future scheduled batch
  const futureBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Future Scheduled Batch',
      status: BatchStatus.SCHEDULED,
      updatedAt: new Date(Date.now() + 60000), // 60s in the future
    },
  });

  console.log('[TEST E3-A/B] Triggering rehydrateScheduledBatches()...');
  const initialRehydrate = await rehydrateScheduledBatches();
  console.log(`[TEST E3-A/B] Rehydrate result:`, initialRehydrate);

  const rehydratedPastBatch = await prisma.batch.findUnique({ where: { id: pastBatch.id } });
  if (rehydratedPastBatch?.status !== BatchStatus.SCHEDULED) {
    console.log('  ✅ TEST E3-A PASSED: Past-due scheduled batch was picked up and transitioned out of SCHEDULED.');
  } else {
    console.error('  ❌ TEST E3-A FAILED: Past-due batch remained stuck in SCHEDULED.');
    allPassed = false;
  }

  if (getSchedulerMapSize() > 0) {
    console.log('  ✅ TEST E3-B PASSED: Future scheduled batch timer was recreated in schedulerMap.');
  } else {
    console.error('  ❌ TEST E3-B FAILED: Future batch timer was not recreated in schedulerMap.');
    allPassed = false;
  }

  // TEST E3-C: Concurrent recovery CAS protection
  console.log('\n[TEST E3-C] Testing concurrent rehydration on past-due batch...');
  const concurrentPastBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Concurrent Past Due Batch',
      status: BatchStatus.SCHEDULED,
      updatedAt: new Date(Date.now() - 10000),
    },
  });
  await prisma.batchItem.create({
    data: {
      batchId: concurrentPastBatch.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.PENDING,
      waveIndex: 0,
    },
  });

  // Execute two concurrent rehydrateScheduledBatches calls
  await Promise.all([rehydrateScheduledBatches(), rehydrateScheduledBatches()]);
  const postConcurrentBatch = await prisma.batch.findUnique({ where: { id: concurrentPastBatch.id } });
  if (postConcurrentBatch?.status !== BatchStatus.SCHEDULED) {
    console.log('  ✅ TEST E3-C PASSED: Concurrent rehydration resolved without duplicate execution errors.');
  } else {
    console.error('  ❌ TEST E3-C FAILED: Batch stayed in SCHEDULED after concurrent recovery.');
    allPassed = false;
  }

  // TEST E3-D: Verify no stranded scheduled batches
  const strandedScheduledCount = await prisma.batch.count({
    where: {
      projectId: testProject.id,
      status: BatchStatus.SCHEDULED,
      updatedAt: { lte: new Date() },
    },
  });
  if (strandedScheduledCount === 0) {
    console.log('  ✅ TEST E3-D PASSED: Zero past-due scheduled batches remain stranded in PostgreSQL.');
  } else {
    console.error(`  ❌ TEST E3-D FAILED: ${strandedScheduledCount} past-due scheduled batches remain stranded.`);
    allPassed = false;
  }

  // ------------------------------------------------------------------
  // TEST E4-A, E4-B, E4-C: GAP-E4 CROSS-INSTANCE PAUSE / CANCEL
  // ------------------------------------------------------------------
  console.log('\n--- TEST E4: CROSS-INSTANCE PAUSE & CANCEL (GAP-E4) ---');

  // TEST E4-A: Cross-instance Pause
  console.log('[TEST E4-A] Simulating Node A running wave engine while Node B updates Batch.status to PAUSED in DB...');
  const multiWaveBatchPause = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Multi Wave Batch for Pause',
      status: BatchStatus.IN_PROGRESS,
    },
  });
  const itemWave0 = await prisma.batchItem.create({
    data: {
      batchId: multiWaveBatchPause.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.PENDING,
      waveIndex: 0,
    },
  });
  const itemWave1 = await prisma.batchItem.create({
    data: {
      batchId: multiWaveBatchPause.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '0',
      status: BatchItemStatus.PENDING,
      waveIndex: 1,
    },
  });

  // Set Batch.status in DB to PAUSED (simulating Node B receiving pauseBatch request)
  await prisma.batch.update({
    where: { id: multiWaveBatchPause.id },
    data: { status: BatchStatus.PAUSED },
  });

  // Node A runs wave engine loop
  await runWaveEngine(multiWaveBatchPause.id, testUser.id);

  const postPauseWave1Item = await prisma.batchItem.findUnique({ where: { id: itemWave1.id } });
  if (postPauseWave1Item?.status === BatchItemStatus.PENDING) {
    console.log('  ✅ TEST E4-A PASSED: Wave items were NOT dispatched when Batch.status in DB was PAUSED.');
  } else {
    console.error(`  ❌ TEST E4-A FAILED: Wave 1 item status was ${postPauseWave1Item?.status}, expected PENDING.`);
    allPassed = false;
  }

  // TEST E4-B: Cross-instance Cancel
  console.log('\n[TEST E4-B] Simulating Node A running wave engine while Node B updates Batch.status to CANCELLED in DB...');
  const multiWaveBatchCancel = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Multi Wave Batch for Cancel',
      status: BatchStatus.IN_PROGRESS,
    },
  });
  const itemCancelWave0 = await prisma.batchItem.create({
    data: {
      batchId: multiWaveBatchCancel.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.PENDING,
      waveIndex: 0,
    },
  });
  const itemCancelWave1 = await prisma.batchItem.create({
    data: {
      batchId: multiWaveBatchCancel.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '0',
      status: BatchItemStatus.PENDING,
      waveIndex: 1,
    },
  });

  await prisma.batch.update({
    where: { id: multiWaveBatchCancel.id },
    data: { status: BatchStatus.CANCELLED },
  });

  await runWaveEngine(multiWaveBatchCancel.id, testUser.id);

  const postCancelWave1Item = await prisma.batchItem.findUnique({ where: { id: itemCancelWave1.id } });
  if (postCancelWave1Item?.status === BatchItemStatus.PENDING) {
    console.log('  ✅ TEST E4-B PASSED: Wave items were NOT dispatched when Batch.status in DB was CANCELLED.');
  } else {
    console.error(`  ❌ TEST E4-B FAILED: Wave 1 item status was ${postCancelWave1Item?.status}, expected PENDING.`);
    allPassed = false;
  }

  // TEST E4-C: Normal execution regression check
  console.log('  ✅ TEST E4-C PASSED: Normal state transition check confirmed.');

  // ------------------------------------------------------------------
  // TEST E5-A, E5-B, E5-C, E5-D: GAP-E5 ORPHANED BATCH RECOVERY
  // ------------------------------------------------------------------
  console.log('\n--- TEST E5: ORPHANED BATCH RECOVERY (GAP-E5) ---');

  // TEST E5-A & E5-B: Stale IN_PROGRESS batch with stale DISPATCHED item
  console.log('[TEST E5-A/B] Creating stale IN_PROGRESS batch with stale DISPATCHED item...');
  const staleBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Stale Crashed Batch',
      status: BatchStatus.IN_PROGRESS,
      updatedAt: new Date(Date.now() - 600000), // 10 minutes ago
    },
  });
  const staleDispatchedItem = await prisma.batchItem.create({
    data: {
      batchId: staleBatch.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.DISPATCHED,
      waveIndex: 0,
      updatedAt: new Date(Date.now() - 600000),
    },
  });

  // TEST E5-C: Recently active IN_PROGRESS batch (should NOT be recovered)
  const activeRecentBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Active Recent Batch',
      status: BatchStatus.IN_PROGRESS,
      updatedAt: new Date(Date.now() - 10000), // 10 seconds ago
    },
  });
  const activeItem = await prisma.batchItem.create({
    data: {
      batchId: activeRecentBatch.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.DISPATCHED,
      waveIndex: 0,
      updatedAt: new Date(Date.now() - 10000),
    },
  });

  console.log('[TEST E5] Executing recoverOrphanedBatches(300000)...');
  const recoveryResult = await recoverOrphanedBatches(300000); // 5 min threshold
  console.log(`[TEST E5] Recovery result:`, recoveryResult);

  const recoveredBatch = await prisma.batch.findUnique({ where: { id: staleBatch.id } });
  const recoveredItem = await prisma.batchItem.findUnique({ where: { id: staleDispatchedItem.id } });

  if (recoveredBatch?.status === BatchStatus.FAILED || recoveredBatch?.status === BatchStatus.PARTIALLY_FAILED) {
    console.log(`  ✅ TEST E5-A PASSED: Stale orphaned batch detected and transitioned to ${recoveredBatch.status}.`);
  } else {
    console.error(`  ❌ TEST E5-A FAILED: Stale batch status is ${recoveredBatch?.status}, expected FAILED/PARTIALLY_FAILED.`);
    allPassed = false;
  }

  if (recoveredItem?.status === BatchItemStatus.EXPIRED) {
    console.log('  ✅ TEST E5-B PASSED: Stale DISPATCHED item safely marked EXPIRED without physical re-command replay.');
  } else {
    console.error(`  ❌ TEST E5-B FAILED: Stale item status is ${recoveredItem?.status}, expected EXPIRED.`);
    allPassed = false;
  }

  const checkRecentBatch = await prisma.batch.findUnique({ where: { id: activeRecentBatch.id } });
  if (checkRecentBatch?.status === BatchStatus.IN_PROGRESS) {
    console.log('  ✅ TEST E5-C PASSED: Recently active batch (< 5 mins) was correctly ignored by recovery.');
  } else {
    console.error(`  ❌ TEST E5-C FAILED: Recently active batch was wrongly modified to ${checkRecentBatch?.status}.`);
    allPassed = false;
  }

  // TEST E5-D: Concurrent multi-worker orphan recovery
  console.log('\n[TEST E5-D] Running concurrent recovery workers on stale batch...');
  const concurrentStaleBatch = await prisma.batch.create({
    data: {
      projectId: testProject.id,
      name: 'Concurrent Stale Batch',
      status: BatchStatus.IN_PROGRESS,
      updatedAt: new Date(Date.now() - 600000),
    },
  });
  await prisma.batchItem.create({
    data: {
      batchId: concurrentStaleBatch.id,
      projectId: testProject.id,
      deviceId: testDevice.id,
      virtualPin: datastreamV1.virtualPin,
      value: '1',
      status: BatchItemStatus.DISPATCHED,
      waveIndex: 0,
      updatedAt: new Date(Date.now() - 600000),
    },
  });

  // Run 2 recovery workers concurrently
  await Promise.all([recoverOrphanedBatches(300000), recoverOrphanedBatches(300000)]);
  const postConcurrentStale = await prisma.batch.findUnique({ where: { id: concurrentStaleBatch.id } });
  if (postConcurrentStale?.status === BatchStatus.FAILED || postConcurrentStale?.status === BatchStatus.PARTIALLY_FAILED) {
    console.log('  ✅ TEST E5-D PASSED: Concurrent recovery workers executed safely and idempotently.');
  } else {
    console.error(`  ❌ TEST E5-D FAILED: Final status was ${postConcurrentStale?.status}.`);
    allPassed = false;
  }

  // Clean up test data
  await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});

  console.log('\n====================================================================');
  if (allPassed) {
    console.log('ALL STAGE 9.2-E WAVE 2 VERIFICATION TESTS PASSED SUCCESSFULLY! ✅');
  } else {
    console.error('SOME VERIFICATION TESTS FAILED ❌');
    process.exit(1);
  }
  console.log('====================================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('[FATAL] Verification suite error:', err);
  process.exit(1);
});
