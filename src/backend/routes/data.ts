import { Router } from 'express';
import {
  getDeviceById,
  getDeviceByIdentifier,
  getDatastreamsByDeviceId,
  getLatestSensorDataForDevice,
  getHistoricalData,
  prisma,
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
// Historical query endpoint: ?datastream=V0&range=1h&resolution=auto&aggregate=avg&format=json
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

    // Validate custom start/end if present
    const startParam = req.query.start as string;
    const endParam = req.query.end as string;

    let rangeStartMs = 0;
    let rangeEndMs = 0;
    let computedRangeLabel = range;

    if (startParam || endParam) {
      if (!startParam || !endParam) {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Both start and end parameters must be provided for a custom range query.',
        });
        return;
      }

      const startDate = new Date(startParam);
      const endDate = new Date(endParam);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid start or end ISO-8601 date string format.',
        });
        return;
      }

      if (startDate.getTime() >= endDate.getTime()) {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Start timestamp must be strictly before end timestamp.',
        });
        return;
      }

      const resParam = req.query.resolution as string;
      if (!resParam || resParam === 'auto') {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Custom date ranges require specifying an explicit resolution (auto is not allowed).',
        });
        return;
      }

      rangeStartMs = startDate.getTime();
      rangeEndMs = endDate.getTime();
      computedRangeLabel = 'custom';
    } else {
      // Validate named range
      if (range !== '1h' && range !== '24h' && range !== '7d' && range !== '30d') {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid range query parameter. Allowed: 1h, 24h, 7d, 30d.',
        });
        return;
      }

      rangeEndMs = Date.now();
      let durationMs = 3600 * 1000;
      if (range === '24h') durationMs = 24 * 3600 * 1000;
      else if (range === '7d') durationMs = 7 * 24 * 3600 * 1000;
      else if (range === '30d') durationMs = 30 * 24 * 3600 * 1000;

      rangeStartMs = rangeEndMs - durationMs;
    }

    let resolution = (req.query.resolution as string || 'auto').toLowerCase();
    let bucketDurationMs = 0;

    if (resolution === 'auto') {
      if (computedRangeLabel === 'custom') {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Custom date ranges require specifying an explicit resolution (auto is not allowed).',
        });
        return;
      }
      if (range === '1h') {
        resolution = '1m';
        bucketDurationMs = 60 * 1000;
      } else if (range === '24h') {
        resolution = '15m';
        bucketDurationMs = 15 * 60 * 1000;
      } else if (range === '7d') {
        resolution = '1h';
        bucketDurationMs = 3600 * 1000;
      } else if (range === '30d') {
        resolution = '1d';
        bucketDurationMs = 24 * 3600 * 1000;
      }
    } else {
      // Explicit resolution mapping
      if (resolution === '1m') {
        bucketDurationMs = 60 * 1000;
      } else if (resolution === '5m') {
        bucketDurationMs = 5 * 60 * 1000;
      } else if (resolution === '15m') {
        bucketDurationMs = 15 * 60 * 1000;
      } else if (resolution === '1h') {
        bucketDurationMs = 3600 * 1000;
      } else if (resolution === '1d') {
        bucketDurationMs = 24 * 3600 * 1000;
      } else if (resolution === 'raw') {
        bucketDurationMs = 0;
      } else {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid resolution query parameter. Allowed: auto, 1m, 5m, 15m, 1h, 1d, raw.',
        });
        return;
      }
    }

    const aggregate = (req.query.aggregate as string || 'avg').toLowerCase();
    if (aggregate !== 'avg' && aggregate !== 'min' && aggregate !== 'max' && aggregate !== 'sum' && aggregate !== 'count') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid aggregate query parameter. Allowed: avg, min, max, sum, count.',
      });
      return;
    }

    const format = (req.query.format as string || 'json').toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid format query parameter. Allowed: json, csv.',
      });
      return;
    }

    const datastream = await prisma.datastream.findUnique({
      where: {
        deviceId_virtualPin: {
          deviceId,
          virtualPin: pin,
        },
      },
    });

    let totalCount = 0;
    if (datastream) {
      totalCount = await prisma.sensorData.count({
        where: {
          deviceId,
          datastreamId: datastream.id,
          timestamp: {
            gte: new Date(rangeStartMs),
            lt: new Date(rangeEndMs),
          },
        },
      });
    }

    const MAX_RAW_ANALYTICS_RECORDS = 500000;
    if (totalCount > MAX_RAW_ANALYTICS_RECORDS) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `The requested historical dataset contains ${totalCount} records, which exceeds the analytics safety limit of ${MAX_RAW_ANALYTICS_RECORDS} raw records. Please specify a narrower time range or aggregate resolution.`,
      });
      return;
    }

    let bucketCount = 0;
    const buckets: { timestamp: string; sum: number; count: number; min: number; max: number; booleanActiveCount: number }[] = [];

    if (resolution !== 'raw') {
      bucketCount = Math.ceil((rangeEndMs - rangeStartMs) / bucketDurationMs);
      for (let i = 0; i < bucketCount; i++) {
        const bucketStartMs = rangeStartMs + i * bucketDurationMs;
        buckets.push({
          timestamp: new Date(bucketStartMs).toISOString(),
          sum: 0,
          count: 0,
          min: Infinity,
          max: -Infinity,
          booleanActiveCount: 0,
        });
      }
    }

    let globalCount = 0;
    let globalMean = 0;
    let globalM2 = 0;
    let globalMin = Infinity;
    let globalMax = -Infinity;

    function accumulateGlobal(x: number) {
      globalCount++;
      const delta = x - globalMean;
      globalMean += delta / globalCount;
      const delta2 = x - globalMean;
      globalM2 += delta * delta2;

      if (x < globalMin) globalMin = x;
      if (x > globalMax) globalMax = x;
    }

    const rawPointsOutput: { timestamp: string; value: string; numericValue: number | null }[] = [];

    if (datastream && totalCount > 0) {
      const BATCH_SIZE = 20000;
      let hasMore = true;
      let lastTimestamp: Date | null = null;
      let lastId: string | null = null;

      while (hasMore) {
        const queryWhere: any = {
          deviceId,
          datastreamId: datastream.id,
          timestamp: {
            gte: new Date(rangeStartMs),
            lt: new Date(rangeEndMs),
          },
        };

        if (lastTimestamp !== null && lastId !== null) {
          queryWhere.OR = [
            {
              timestamp: {
                gt: lastTimestamp,
              },
            },
            {
              timestamp: lastTimestamp,
              id: {
                gt: lastId,
              },
            },
          ];
        }

        const batch = await prisma.sensorData.findMany({
          where: queryWhere,
          orderBy: [
            { timestamp: 'asc' },
            { id: 'asc' },
          ],
          take: BATCH_SIZE,
          select: {
            id: true,
            timestamp: true,
            value: true,
            numericValue: true,
          },
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of batch) {
          let numVal: number | null = null;
          if (row.numericValue !== null) {
            numVal = row.numericValue;
          } else {
            const normalizedVal = row.value.trim().toLowerCase();
            if (normalizedVal === 'true' || normalizedVal === '1') {
              numVal = 1;
            } else if (normalizedVal === 'false' || normalizedVal === '0') {
              numVal = 0;
            } else {
              const parsed = parseFloat(normalizedVal);
              if (!isNaN(parsed)) {
                numVal = parsed;
              }
            }
          }

          if (numVal !== null) {
            accumulateGlobal(numVal);

            if (resolution !== 'raw') {
              const sampleMs = row.timestamp.getTime();
              const bucketIndex = Math.floor((sampleMs - rangeStartMs) / bucketDurationMs);
              if (bucketIndex >= 0 && bucketIndex < bucketCount) {
                const bucket = buckets[bucketIndex];
                bucket.sum += numVal;
                bucket.count += 1;
                if (numVal < bucket.min) bucket.min = numVal;
                if (numVal > bucket.max) bucket.max = numVal;
                if (numVal === 1) bucket.booleanActiveCount += 1;
              }
            } else {
              rawPointsOutput.push({
                timestamp: row.timestamp.toISOString(),
                value: row.value,
                numericValue: numVal,
              });
            }
          }
        }

        const lastRow = batch[batch.length - 1];
        lastTimestamp = lastRow.timestamp;
        lastId = lastRow.id;

        if (batch.length < BATCH_SIZE) {
          hasMore = false;
        }
      }
    }

    const stats = {
      min: globalCount > 0 ? globalMin : null,
      max: globalCount > 0 ? globalMax : null,
      avg: globalCount > 0 ? globalMean : null,
      stdDev: globalCount > 0 ? Math.sqrt(globalM2 / globalCount) : null,
    };

    let finalData: any[] = [];
    if (resolution !== 'raw') {
      finalData = buckets.map((bucket) => {
        let val: number | null = null;
        if (bucket.count > 0) {
          switch (aggregate) {
            case 'min':
              if (datastream && datastream.dataType === 'BOOLEAN') {
                val = bucket.min === 0 ? 0 : 1;
              } else {
                val = bucket.min;
              }
              break;
            case 'max':
              if (datastream && datastream.dataType === 'BOOLEAN') {
                val = bucket.max === 1 ? 1 : 0;
              } else {
                val = bucket.max;
              }
              break;
            case 'sum':
              if (datastream && datastream.dataType === 'BOOLEAN') {
                val = bucket.booleanActiveCount;
              } else {
                val = bucket.sum;
              }
              break;
            case 'count':
              val = bucket.count;
              break;
            case 'avg':
            default:
              if (datastream && datastream.dataType === 'BOOLEAN') {
                val = bucket.booleanActiveCount / bucket.count;
              } else {
                val = bucket.sum / bucket.count;
              }
              break;
          }
        }

        return {
          timestamp: bucket.timestamp,
          value: val !== null ? String(val) : null,
          numericValue: val,
          count: bucket.count,
        };
      });
    }

    if (format === 'csv') {
      let csvContent = 'Timestamp UTC,VirtualPin,Value,NumericValue,BucketCount\n';
      if (resolution !== 'raw') {
        for (const bucket of finalData) {
          csvContent += `${bucket.timestamp},${pin},${bucket.value !== null ? bucket.value : ''},${bucket.numericValue !== null ? bucket.numericValue : ''},${bucket.count}\n`;
        }
      } else {
        for (const pt of rawPointsOutput) {
          csvContent += `${pt.timestamp},${pin},${pt.value},${pt.numericValue !== null ? pt.numericValue : ''},1\n`;
        }
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="device_${device.deviceIdentifier}_pin_${pin}_range_${computedRangeLabel}_res_${resolution}.csv"`);
      return res.status(200).send(csvContent);
    }

    const output = resolution !== 'raw' ? finalData : rawPointsOutput;

    res.status(200).json({
      success: true,
      deviceId: device.deviceIdentifier,
      datastream: pin,
      range: {
        start: new Date(rangeStartMs).toISOString(),
        end: new Date(rangeEndMs).toISOString(),
      },
      resolution,
      aggregate,
      totalCount,
      bucketCount: output.length,
      stats,
      data: output,
      points: output,
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

