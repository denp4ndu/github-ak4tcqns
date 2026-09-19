import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getDeviceById,
  getDatastreamsByDeviceId,
  getDatastreamByPin,
  getDatastreamById,
  createDatastream,
  updateDatastream,
  deleteDatastream,
} from '../db.ts';
import { requireUserAuth, type AuthRequest } from '../auth.ts';
import { ErrorCode, type DataType } from '../types.ts';

const router = Router();

const VALID_DATA_TYPES: DataType[] = ['INTEGER', 'FLOAT', 'BOOLEAN', 'STRING'];

// GET /api/devices/:deviceId/datastreams
router.get('/devices/:deviceId/datastreams', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.deviceId;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    const datastreams = await getDatastreamsByDeviceId(deviceId);
    res.status(200).json({
      success: true,
      datastreams,
    });
  } catch (error) {
    console.error('List datastreams error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to fetch datastreams',
    });
  }
});

// POST /api/devices/:deviceId/datastreams
router.post('/devices/:deviceId/datastreams', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.deviceId;
    const { virtualPin, name, dataType, unit, minValue, maxValue, description } = req.body || {};

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    // Validate virtualPin format (e.g. V0, V1, V2, etc.)
    const normalizedPin = String(virtualPin || '').toUpperCase().trim();
    if (!/^V\d+$/.test(normalizedPin)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Virtual Pin must be in the format V0, V1, V2, etc.',
      });
      return;
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Datastream name is required',
      });
      return;
    }

    if (!VALID_DATA_TYPES.includes(dataType)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Invalid dataType. Allowed: ${VALID_DATA_TYPES.join(', ')}`,
      });
      return;
    }

    // Check duplicate virtual pin
    const existing = await getDatastreamByPin(deviceId, normalizedPin);
    if (existing) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Virtual Pin ${normalizedPin} is already registered on this device`,
      });
      return;
    }

    const newDatastream = await createDatastream({
      id: crypto.randomUUID(),
      deviceId,
      virtualPin: normalizedPin,
      name: String(name).trim(),
      dataType: dataType as DataType,
      unit: unit ? String(unit).trim() : null,
      minValue: minValue !== undefined && minValue !== null && !isNaN(Number(minValue)) ? Number(minValue) : null,
      maxValue: maxValue !== undefined && maxValue !== null && !isNaN(Number(maxValue)) ? Number(maxValue) : null,
      description: description ? String(description).trim() : null,
    });

    res.status(201).json({
      success: true,
      datastream: newDatastream,
    });
  } catch (error) {
    console.error('Create datastream error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create datastream',
    });
  }
});

// PUT /api/datastreams/:id
router.put('/datastreams/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const datastreamId = req.params.id;

    const stream = await getDatastreamById(datastreamId);
    if (!stream) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Datastream not found',
      });
      return;
    }

    const device = await getDeviceById(stream.deviceId);
    if (!device || device.userId !== userId) {
      res.status(403).json({
        success: false,
        error: ErrorCode.FORBIDDEN,
        message: 'Unauthorized access to datastream',
      });
      return;
    }

    const { name, dataType, unit, minValue, maxValue, description } = req.body || {};

    if (dataType && !VALID_DATA_TYPES.includes(dataType)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Invalid dataType. Allowed: ${VALID_DATA_TYPES.join(', ')}`,
      });
      return;
    }

    await updateDatastream(datastreamId, {
      name: name !== undefined ? String(name).trim() : undefined,
      dataType: dataType || undefined,
      unit: unit !== undefined ? (unit ? String(unit).trim() : null) : undefined,
      minValue: minValue !== undefined ? (minValue !== null ? Number(minValue) : null) : undefined,
      maxValue: maxValue !== undefined ? (maxValue !== null ? Number(maxValue) : null) : undefined,
      description: description !== undefined ? (description ? String(description).trim() : null) : undefined,
    });

    const updated = await getDatastreamById(datastreamId);
    res.status(200).json({
      success: true,
      datastream: updated,
    });
  } catch (error) {
    console.error('Update datastream error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update datastream',
    });
  }
});

// DELETE /api/datastreams/:id
router.delete('/datastreams/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const datastreamId = req.params.id;

    const stream = await getDatastreamById(datastreamId);
    if (!stream) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Datastream not found',
      });
      return;
    }

    const device = await getDeviceById(stream.deviceId);
    if (!device || device.userId !== userId) {
      res.status(403).json({
        success: false,
        error: ErrorCode.FORBIDDEN,
        message: 'Unauthorized access to datastream',
      });
      return;
    }

    await deleteDatastream(datastreamId);

    res.status(200).json({
      success: true,
      message: 'Datastream deleted successfully',
    });
  } catch (error) {
    console.error('Delete datastream error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete datastream',
    });
  }
});

export default router;
