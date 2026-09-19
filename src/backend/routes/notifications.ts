import { Router } from 'express';
import { requireUserAuth, type AuthRequest } from '../auth.ts';
import { getNotificationsByUserId, markNotificationAsRead, markAllNotificationsAsRead } from '../db.ts';
import { ErrorCode } from '../types.ts';

const router = Router();

// GET /api/notifications
router.get('/', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;

    const notifications = await getNotificationsByUserId(userId, limit);

    res.status(200).json({
      success: true,
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to retrieve notifications',
    });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    await markAllNotificationsAsRead(userId);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update notifications',
    });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', requireUserAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    await markNotificationAsRead(notificationId, userId);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.DATABASE_ERROR,
      message: 'Failed to update notification',
    });
  }
});

export default router;
