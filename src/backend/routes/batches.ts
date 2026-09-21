import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma, getProjectById } from '../db.ts';
import { requireUserAuth, type AuthRequest } from '../auth.ts';
import { ErrorCode } from '../types.ts';

const router = Router();

// POST /api/batches
router.post('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, projectId } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch name is required',
      });
      return;
    }

    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Project ID is required',
      });
      return;
    }

    // Verify project ownership
    const project = await getProjectById(projectId);
    if (!project || project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Project not found or unauthorized',
      });
      return;
    }

    // Initial status is strictly DRAFT
    const newBatch = await prisma.batch.create({
      data: {
        id: crypto.randomUUID(),
        projectId,
        name: name.trim(),
        status: 'DRAFT',
      },
    });

    res.status(201).json({
      success: true,
      batch: newBatch,
    });
  } catch (error) {
    console.error('Create batch error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to create batch',
    });
  }
});

// GET /api/batches
router.get('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const projectId = req.query.projectId as string | undefined;

    const whereClause: any = {
      project: {
        userId,
      },
    };

    if (projectId) {
      // Validate that the project actually belongs to the user
      const project = await getProjectById(projectId);
      if (!project || project.userId !== userId) {
        res.status(404).json({
          success: false,
          error: ErrorCode.VALIDATION_ERROR,
          message: 'Project not found or unauthorized',
        });
        return;
      }
      whereClause.projectId = projectId;
    }

    // Pagination - enforce maximum page size of 50
    let limit = parseInt(req.query.limit as string, 10) || 50;
    if (limit > 50 || limit <= 0) {
      limit = 50;
    }
    const page = parseInt(req.query.page as string, 10) || 1;
    const skip = Math.max(0, (page - 1) * limit);

    const total = await prisma.batch.count({ where: whereClause });
    const batches = await prisma.batch.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      batches,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('List batches error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve batches',
    });
  }
});

// GET /api/batches/:id
router.get('/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const batchId = req.params.id;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        project: {
          select: { userId: true },
        },
      },
    });

    // Indistinguishable 404 if missing or cross-tenant
    if (!batch || batch.project.userId !== userId) {
      res.status(404).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch not found or unauthorized',
      });
      return;
    }

    // Exclude the project relation to avoid revealing extra information not in standard model
    const { project, ...cleanBatch } = batch;

    res.status(200).json({
      success: true,
      batch: cleanBatch,
    });
  } catch (error) {
    console.error('Get batch error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve batch',
    });
  }
});

// PUT /api/batches/:id
router.put('/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const batchId = req.params.id;
    const { name, status } = req.body || {};

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        project: {
          select: { userId: true },
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

    // Do not allow arbitrary status transitions through CRUD PUT
    if (status !== undefined && status !== batch.status) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Status transitions are not permitted via this endpoint',
      });
      return;
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Batch name cannot be empty',
      });
      return;
    }

    const updatedBatch = await prisma.batch.update({
      where: { id: batchId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
      },
    });

    res.status(200).json({
      success: true,
      batch: updatedBatch,
    });
  } catch (error) {
    console.error('Update batch error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update batch',
    });
  }
});

// DELETE /api/batches/:id
router.delete('/:id', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const batchId = req.params.id;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        project: {
          select: { userId: true },
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

    // Do not allow destructive deletion of executing/scheduled batches
    if (batch.status === 'SCHEDULED' || batch.status === 'IN_PROGRESS' || batch.status === 'PAUSED') {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Executing or scheduled batches cannot be deleted',
      });
      return;
    }

    await prisma.batch.delete({
      where: { id: batchId },
    });

    res.status(200).json({
      success: true,
      message: 'Batch deleted successfully',
    });
  } catch (error) {
    console.error('Delete batch error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to delete batch',
    });
  }
});

// POST /api/batches/:id/execute
router.post('/:id/execute', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const { executeBatch } = await import('../services/batchExecutionService.ts');
    const userId = req.user!.id;
    const result = await executeBatch(req.params.id, userId);

    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        res.status(404).json(result);
      } else if (result.error === 'BATCH_ALREADY_RUNNING') {
        res.status(409).json(result);
      } else {
        res.status(400).json(result);
      }
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Execute batch error:', error);
    res.status(500).json({ success: false, error: ErrorCode.DATABASE_ERROR, message: 'Failed to execute batch' });
  }
});

// POST /api/batches/:id/pause
router.post('/:id/pause', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const { pauseBatch } = await import('../services/batchExecutionService.ts');
    const userId = req.user!.id;
    const result = await pauseBatch(req.params.id, userId);

    if (!result.success) {
      res.status(result.error === 'NOT_FOUND' ? 404 : 400).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Pause batch error:', error);
    res.status(500).json({ success: false, error: ErrorCode.DATABASE_ERROR, message: 'Failed to pause batch' });
  }
});

// POST /api/batches/:id/resume
router.post('/:id/resume', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const { resumeBatch } = await import('../services/batchExecutionService.ts');
    const userId = req.user!.id;
    const result = await resumeBatch(req.params.id, userId);

    if (!result.success) {
      res.status(result.error === 'NOT_FOUND' ? 404 : 400).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Resume batch error:', error);
    res.status(500).json({ success: false, error: ErrorCode.DATABASE_ERROR, message: 'Failed to resume batch' });
  }
});

// POST /api/batches/:id/cancel
router.post('/:id/cancel', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const { cancelBatch } = await import('../services/batchExecutionService.ts');
    const userId = req.user!.id;
    const result = await cancelBatch(req.params.id, userId);

    if (!result.success) {
      res.status(result.error === 'NOT_FOUND' ? 404 : 400).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Cancel batch error:', error);
    res.status(500).json({ success: false, error: ErrorCode.DATABASE_ERROR, message: 'Failed to cancel batch' });
  }
});

// POST /api/batches/:id/schedule
router.post('/:id/schedule', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const { scheduleBatch } = await import('../services/batchExecutionService.ts');
    const userId = req.user!.id;
    const delayMs = parseInt(req.body?.delayMs, 10) || 5000;
    const result = await scheduleBatch(req.params.id, userId, delayMs);

    if (!result.success) {
      res.status(result.error === 'NOT_FOUND' ? 404 : 400).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Schedule batch error:', error);
    res.status(500).json({ success: false, error: ErrorCode.DATABASE_ERROR, message: 'Failed to schedule batch' });
  }
});

export default router;
