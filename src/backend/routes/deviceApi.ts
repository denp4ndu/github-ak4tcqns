import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getDeviceByTokenHash,
  getDatastreamsByDeviceId,
  ingestTelemetryAtomic,
  updateDeviceLastSeen,
} from '../db.ts';
import { hashDeviceToken } from '../auth.ts';
import { validateDatastreamValue, computeDeviceStatus } from '../services/iotService.ts';
import { processAutomationRulesForReadings } from '../services/automationEngine.ts';
import { ErrorCode, type SensorData } from '../types.ts';
import { emitSensorUpdateToUser } from '../sockets/socketManager.ts';

const router = Router();

// POST /api/device/data
// ESP32 Sensor Ingestion Endpoint
router.post('/data', async (req, res) => {
  try {
    const rawBody = req.body;
    if (!rawBody || typeof rawBody !== 'object') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON payload in request body',
      });
      return;
    }

    // 1. Extract device token (from body or X-Device-Token header)
    const deviceToken = rawBody.deviceToken || req.headers['x-device-token'];
    if (!deviceToken || typeof deviceToken !== 'string') {
      res.status(401).json({
        success: false,
        error: ErrorCode.INVALID_DEVICE_TOKEN,
        message: 'Device token is missing',
      });
      return;
    }

    // 2. Validate token hash
    const tokenHash = hashDeviceToken(deviceToken);
    const device = await getDeviceByTokenHash(tokenHash);

    if (!device) {
      console.warn(`[SECURITY] Rejected ingestion attempt with invalid token hash: ${tokenHash.slice(0, 8)}...`);
      res.status(401).json({
        success: false,
        error: ErrorCode.INVALID_DEVICE_TOKEN,
        message: 'Invalid device authentication token',
      });
      return;
    }

    // 3. Validate 'data' payload object
    const dataObj = rawBody.data;
    if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: "'data' property must be a JSON object mapping virtual pins to values",
      });
      return;
    }

    const pinKeys = Object.keys(dataObj);
    if (pinKeys.length === 0) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: "'data' object is empty; at least one datastream reading required",
      });
      return;
    }

    // 4. Retrieve registered datastreams for this device
    const registeredStreams = await getDatastreamsByDeviceId(device.id);
    const streamMap = new Map(registeredStreams.map((s) => [s.virtualPin.toUpperCase(), s]));

    // 5. Pre-validate all virtual pins before storing anything (Atomic rejection)
    const validReadingsToStore: SensorData[] = [];
    const receivedRecord: Record<string, unknown> = {};
    const timestamp = new Date().toISOString();

    for (const key of pinKeys) {
      const normalizedPin = key.toUpperCase().trim();
      const stream = streamMap.get(normalizedPin);

      // Unknown pin check
      if (!stream) {
        res.status(400).json({
          success: false,
          error: ErrorCode.UNKNOWN_VIRTUAL_PIN,
          message: `Virtual Pin '${key}' is not registered on device '${device.deviceIdentifier}'`,
        });
        return;
      }

      const rawVal = dataObj[key];
      const validation = validateDatastreamValue(stream, rawVal);

      // Datatype and range validation
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: validation.errorCode || ErrorCode.INVALID_DATA_TYPE,
          message: validation.errorMessage || 'Invalid sensor reading value',
        });
        return;
      }

      validReadingsToStore.push({
        id: crypto.randomUUID(),
        deviceId: device.id,
        datastreamId: stream.id,
        value: validation.normalizedValue!,
        numericValue: validation.numericValue ?? null,
        timestamp,
      });

      receivedRecord[stream.virtualPin] = rawVal;
    }

    // 6. Atomic Ingestion: Persist readings and update lastSeen in single transaction
    await ingestTelemetryAtomic(device.id, validReadingsToStore, timestamp);

    console.log(
      `[INGEST] Device ${device.deviceIdentifier} ingested ${validReadingsToStore.length} sensor readings at ${timestamp} via PostgreSQL`
    );

    // 6b. Real-time WebSocket Broadcast: Emit sensor_update ONLY to device owner's isolated room
    emitSensorUpdateToUser(device.userId, {
      deviceId: device.deviceIdentifier,
      timestamp,
      data: receivedRecord,
    });

    // 6c. Evaluate Automation Rules asynchronously (non-blocking for fast ingestion)
    processAutomationRulesForReadings(
      device.id,
      device.userId,
      validReadingsToStore.map((r) => ({
        datastreamId: r.datastreamId,
        virtualPin: registeredStreams.find((s) => s.id === r.datastreamId)?.virtualPin || '',
        value: r.value,
        numericValue: r.numericValue,
      }))
    ).catch((err) => {
      console.error('[AUTOMATION-ENGINE] Error processing rules for device:', device.id, err);
    });

    // 7. Return success response conforming to API contract
    res.status(200).json({
      success: true,
      message: 'Data received',
      deviceId: device.deviceIdentifier,
      received: receivedRecord,
      timestamp,
    });
  } catch (error: any) {
    console.error('Sensor ingestion internal error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Internal error processing sensor ingestion',
    });
  }
});

// POST /api/device/heartbeat
// Device keep-alive
router.post('/heartbeat', async (req, res) => {
  try {
    const rawBody = req.body || {};
    const deviceToken = rawBody.deviceToken || req.headers['x-device-token'];

    if (!deviceToken || typeof deviceToken !== 'string') {
      res.status(401).json({
        success: false,
        error: ErrorCode.INVALID_DEVICE_TOKEN,
        message: 'Device token is missing',
      });
      return;
    }

    const tokenHash = hashDeviceToken(deviceToken);
    const device = await getDeviceByTokenHash(tokenHash);

    if (!device) {
      res.status(401).json({
        success: false,
        error: ErrorCode.INVALID_DEVICE_TOKEN,
        message: 'Invalid device token',
      });
      return;
    }

    const now = new Date().toISOString();
    await updateDeviceLastSeen(device.id, now);

    res.status(200).json({
      success: true,
      status: 'ONLINE',
      deviceId: device.deviceIdentifier,
      serverTime: now,
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Failed to process heartbeat',
    });
  }
});

// GET /api/device/status
router.get('/status', async (req, res) => {
  try {
    const deviceToken = (req.query.deviceToken as string) || (req.headers['x-device-token'] as string);

    if (!deviceToken) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'deviceToken query parameter or header is required',
      });
      return;
    }

    const tokenHash = hashDeviceToken(deviceToken);
    const device = await getDeviceByTokenHash(tokenHash);

    if (!device) {
      res.status(401).json({
        success: false,
        error: ErrorCode.INVALID_DEVICE_TOKEN,
        message: 'Device token not recognized',
      });
      return;
    }

    const statusInfo = computeDeviceStatus(device.lastSeen);

    res.status(200).json({
      success: true,
      device: {
        id: device.id,
        deviceIdentifier: device.deviceIdentifier,
        name: device.name,
        status: statusInfo.status,
        lastSeen: device.lastSeen,
        secondsSinceLastSeen: statusInfo.secondsSinceLastSeen,
      },
    });
  } catch (error) {
    console.error('Device status check error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Failed to check status',
    });
  }
});

export default router;
