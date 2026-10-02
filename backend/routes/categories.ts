import { Router, Request, Response } from 'express';
import { db } from '../services/db.ts';
import { requireAdmin, AuthRequest } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

// GET /api/categories - public
router.get('/', (_req: Request, res: Response) => {
  const categories = db.categories.getAll();
  const products = db.products.getAll();

  // Dynamic count of products in each category
  const categoriesWithCount = categories.map(cat => ({
    ...cat,
    count: products.filter(p => p.category.toLowerCase() === cat.name.toLowerCase()).length
  }));

  res.json(categoriesWithCount);
});

// POST /api/categories - Admin add
router.post('/', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Category name is required',
        code: 'VALIDATION_ERROR',
        requestId
      });
    }

    const created = db.categories.create(req.body);
    logger.info(`Category created: ${created.name} (${created.id})`, { requestId, userId: req.user?.id });
    res.status(201).json(created);
  } catch (err: any) {
    logger.error('Failed to create category', err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to create category',
      code: 'CATEGORY_CREATE_FAILED',
      requestId
    });
  }
});

// PUT /api/categories/:id - Admin edit
router.put('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const updated = db.categories.update(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: 'Category not found',
        code: 'CATEGORY_NOT_FOUND',
        requestId
      });
    }
    logger.info(`Category updated: ${updated.name} (${updated.id})`, { requestId, userId: req.user?.id });
    res.json(updated);
  } catch (err: any) {
    logger.error(`Failed to update category ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to update category',
      code: 'CATEGORY_UPDATE_FAILED',
      requestId
    });
  }
});

// DELETE /api/categories/:id - Admin delete
router.delete('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const success = db.categories.delete(req.params.id);
    if (!success) {
      return res.status(404).json({
        error: 'Category not found',
        code: 'CATEGORY_NOT_FOUND',
        requestId
      });
    }
    logger.info(`Category deleted: ${req.params.id}`, { requestId, userId: req.user?.id });
    res.json({
      success: true,
      message: 'Category deleted successfully',
      requestId
    });
  } catch (err: any) {
    logger.error(`Failed to delete category ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to delete category',
      code: 'CATEGORY_DELETE_FAILED',
      requestId
    });
  }
});

export default router;
