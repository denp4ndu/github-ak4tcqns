import { Router } from 'express';
import {
  getDeviceById,
  getDeviceByIdentifier,
  getDatastreamsByDeviceId,
  getLatestSensorDataForDevice,
  getHistoricalData,
} from '../db.ts';
import { requireUserAuth, type AuthRequest } from '../auth.ts';
import { computeDeviceStatus, parseRangeToCutoff } from '../services/iotService.ts';
import { ErrorCode } from '../types.ts';

const router = Router();

// GET /api/devices/:id/data
// Dashboard live summary for a device
router.get('/devices/:id/data', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    const { status, secondsSinceLastSeen } = computeDeviceStatus(device.lastSeen);
    const datastreams = await getDatastreamsByDeviceId(deviceId);
    const latestReadings = await getLatestSensorDataForDevice(deviceId);

    // Merge datastreams with their latest real sensor readings
    const streamsWithData = datastreams.map((ds) => {
      const reading = latestReadings[ds.virtualPin];
      return {
        id: ds.id,
        virtualPin: ds.virtualPin,
        name: ds.name,
        dataType: ds.dataType,
        unit: ds.unit,
        minValue: ds.minValue,
        maxValue: ds.maxValue,
        description: ds.description,
        currentValue: reading ? reading.value : null, // null indicates "No data received"
        numericValue: reading ? reading.numericValue : null,
        lastUpdated: reading ? reading.timestamp : null,
      };
    });

    res.status(200).json({
      success: true,
      device: {
        id: device.id,
        projectId: device.projectId,
        projectName: device.projectName,
        name: device.name,
        deviceIdentifier: device.deviceIdentifier,
        status,
        lastSeen: device.lastSeen,
        secondsSinceLastSeen,
      },
      datastreams: streamsWithData,
    });
  } catch (error) {
    console.error('Fetch device live data error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to fetch device data',
    });
  }
});

// GET /api/devices/:id/data/history
// Historical query endpoint: ?datastream=V0&range=1h
router.get('/devices/:id/data/history', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;
    const pin = ((req.query.datastream as string) || 'V0').toUpperCase().trim();
    const range = (req.query.range as string) || '1h';

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    const cutoffTimestamp = parseRangeToCutoff(range);
    const rawPoints = await getHistoricalData(deviceId, pin, cutoffTimestamp);

    const points = rawPoints.map((pt) => ({
      timestamp: pt.timestamp,
      value: pt.value,
      numericValue: pt.numericValue,
    }));

    res.status(200).json({
      success: true,
      deviceId: device.deviceIdentifier,
      virtualPin: pin,
      range,
      count: points.length,
      points,
    });
  } catch (error) {
    console.error('Fetch historical data error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve historical readings',
    });
  }
});

// POST /api/devices/:id/command
// User Command Dispatch Endpoint (REST Fallback / Integration)
router.post('/devices/:id/command', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;
    const { virtualPin, value } = req.body;

    if (!virtualPin || value === undefined) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Both virtualPin and value are required in request body',
      });
      return;
    }

    let device = await getDeviceById(deviceId);
    if (!device) {
      device = await getDeviceByIdentifier(deviceId) as any;
    }

    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized (Strict IDOR protection)',
      });
      return;
    }

    const { forwardCommandToDevice } = await import('../sockets/socketManager.ts');
    const result = await forwardCommandToDevice(device.id, virtualPin, value);

    res.status(200).json({
      success: true,
      message: result.isDeviceConnected
        ? 'Command routed to ESP32 WebSocket'
        : 'Command queued/dispatched (ESP32 currently disconnected)',
      deviceId: device.deviceIdentifier,
      virtualPin: virtualPin.toUpperCase().trim(),
      value,
      isDeviceOnline: result.isDeviceConnected,
    });
  } catch (error) {
    console.error('Command dispatch error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Failed to dispatch command to device',
    });
  }
});

export default router;

