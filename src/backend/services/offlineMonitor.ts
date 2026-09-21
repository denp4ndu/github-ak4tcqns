import { prisma, createNotification, checkHasRecentOfflineNotification, acquireAdvisoryLock } from '../db.ts';
import { computeDeviceStatus } from './iotService.ts';
import { emitNotificationToUser } from '../sockets/socketManager.ts';

// Process-local guard to prevent concurrent overlapping processing for the same device
const processingOfflineDevices = new Set<string>();

export function startOfflineMonitor(intervalMs = 60000): NodeJS.Timeout {
  console.log('[OFFLINE-MONITOR] Started heartbeat monitoring service...');

  const monitorInterval = setInterval(async () => {
    try {
      const devices = await prisma.device.findMany({
        select: {
          id: true,
          name: true,
          deviceIdentifier: true,
          lastSeen: true,
          project: {
            select: { userId: true },
          },
        },
      });

      for (const dev of devices) {
        const lastSeenIso = dev.lastSeen ? dev.lastSeen.toISOString() : null;
        const { status } = computeDeviceStatus(lastSeenIso);
        if (status === 'OFFLINE') {
          if (processingOfflineDevices.has(dev.id)) {
            continue;
          }
          processingOfflineDevices.add(dev.id);

          try {
            await prisma.$transaction(async (tx) => {
              // Acquire PostgreSQL transaction-scoped advisory lock for this device across instances
              await acquireAdvisoryLock(tx, dev.id);

              // Check if we already sent an OFFLINE notification within the last 60 minutes
              const hasRecentNotif = await checkHasRecentOfflineNotification(dev.id, 60, tx);
              if (!hasRecentNotif) {
                const lastSeenFormatted = dev.lastSeen ? new Date(dev.lastSeen).toLocaleString('id-ID') : 'Belum pernah online';
                const message = `Perangkat '${dev.name}' (${dev.deviceIdentifier}) TERPUTUS (OFFLINE). Terakhir aktif: ${lastSeenFormatted}`;

                const notif = await createNotification(dev.id, 'OFFLINE', message, tx);
                emitNotificationToUser(dev.project.userId, dev.id, notif);

                console.log(`[OFFLINE-MONITOR] Device ${dev.deviceIdentifier} marked OFFLINE. Notification sent.`);
              }
            });
          } finally {
            processingOfflineDevices.delete(dev.id);
          }
        }
      }
    } catch (err) {
      console.error('[OFFLINE-MONITOR] Error checking device statuses:', err);
    }
  }, intervalMs);

  return monitorInterval;
}
