import { Router, Request, Response } from 'express';
import { db } from '../services/db.ts';
import { requireAdmin, AuthRequest } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

// GET /api/settings - Public get settings
router.get('/', (_req: Request, res: Response) => {
  const settings = db.settings.get();
  res.json(settings);
});

// PUT /api/settings - Admin update settings
router.put('/', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const updated = db.settings.update(req.body);
    logger.info(`Store settings updated by admin`, { requestId, userId: req.user?.id });
    res.json(updated);
  } catch (err: any) {
    logger.error('Failed to update settings', err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to update settings',
      code: 'SETTINGS_UPDATE_FAILED',
      requestId
    });
  }
});

export default router;
