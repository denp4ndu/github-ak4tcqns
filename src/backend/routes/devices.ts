import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getDevicesByUserId,
  getDeviceById,
  getDeviceByIdentifier,
  getProjectById,
  createDevice,
  deleteDevice,
  updateDeviceToken,
  getDatastreamsByDeviceId,
  getWidgetsByDeviceId,
  saveDeviceLayout,
  getAutomationRulesByDeviceId,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
  getSensorDataForExport,
} from '../db.ts';
import { requireUserAuth, type AuthRequest, generateDeviceToken, hashDeviceToken } from '../auth.ts';
import { computeDeviceStatus } from '../services/iotService.ts';
import { ErrorCode, type WidgetType, type WidgetInput } from '../types.ts';

const router = Router();

// GET /api/devices
router.get('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = req.query.projectId as string | undefined;

    const rawDevices = await getDevicesByUserId(userId, projectId);
    const devices = rawDevices.map((dev) => {
      const { status, secondsSinceLastSeen } = computeDeviceStatus(dev.lastSeen);
      return {
        id: dev.id,
        projectId: dev.projectId,
        projectName: dev.projectName,
        name: dev.name,
        deviceIdentifier: dev.deviceIdentifier,
        lastSeen: dev.lastSeen,
        status,
        secondsSinceLastSeen,
        datastreamCount: dev.datastreamCount,
        createdAt: dev.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      devices,
    });
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to fetch devices',
    });
  }
});

// POST /api/devices
router.post('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { projectId, name, deviceIdentifier } = req.body || {};

    if (!projectId || !name || !deviceIdentifier) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Project ID, Device Name, and Device Identifier are required',
      });
      return;
    }

    // Verify project belongs to user
    const project = await getProjectById(String(projectId));
    if (!project || project.userId !== userId) {
      res.status(403).json({
        success: false,
        error: ErrorCode.FORBIDDEN,
        message: 'Project does not exist or unauthorized',
      });
      return;
    }

    // Check unique device identifier
    const existing = await getDeviceByIdentifier(String(deviceIdentifier).trim());
    if (existing) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Device identifier '${deviceIdentifier}' is already registered`,
      });
      return;
    }

    // Generate secure device token and hash
    const rawToken = generateDeviceToken();
    const tokenHash = hashDeviceToken(rawToken);

    const newDevice = await createDevice({
      id: crypto.randomUUID(),
      projectId: String(projectId),
      name: String(name).trim(),
      deviceIdentifier: String(deviceIdentifier).trim(),
      tokenHash,
      lastSeen: null,
    });

    res.status(201).json({
      success: true,
      device: {
        id: newDevice.id,
        projectId: newDevice.projectId,
        name: newDevice.name,
        deviceIdentifier: newDevice.deviceIdentifier,
        lastSeen: null,
        status: 'OFFLINE',
        createdAt: newDevice.createdAt,
      },
      deviceToken: rawToken, // Displayed once for user to configure ESP32 firmware
    });
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create device',
    });
  }
});

// GET /api/devices/:id
router.get('/:id', requireUserAuth, async (req: AuthRequest, res) => {
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

    res.status(200).json({
      success: true,
      device: {
        id: device.id,
        projectId: device.projectId,
        projectName: device.projectName,
        name: device.name,
        deviceIdentifier: device.deviceIdentifier,
        lastSeen: device.lastSeen,
        status,
        secondsSinceLastSeen,
        createdAt: device.createdAt,
      },
      datastreams,
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to fetch device details',
    });
  }
});

// DELETE /api/devices/:id
router.delete('/:id', requireUserAuth, async (req: AuthRequest, res) => {
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

    await deleteDevice(deviceId);

    res.status(200).json({
      success: true,
      message: 'Device deleted successfully',
    });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete device',
    });
  }
});

// POST /api/devices/:id/regenerate-token
router.post('/:id/regenerate-token', requireUserAuth, async (req: AuthRequest, res) => {
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

    const newRawToken = generateDeviceToken();
    const newTokenHash = hashDeviceToken(newRawToken);

    await updateDeviceToken(deviceId, newTokenHash);

    res.status(200).json({
      success: true,
      message: 'Device token regenerated successfully. Previous token has been invalidated.',
      deviceToken: newRawToken,
    });
  } catch (error) {
    console.error('Regenerate token error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to regenerate device token',
    });
  }
});

// =========================================================================
// PHASE 4: DASHBOARD BUILDER LAYOUT CRUD ENDPOINTS
// =========================================================================

// GET /api/devices/:id/dashboard/layout
router.get('/:id/dashboard/layout', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;
    console.log(`[API] GET /devices/${deviceId}/dashboard/layout received for userId: ${userId}`);

    // Strict Authorization & IDOR protection
    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    const widgets = await getWidgetsByDeviceId(deviceId);
    console.log(`[API] GET /devices/${deviceId}/dashboard/layout returning ${widgets.length} widgets`);

    res.status(200).json({
      success: true,
      deviceId,
      widgets,
    });
  } catch (error) {
    console.error('Get dashboard layout error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to fetch dashboard layout',
    });
  }
});

// PUT /api/devices/:id/dashboard/layout
router.put('/:id/dashboard/layout', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;
    console.log(`[API] PUT /devices/${deviceId}/dashboard/layout received for userId: ${userId}`);

    // Strict Authorization & IDOR protection
    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found or unauthorized',
      });
      return;
    }

    // Accepts either { widgets: [...] } or direct array [...]
    const rawWidgets = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.widgets)
      ? req.body.widgets
      : null;

    if (!rawWidgets) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Payload must contain a "widgets" array',
      });
      return;
    }
    console.log(`[API] PUT /devices/${deviceId}/dashboard/layout received ${rawWidgets.length} raw widgets`);

    // Verify all datastreams belong to this device
    const deviceDatastreams = await getDatastreamsByDeviceId(deviceId);
    const validDatastreamIds = new Set(deviceDatastreams.map((d) => d.id));
    const validTypes: Set<WidgetType> = new Set(['VALUE_CARD', 'GAUGE', 'LIVE_CHART', 'SWITCH']);

    const cleanedWidgets: WidgetInput[] = [];
    for (const [index, w] of rawWidgets.entries()) {
      if (!w || typeof w !== 'object') {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: `Widget item at index ${index} is invalid`,
        });
        return;
      }

      if (!validDatastreamIds.has(w.datastreamId)) {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: `Datastream ID '${w.datastreamId}' at index ${index} does not belong to device '${device.name}'`,
        });
        return;
      }

      if (!validTypes.has(w.type)) {
        res.status(400).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: `Widget type '${w.type}' at index ${index} is invalid. Supported: VALUE_CARD, GAUGE, LIVE_CHART, SWITCH`,
        });
        return;
      }

      cleanedWidgets.push({
        id: typeof w.id === 'string' && w.id ? w.id : crypto.randomUUID(),
        datastreamId: w.datastreamId,
        type: w.type as WidgetType,
        x: Math.max(0, parseInt(w.x, 10) || 0),
        y: Math.max(0, parseInt(w.y, 10) || 0),
        w: Math.max(1, parseInt(w.w, 10) || 1),
        h: Math.max(1, parseInt(w.h, 10) || 1),
        title: typeof w.title === 'string' && w.title.trim() ? w.title.trim() : 'Widget',
      });
    }

    console.log(`[API] PUT /devices/${deviceId}/dashboard/layout validated ${cleanedWidgets.length} widgets`);

    // Atomically persist to PostgreSQL
    const savedWidgets = await saveDeviceLayout(deviceId, cleanedWidgets);
    console.log(`[API] PUT /devices/${deviceId}/dashboard/layout successfully saved ${savedWidgets.length} widgets`);

    res.status(200).json({
      success: true,
      message: 'Dashboard layout saved successfully',
      deviceId,
      widgets: savedWidgets,
    });
  } catch (error) {
    console.error('Save dashboard layout error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to persist dashboard layout',
    });
  }
});

// ==========================================
// AUTOMATION RULES API
// ==========================================

// GET /api/devices/:id/rules - List automation rules for device
router.get('/:id/rules', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found',
      });
      return;
    }

    const rules = await getAutomationRulesByDeviceId(deviceId);

    res.status(200).json({
      success: true,
      rules,
    });
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve automation rules',
    });
  }
});

// POST /api/devices/:id/rules - Create new automation rule
router.post('/:id/rules', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found',
      });
      return;
    }

    const { name, conditionDatastreamId, operator, conditionValue, actionDatastreamId, actionValue, isActive } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Rule name is required',
      });
      return;
    }

    if (!conditionDatastreamId || !actionDatastreamId) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'conditionDatastreamId and actionDatastreamId are required',
      });
      return;
    }

    const validOperators = ['>', '<', '==', '!=', '>=', '<='];
    if (!validOperators.includes(operator)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: `Operator must be one of: ${validOperators.join(', ')}`,
      });
      return;
    }

    const datastreams = await getDatastreamsByDeviceId(deviceId);
    const dsIds = new Set(datastreams.map((d) => d.id));

    if (!dsIds.has(conditionDatastreamId) || !dsIds.has(actionDatastreamId)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Selected datastreams must belong to this device',
      });
      return;
    }

    const createdRule = await createAutomationRule(deviceId, {
      name: name.trim(),
      conditionDatastreamId,
      operator,
      conditionValue: parseFloat(conditionValue) || 0,
      actionDatastreamId,
      actionValue: String(actionValue ?? 'true'),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    res.status(201).json({
      success: true,
      message: 'Automation rule created successfully',
      rule: createdRule,
    });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create automation rule',
    });
  }
});

// PUT /api/devices/:id/rules/:ruleId - Update automation rule
router.put('/:id/rules/:ruleId', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id: deviceId, ruleId } = req.params;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found',
      });
      return;
    }

    const { name, conditionDatastreamId, operator, conditionValue, actionDatastreamId, actionValue, isActive } = req.body || {};

    const updatedRule = await updateAutomationRule(ruleId, {
      ...(name ? { name } : {}),
      ...(conditionDatastreamId ? { conditionDatastreamId } : {}),
      ...(operator ? { operator } : {}),
      ...(conditionValue !== undefined ? { conditionValue: parseFloat(conditionValue) } : {}),
      ...(actionDatastreamId ? { actionDatastreamId } : {}),
      ...(actionValue !== undefined ? { actionValue: String(actionValue) } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
    });

    res.status(200).json({
      success: true,
      message: 'Automation rule updated',
      rule: updatedRule,
    });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update automation rule',
    });
  }
});

// DELETE /api/devices/:id/rules/:ruleId - Delete automation rule
router.delete('/:id/rules/:ruleId', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id: deviceId, ruleId } = req.params;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found',
      });
      return;
    }

    await deleteAutomationRule(ruleId);

    res.status(200).json({
      success: true,
      message: 'Automation rule deleted',
    });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete automation rule',
    });
  }
});

// ==========================================
// CSV DATA EXPORT API
// ==========================================

// GET /api/devices/:id/export - Download telemetry in CSV format
router.get('/:id/export', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.id;

    const device = await getDeviceById(deviceId);
    if (!device || device.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.DEVICE_NOT_FOUND,
        message: 'Device not found',
      });
      return;
    }

    const startTime = req.query.start as string | undefined;
    const endTime = req.query.end as string | undefined;
    const datastreamId = req.query.datastreamId as string | undefined;

    const data = await getSensorDataForExport(deviceId, startTime, endTime, datastreamId);

    // Build CSV string
    const csvRows = [
      ['Timestamp', 'Device Name', 'Device Identifier', 'Virtual Pin', 'Datastream Name', 'Value', 'Unit'].join(','),
    ];

    for (const item of data) {
      const cleanVal = String(item.value).replace(/"/g, '""');
      const cleanDsName = String(item.datastreamName).replace(/"/g, '""');
      const cleanDevName = String(item.deviceName).replace(/"/g, '""');

      csvRows.push(
        [
          `"${item.timestamp}"`,
          `"${cleanDevName}"`,
          `"${item.deviceIdentifier}"`,
          `"${item.virtualPin}"`,
          `"${cleanDsName}"`,
          `"${cleanVal}"`,
          `"${item.unit}"`,
        ].join(',')
      );
    }

    const csvContent = csvRows.join('\n');
    const filename = `ESP32_${device.deviceIdentifier}_export_${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('CSV Export error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to generate CSV export',
    });
  }
});

export default router;
