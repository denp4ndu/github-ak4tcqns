import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.ts';
import { requireUserAuth, type AuthRequest } from '../auth.ts';
import { ErrorCode } from '../types.ts';
import { validateDatastreamValue } from '../services/iotService.ts';

const router = Router();

// A. Create Batch Item: POST /api/batches/:batchId/items
router.post('/:batchId/items', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { batchId } = req.params;
    const { deviceId, virtualPin, value } = req.body || {};

    if (!deviceId || typeof deviceId !== 'string') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Device ID is required and must be a string',
      });
      return;
    }

    if (!virtualPin || typeof virtualPin !== 'string') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Virtual pin is required and must be a string',
      });
      return;
    }

    if (value === undefined || value === null) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Value is required',
      });
      return;
    }

    // Trace ownership: Batch -> Project -> User
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        project: {
          select: { id: true, userId: true },
        },
      },
    });

    if (!batch || batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch not found or unauthorized',
      });
      return;
    }

    // Verify batch status is strictly DRAFT
    if (batch.status !== 'DRAFT') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Items can only be created for batches in DRAFT status',
      });
      return;
    }

    // Verify device belongs to the project
    const device = await prisma.device.findFirst({
      where: { id: deviceId, projectId: batch.projectId },
    });

    if (!device) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    // Verify datastream exists for this device & virtualPin
    const datastream = await prisma.datastream.findFirst({
      where: { deviceId, virtualPin },
    });

    if (!datastream) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Datastream not found for device and virtual pin',
      });
      return;
    }

    // Validate using canonical validator
    const valResult = validateDatastreamValue(datastream as any, value);
    if (!valResult.valid) {
      res.status(400).json({
        success: false,
        error: valResult.errorCode || ErrorCode.VALIDATION_ERROR,
        message: valResult.errorMessage || 'Invalid datastream value',
      });
      return;
    }

    // Perform atomic transaction with size checking (max 200 items)
    try {
      const newItem = await prisma.$transaction(async (tx) => {
        const count = await tx.batchItem.count({
          where: { batchId, projectId: batch.projectId },
        });

        if (count >= 200) {
          throw {
            status: 400,
            error: ErrorCode.VALIDATION_ERROR,
            message: 'Batch has reached the maximum size limit of 200 items',
          };
        }

        return await tx.batchItem.create({
          data: {
            id: crypto.randomUUID(),
            batchId,
            projectId: batch.projectId,
            deviceId,
            virtualPin,
            value: valResult.normalizedValue!,
            status: 'PENDING',
            waveIndex: 0,
          },
        });
      });

      res.status(201).json({
        success: true,
        item: newItem,
      });
    } catch (txErr: any) {
      if (txErr.status) {
        res.status(txErr.status).json({
          success: false,
          error: txErr.error,
          message: txErr.message,
        });
        return;
      }
      throw txErr;
    }
  } catch (error) {
    console.error('Create batch item error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create batch item',
    });
  }
});

// B. List Batch Items: GET /api/batches/:batchId/items
router.get('/:batchId/items', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { batchId } = req.params;

    // Verify ownership
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        project: {
          select: { id: true, userId: true },
        },
      },
    });

    if (!batch || batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch not found or unauthorized',
      });
      return;
    }

    // Pagination - enforce maximum page size of 50
    let limit = parseInt(req.query.limit as string, 10) || 50;
    if (limit > 50 || limit <= 0) {
      limit = 50;
    }
    const page = parseInt(req.query.page as string, 10) || 1;
    const skip = Math.max(0, (page - 1) * limit);

    const total = await prisma.batchItem.count({
      where: { batchId, projectId: batch.projectId },
    });

    const items = await prisma.batchItem.findMany({
      where: { batchId, projectId: batch.projectId },
      skip,
      take: limit,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    res.status(200).json({
      success: true,
      items,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('List batch items error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve batch items',
    });
  }
});

// C. Get Single Batch Item: GET /api/batches/:batchId/items/:itemId
router.get('/:batchId/items/:itemId', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { batchId, itemId } = req.params;

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: {
        batch: {
          include: {
            project: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!item || item.batchId !== batchId || item.batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch item not found or unauthorized',
      });
      return;
    }

    // Remove the nested batch reference to match clean model
    const { batch, ...cleanItem } = item;

    res.status(200).json({
      success: true,
      item: cleanItem,
    });
  } catch (error) {
    console.error('Get batch item error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve batch item',
    });
  }
});

// D. Update Batch Item: PUT /api/batches/:batchId/items/:itemId
router.put('/:batchId/items/:itemId', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { batchId, itemId } = req.params;
    const { deviceId, virtualPin, value } = req.body || {};

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: {
        batch: {
          include: {
            project: {
              select: { id: true, userId: true },
            },
          },
        },
      },
    });

    if (!item || item.batchId !== batchId || item.batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch item not found or unauthorized',
      });
      return;
    }

    // Verify batch status is strictly DRAFT
    if (item.batch.status !== 'DRAFT') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch items can only be updated for batches in DRAFT status',
      });
      return;
    }

    const targetDeviceId = deviceId !== undefined ? deviceId : item.deviceId;
    const targetVirtualPin = virtualPin !== undefined ? virtualPin : item.virtualPin;
    const targetValue = value !== undefined ? value : item.value;

    // Verify device belongs to project
    const device = await prisma.device.findFirst({
      where: { id: targetDeviceId, projectId: item.batch.projectId },
    });

    if (!device) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Device not found or unauthorized in the project',
      });
      return;
    }

    // Verify datastream exists for this device & virtual pin
    const datastream = await prisma.datastream.findFirst({
      where: { deviceId: targetDeviceId, virtualPin: targetVirtualPin },
    });

    if (!datastream) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Datastream not found for device and virtual pin',
      });
      return;
    }

    // Run validate datastream value
    const valResult = validateDatastreamValue(datastream as any, targetValue);
    if (!valResult.valid) {
      res.status(400).json({
        success: false,
        error: valResult.errorCode || ErrorCode.VALIDATION_ERROR,
        message: valResult.errorMessage || 'Invalid datastream value',
      });
      return;
    }

    const updatedItem = await prisma.batchItem.update({
      where: { id: itemId },
      data: {
        deviceId: targetDeviceId,
        virtualPin: targetVirtualPin,
        value: valResult.normalizedValue!,
      },
    });

    res.status(200).json({
      success: true,
      item: updatedItem,
    });
  } catch (error) {
    console.error('Update batch item error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update batch item',
    });
  }
});

// E. Delete Batch Item: DELETE /api/batches/:batchId/items/:itemId
router.delete('/:batchId/items/:itemId', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { batchId, itemId } = req.params;

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: {
        batch: {
          include: {
            project: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!item || item.batchId !== batchId || item.batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch item not found or unauthorized',
      });
      return;
    }

    // Verify batch status is strictly DRAFT
    if (item.batch.status !== 'DRAFT') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch items can only be deleted for batches in DRAFT status',
      });
      return;
    }

    await prisma.batchItem.delete({
      where: { id: itemId },
    });

    res.status(200).json({
      success: true,
      message: 'Batch item deleted successfully',
    });
  } catch (error) {
    console.error('Delete batch item error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete batch item',
    });
  }
});

export default router;
