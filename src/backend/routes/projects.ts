import { Router } from 'express';
import crypto from 'node:crypto';
import {
  getProjectsByUserId,
  getProjectById,
  createProject,
  deleteProject,
  createDevice,
  createDatastream,
  getDeviceByIdentifier,
} from '../db.ts';
import { requireUserAuth, type AuthRequest, generateDeviceToken, hashDeviceToken } from '../auth.ts';
import { ErrorCode } from '../types.ts';

const router = Router();

// GET /api/projects
router.get('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projects = await getProjectsByUserId(userId);
    res.status(200).json({
      success: true,
      projects,
    });
  } catch (error) {
    console.error('Fetch projects error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve projects',
    });
  }
});

// POST /api/projects
router.post('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Project name is required',
      });
      return;
    }

    const now = new Date().toISOString();
    const newProject = await createProject({
      id: crypto.randomUUID(),
      userId,
      name: name.trim(),
      description: description ? String(description).trim() : null,
    });

    res.status(201).json({
      success: true,
      project: newProject,
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create project',
    });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = req.params.id;

    const project = await getProjectById(projectId);
    if (!project || project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.FORBIDDEN,
        message: 'Project not found or unauthorized',
      });
      return;
    }

    const success = await deleteProject(projectId, userId);
    res.status(200).json({
      success,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete project',
    });
  }
});

// POST /api/projects/seed-example
// Seeds the specification project: Smart Irrigation with ESP32 Greenhouse 01
// Strictly follows Rule: NO fake sensor readings are created.
router.post('/seed-example', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const now = new Date().toISOString();

    // 1. Create Project
    const projectId = crypto.randomUUID();
    const project = await createProject({
      id: projectId,
      userId,
      name: 'Smart Irrigation',
      description: 'Greenhouse soil and environmental monitoring with ESP32',
    });

    // 2. Create Device
    const rawToken = generateDeviceToken();
    const tokenHash = hashDeviceToken(rawToken);
    const deviceId = crypto.randomUUID();

    // Ensure unique device identifier
    let deviceIdentifier = 'ESP32-001';
    let suffix = 1;
    while (await getDeviceByIdentifier(deviceIdentifier)) {
      suffix++;
      deviceIdentifier = `ESP32-00${suffix}`;
    }

    const device = await createDevice({
      id: deviceId,
      projectId,
      name: 'ESP32 Greenhouse 01',
      deviceIdentifier,
      tokenHash,
      lastSeen: null, // Device has not sent data yet!
    });

    // 3. Create Datastreams V0, V1, V2, V3
    const datastreams = [
      {
        id: crypto.randomUUID(),
        deviceId,
        virtualPin: 'V0',
        name: 'Kelembaban Tanah',
        dataType: 'INTEGER' as const,
        unit: '%',
        minValue: 0,
        maxValue: 100,
        description: 'Soil moisture percentage from mapped analog ADC',
      },
      {
        id: crypto.randomUUID(),
        deviceId,
        virtualPin: 'V1',
        name: 'Suhu',
        dataType: 'FLOAT' as const,
        unit: '°C',
        minValue: 0,
        maxValue: 100,
        description: 'Ambient temperature',
      },
      {
        id: crypto.randomUUID(),
        deviceId,
        virtualPin: 'V2',
        name: 'ADC Soil',
        dataType: 'INTEGER' as const,
        unit: 'ADC',
        minValue: 0,
        maxValue: 4095,
        description: 'Raw ESP32 ADC Reading from GPIO 34',
      },
      {
        id: crypto.randomUUID(),
        deviceId,
        virtualPin: 'V3',
        name: 'Pompa',
        dataType: 'BOOLEAN' as const,
        unit: 'ON/OFF',
        minValue: null,
        maxValue: null,
        description: 'Water pump relay state',
      },
    ];

    const createdStreams = [];
    for (const ds of datastreams) {
      createdStreams.push(await createDatastream(ds));
    }

    res.status(201).json({
      success: true,
      message: 'Example project "Smart Irrigation" created with device and datastreams.',
      project,
      device: {
        id: device.id,
        name: device.name,
        deviceIdentifier: device.deviceIdentifier,
        status: 'OFFLINE',
        lastSeen: null,
      },
      deviceToken: rawToken, // Returned once so user can copy into ESP32!
      datastreams: createdStreams,
    });
  } catch (error) {
    console.error('Seed example error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to seed example project',
    });
  }
});

export default router;
