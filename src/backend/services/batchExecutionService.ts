import { prisma } from '../db.ts';
import { getSocketIO } from '../sockets/socketManager.ts';
import { randomUUID } from 'node:crypto';
import { BatchStatus, BatchItemStatus } from '@prisma/client';

// In-memory scheduler map
const schedulerMap = new Map<string, NodeJS.Timeout>();

// Track active batch commands to enforce device-level security ACKs
export const batchInFlightCommands = new Map<string, string>();

// In-memory active execution controllers to signal pause/cancel
interface ExecutionControl {
  paused: boolean;
  cancelled: boolean;
}
const activeExecutions = new Map<string, ExecutionControl>();

export function getSchedulerMapSize(): number {
  return schedulerMap.size;
}

/**
 * Execute a Batch with Wave Engine, FSM, and CAS protections
 */
export async function executeBatch(batchId: string, userId: string): Promise<any> {
  // 1. Verify tenant ownership & fetch batch with items
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      project: { select: { userId: true } },
      items: { orderBy: [{ waveIndex: 'asc' }, { createdAt: 'asc' }] },
    },
  });

  if (!batch || batch.project.userId !== userId) {
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Batch not found',
    };
  }

  // 2. Validate batch constraints (max 200 items, max 10 waves)
  if (batch.items.length > 200) {
    return {
      success: false,
      error: 'BATCH_SIZE_EXCEEDED',
      message: `Batch contains ${batch.items.length} items, exceeding maximum size of 200`,
    };
  }

  const waveIndices = Array.from(new Set(batch.items.map((i) => i.waveIndex)));
  if (waveIndices.length > 10 || (waveIndices.length > 0 && Math.max(...waveIndices) >= 10)) {
    return {
      success: false,
      error: 'INVALID_WAVE_COUNT',
      message: 'Batch items exceed maximum wave count of 10',
    };
  }

  // Clear from scheduler map if it was scheduled
  if (schedulerMap.has(batchId)) {
    clearTimeout(schedulerMap.get(batchId)!);
    schedulerMap.delete(batchId);
  }

  // 3. Atomic CAS State Transition
  const casResult = await prisma.batch.updateMany({
    where: {
      id: batchId,
      status: { in: [BatchStatus.DRAFT, BatchStatus.SCHEDULED, BatchStatus.PAUSED] },
    },
    data: {
      status: BatchStatus.IN_PROGRESS,
    },
  });

  if (casResult.count === 0) {
    return {
      success: false,
      error: 'BATCH_ALREADY_RUNNING',
      message: 'Batch is already running or in an invalid state',
    };
  }

  // Initialize control flag
  const control: ExecutionControl = { paused: false, cancelled: false };
  activeExecutions.set(batchId, control);

  // Run execution asynchronously loop
  runWaveEngine(batchId, userId, control).catch((err) => {
    console.error(`[BATCH-ENGINE] Error executing batch ${batchId}:`, err);
  });

  return {
    success: true,
    status: BatchStatus.IN_PROGRESS,
  };
}

/**
 * Pause batch execution
 */
export async function pauseBatch(batchId: string, userId: string): Promise<any> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: { select: { userId: true } } },
  });

  if (!batch || batch.project.userId !== userId) {
    return { success: false, error: 'NOT_FOUND', message: 'Batch not found' };
  }

  if (batch.status !== BatchStatus.IN_PROGRESS) {
    return { success: false, error: 'INVALID_STATE', message: 'Only running batches can be paused' };
  }

  await prisma.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.PAUSED },
  });

  const control = activeExecutions.get(batchId);
  if (control) {
    control.paused = true;
  }

  return { success: true, status: BatchStatus.PAUSED };
}

/**
 * Resume paused batch execution
 */
export async function resumeBatch(batchId: string, userId: string): Promise<any> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: { select: { userId: true } } },
  });

  if (!batch || batch.project.userId !== userId) {
    return { success: false, error: 'NOT_FOUND', message: 'Batch not found' };
  }

  if (batch.status !== BatchStatus.PAUSED) {
    return { success: false, error: 'INVALID_STATE', message: 'Only paused batches can be resumed' };
  }

  const casResult = await prisma.batch.updateMany({
    where: { id: batchId, status: BatchStatus.PAUSED },
    data: { status: BatchStatus.IN_PROGRESS },
  });

  if (casResult.count === 0) {
    return { success: false, error: 'INVALID_STATE', message: 'Batch is not paused' };
  }

  const control: ExecutionControl = { paused: false, cancelled: false };
  activeExecutions.set(batchId, control);

  runWaveEngine(batchId, userId, control).catch((err) => {
    console.error(`[BATCH-ENGINE] Error resuming batch ${batchId}:`, err);
  });

  return { success: true, status: BatchStatus.IN_PROGRESS };
}

/**
 * Cancel batch execution
 */
export async function cancelBatch(batchId: string, userId: string): Promise<any> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: { select: { userId: true } } },
  });

  if (!batch || batch.project.userId !== userId) {
    return { success: false, error: 'NOT_FOUND', message: 'Batch not found' };
  }

  // Cancel timer if scheduled
  if (schedulerMap.has(batchId)) {
    clearTimeout(schedulerMap.get(batchId)!);
    schedulerMap.delete(batchId);
  }

  const control = activeExecutions.get(batchId);
  if (control) {
    control.cancelled = true;
    activeExecutions.delete(batchId);
  }

  await prisma.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.CANCELLED },
  });

  // Mark all non-terminal items as CANCELLED
  await prisma.batchItem.updateMany({
    where: {
      batchId,
      status: { in: [BatchItemStatus.PENDING, BatchItemStatus.DISPATCHED] },
    },
    data: {
      status: BatchItemStatus.CANCELLED,
    },
  });

  return { success: true, status: BatchStatus.CANCELLED };
}

/**
 * Schedule batch execution
 */
export async function scheduleBatch(batchId: string, userId: string, delayMs: number): Promise<any> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: { select: { userId: true } } },
  });

  if (!batch || batch.project.userId !== userId) {
    return { success: false, error: 'NOT_FOUND', message: 'Batch not found' };
  }

  if (batch.status !== BatchStatus.DRAFT || schedulerMap.has(batchId)) {
    return {
      success: false,
      error: 'INVALID_STATE_TRANSITION',
      message: 'Batch is already scheduled or invalid state',
    };
  }

  const targetTime = new Date(Date.now() + delayMs);

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      status: BatchStatus.SCHEDULED,
      updatedAt: targetTime,
    },
  });

  const timer = setTimeout(() => {
    schedulerMap.delete(batchId);
    executeBatch(batchId, userId).catch((err) => console.error(`[SCHEDULER] Execution failed for ${batchId}:`, err));
  }, delayMs);

  schedulerMap.set(batchId, timer);

  return { success: true, status: BatchStatus.SCHEDULED };
}

/**
 * Re-hydrate scheduled batches on startup / restart (GAP-E3)
 */
export async function rehydrateScheduledBatches(): Promise<{ total: number; executed: number; scheduled: number }> {
  const scheduledBatches = await prisma.batch.findMany({
    where: { status: BatchStatus.SCHEDULED },
    include: { project: { select: { userId: true } } },
  });

  let executedCount = 0;
  let scheduledCount = 0;

  const executionPromises: Promise<any>[] = [];

  for (const batch of scheduledBatches) {
    const delayMs = batch.updatedAt.getTime() - Date.now();

    if (delayMs <= 0) {
      // Past due: execute immediately via atomic CAS
      executedCount++;
      executionPromises.push(
        executeBatch(batch.id, batch.project.userId).catch((err) =>
          console.error(`[SCHEDULER-REHYDRATE] Execution failed for batch ${batch.id}:`, err)
        )
      );
    } else {
      // Future: recreate timer in schedulerMap if not already present
      if (!schedulerMap.has(batch.id)) {
        scheduledCount++;
        const timer = setTimeout(() => {
          schedulerMap.delete(batch.id);
          executeBatch(batch.id, batch.project.userId).catch((err) =>
            console.error(`[SCHEDULER-REHYDRATE] Future execution failed for batch ${batch.id}:`, err)
          );
        }, delayMs);
        schedulerMap.set(batch.id, timer);
      }
    }
  }

  if (executionPromises.length > 0) {
    await Promise.all(executionPromises);
  }

  console.log(`[SCHEDULER-REHYDRATE] Rehydrated ${scheduledBatches.length} scheduled batches (Executed: ${executedCount}, Timers recreated: ${scheduledCount}).`);
  return { total: scheduledBatches.length, executed: executedCount, scheduled: scheduledCount };
}

/**
 * Recover orphaned/stuck batches from process crashes/restarts (GAP-E5)
 */
export async function recoverOrphanedBatches(staleThresholdMs = 300000): Promise<{ recoveredCount: number }> {
  const staleCutoff = new Date(Date.now() - staleThresholdMs);

  // Find batches in IN_PROGRESS that haven't been updated within staleThresholdMs
  const staleBatches = await prisma.batch.findMany({
    where: {
      status: BatchStatus.IN_PROGRESS,
      updatedAt: { lte: staleCutoff },
    },
    include: { items: true },
  });

  let recoveredCount = 0;

  for (const batch of staleBatches) {
    // Mark non-terminal items (PENDING, DISPATCHED) as EXPIRED without re-sending physical commands
    await prisma.batchItem.updateMany({
      where: {
        batchId: batch.id,
        status: { in: [BatchItemStatus.PENDING, BatchItemStatus.DISPATCHED] },
        updatedAt: { lte: staleCutoff },
      },
      data: {
        status: BatchItemStatus.EXPIRED,
        errorMessage: 'Orphaned batch recovery: server process crashed during execution',
      },
    });

    // Re-query all items for the batch to compute final status
    const finalItems = await prisma.batchItem.findMany({ where: { batchId: batch.id } });
    if (finalItems.length === 0) continue;

    const executedCount = finalItems.filter((i) => i.status === BatchItemStatus.EXECUTED).length;
    const failedCount = finalItems.filter((i) => i.status === BatchItemStatus.FAILED).length;
    const expiredCount = finalItems.filter((i) => i.status === BatchItemStatus.EXPIRED).length;
    const cancelledCount = finalItems.filter((i) => i.status === BatchItemStatus.CANCELLED).length;

    let finalStatus: BatchStatus = BatchStatus.FAILED;
    if (executedCount === finalItems.length) {
      finalStatus = BatchStatus.COMPLETED;
    } else if (executedCount > 0 && (failedCount > 0 || expiredCount > 0 || cancelledCount > 0)) {
      finalStatus = BatchStatus.PARTIALLY_FAILED;
    } else {
      finalStatus = BatchStatus.FAILED;
    }

    // Atomic CAS update to reconcile parent Batch status
    const result = await prisma.batch.updateMany({
      where: { id: batch.id, status: BatchStatus.IN_PROGRESS },
      data: { status: finalStatus },
    });

    if (result.count > 0) {
      recoveredCount++;
      console.log(`[ORPHAN-RECOVERY] Successfully recovered orphaned batch ${batch.id} -> ${finalStatus}`);
    }
  }

  return { recoveredCount };
}

/**
 * Core Wave Execution Engine
 */
export async function runWaveEngine(batchId: string, userId: string, control: ExecutionControl = { paused: false, cancelled: false }) {
  const io = getSocketIO();

  // Fetch all items
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    orderBy: [{ waveIndex: 'asc' }, { createdAt: 'asc' }],
  });

  // Group by waveIndex
  const waveMap = new Map<number, typeof items>();
  for (const item of items) {
    if (!waveMap.has(item.waveIndex)) {
      waveMap.set(item.waveIndex, []);
    }
    waveMap.get(item.waveIndex)!.push(item);
  }

  const sortedWaves = Array.from(waveMap.keys()).sort((a, b) => a - b);

  for (const waveIdx of sortedWaves) {
    // GAP-E4: Re-check current Batch status in DB at wave boundary
    const latestBatch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });

    if (
      !latestBatch ||
      latestBatch.status === BatchStatus.PAUSED ||
      latestBatch.status === BatchStatus.CANCELLED ||
      latestBatch.status === BatchStatus.COMPLETED ||
      latestBatch.status === BatchStatus.FAILED ||
      latestBatch.status === BatchStatus.PARTIALLY_FAILED
    ) {
      if (latestBatch?.status === BatchStatus.PAUSED) control.paused = true;
      if (latestBatch?.status === BatchStatus.CANCELLED) control.cancelled = true;
      break;
    }

    if (control.paused || control.cancelled) break;

    const waveItems = waveMap.get(waveIdx) || [];
    // Only process items that are still PENDING
    const pendingItems = waveItems.filter((i) => i.status === BatchItemStatus.PENDING);
    if (pendingItems.length === 0) continue;

    const wavePromises = pendingItems.map(async (item) => {
      if (control.paused || control.cancelled) return;

      // GAP-E4: Re-check current Batch status in DB immediately before item dispatch
      const checkBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: { status: true },
      });

      if (!checkBatch || checkBatch.status !== BatchStatus.IN_PROGRESS) {
        if (checkBatch?.status === BatchStatus.PAUSED) control.paused = true;
        if (checkBatch?.status === BatchStatus.CANCELLED) control.cancelled = true;
        return;
      }

      // Check device connection status
      const deviceRoom = `room_device_${item.deviceId}`;
      const deviceSockets = io?.sockets.adapter.rooms.get(deviceRoom);
      const isConnected = Boolean(deviceSockets && deviceSockets.size > 0);

      if (!isConnected) {
        await prisma.batchItem.update({
          where: { id: item.id },
          data: {
            status: BatchItemStatus.FAILED,
            errorMessage: 'Device offline or not connected',
          },
        });
        return;
      }

      // Dispatch command via Socket.IO
      const commandId = randomUUID();
      batchInFlightCommands.set(commandId, item.deviceId);
      await prisma.batchItem.update({
        where: { id: item.id },
        data: { status: BatchItemStatus.DISPATCHED },
      });

      return new Promise<void>((resolve) => {
        let isResolved = false;

        const cleanup = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (io) io.off('command_ack_event', ackListener);
          batchInFlightCommands.delete(commandId);
        };

        const ackListener = async (ackPayload: any) => {
          if (ackPayload?.commandId === commandId) {
            if (isResolved) return; // Ignore duplicate ACKs
            isResolved = true;
            cleanup();

            // Atomic status transition using updateMany to guarantee no terminal state resurrection
            const isSuccess = ackPayload.status === 'SUCCESS' || ackPayload.status === 'EXECUTED';
            await prisma.batchItem.updateMany({
              where: {
                id: item.id,
                status: BatchItemStatus.DISPATCHED,
              },
              data: {
                status: isSuccess ? BatchItemStatus.EXECUTED : BatchItemStatus.FAILED,
                errorMessage: isSuccess ? null : (ackPayload.error || 'Hardware error'),
              },
            });

            resolve();
          }
        };

        const timeoutTimer = setTimeout(async () => {
          if (isResolved) return;
          isResolved = true;
          cleanup();

          // Atomic transition to EXPIRED, preventing race conditions or late ACK resurrection
          await prisma.batchItem.updateMany({
            where: {
              id: item.id,
              status: BatchItemStatus.DISPATCHED,
            },
            data: {
              status: BatchItemStatus.EXPIRED,
            },
          });

          resolve();
        }, 5000);

        if (io) {
          io.on('command_ack_event', ackListener);
          io.to(deviceRoom).emit('device_command', {
            commandId,
            virtualPin: item.virtualPin,
            value: item.value,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Fallback if io not available
          clearTimeout(timeoutTimer);
          prisma.batchItem
            .update({
              where: { id: item.id },
              data: { status: BatchItemStatus.FAILED, errorMessage: 'Socket server unavailable' },
            })
            .then(() => resolve());
        }
      });
    });

    await Promise.all(wavePromises);
  }

  activeExecutions.delete(batchId);

  // Re-check current status before calculating final state
  const currentBatch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (currentBatch?.status === BatchStatus.PAUSED || currentBatch?.status === BatchStatus.CANCELLED) {
    return;
  }

  // Calculate final batch status
  const finalItems = await prisma.batchItem.findMany({ where: { batchId } });
  const executedCount = finalItems.filter((i) => i.status === BatchItemStatus.EXECUTED).length;
  const failedCount = finalItems.filter((i) => i.status === BatchItemStatus.FAILED).length;
  const expiredCount = finalItems.filter((i) => i.status === BatchItemStatus.EXPIRED).length;

  let finalStatus: BatchStatus = BatchStatus.COMPLETED;
  if (executedCount === finalItems.length) {
    finalStatus = BatchStatus.COMPLETED;
  } else if (executedCount === 0 && (failedCount > 0 || expiredCount > 0)) {
    finalStatus = BatchStatus.FAILED;
  } else if (executedCount > 0 && (failedCount > 0 || expiredCount > 0)) {
    finalStatus = BatchStatus.PARTIALLY_FAILED;
  }

  await prisma.batch.update({
    where: { id: batchId },
    data: { status: finalStatus },
  });
}
