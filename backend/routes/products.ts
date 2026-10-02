import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../services/db.ts';
import { requireAdmin, AuthRequest } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGES_DIR = path.resolve(__dirname, '../../public/images/products');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function saveBase64Image(dataString: string, filenamePrefix: string): string {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  if (typeof dataString !== 'string' || !dataString.trim()) {
    throw new Error('Image data is empty or invalid');
  }

  let ext = 'jpg';
  let base64Content = dataString;

  const matches = dataString.match(/^data:([A-Za-z0-9\-+\/]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    const mime = matches[1].toLowerCase();
    if (!ALLOWED_MIME_EXTENSIONS[mime]) {
      throw new Error(`Unsupported image type "${mime}". Allowed formats: JPEG, PNG, WebP.`);
    }
    ext = ALLOWED_MIME_EXTENSIONS[mime];
    base64Content = matches[2];
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Content, 'base64');
  } catch (err: any) {
    throw new Error('Malformed base64 image data');
  }

  if (buffer.length === 0) {
    throw new Error('Decoded image buffer is empty');
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image size exceeds maximum limit of 5MB (size: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);
  }

  // Sanitize filename prefix to prevent directory traversal
  const cleanPrefix = filenamePrefix
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .substring(0, 50) || 'product';

  const safeName = `${cleanPrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const targetPath = path.join(IMAGES_DIR, safeName);

  try {
    fs.writeFileSync(targetPath, buffer);
  } catch (err: any) {
    logger.error(`Failed to write uploaded image to disk: ${targetPath}`, err);
    throw new Error(`Disk write failed for product image: ${err.message}`);
  }

  return `/images/products/${safeName}`;
}

// GET /api/products - public search, filter, sort, paginate
router.get('/', (req: Request, res: Response) => {
  let products = db.products.getAll();

  const { search, category, packSize, inStock, featured, sortBy, page, limit } = req.query;

  // Global search (name, category, usedFor, pack size, sku)
  if (search && typeof search === 'string') {
    const q = search.trim().toLowerCase();
    products = products.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const catMatch = p.category.toLowerCase().includes(q);
      const usedMatch = (p.usedFor || '').toLowerCase().includes(q);
      const skuMatch = (p.sku || '').toLowerCase().includes(q);
      const brandMatch = (p.brand || '').toLowerCase().includes(q);
      const sizeMatch = p.packSizes && p.packSizes.some(ps => ps.size.toLowerCase().includes(q));
      return nameMatch || catMatch || usedMatch || skuMatch || brandMatch || sizeMatch;
    });
  }

  // Category filter
  if (category && typeof category === 'string' && category !== 'All') {
    products = products.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }

  // Pack Size filter
  if (packSize && typeof packSize === 'string' && packSize !== 'All') {
    products = products.filter(p => p.packSizes && p.packSizes.some(ps => ps.size.toLowerCase().includes(packSize.toLowerCase())));
  }

  // In Stock filter
  if (inStock === 'true') {
    products = products.filter(p => p.stock > 0);
  }

  // Featured filter
  if (featured === 'true') {
    products = products.filter(p => p.featured);
  }

  // Sorting
  if (sortBy === 'name-asc') {
    products.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'name-desc') {
    products.sort((a, b) => b.name.localeCompare(a.name));
  } else if (sortBy === 'price-low') {
    products.sort((a, b) => {
      if (!a.priceAvailable) return 1;
      if (!b.priceAvailable) return -1;
      return a.startingPrice - b.startingPrice;
    });
  } else if (sortBy === 'price-high') {
    products.sort((a, b) => {
      if (!a.priceAvailable) return 1;
      if (!b.priceAvailable) return -1;
      return b.startingPrice - a.startingPrice;
    });
  } else if (sortBy === 'newest') {
    products.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    // Default catalog page order
    products.sort((a, b) => (a.catalogPage - b.catalogPage) || (a.itemOnPage - b.itemOnPage));
  }

  const total = products.length;
  const pageNum = parseInt(page as string, 10) || 1;
  const pageSize = parseInt(limit as string, 10) || 100;
  const startIndex = (pageNum - 1) * pageSize;
  const paginated = products.slice(startIndex, startIndex + pageSize);

  res.json({
    products: paginated,
    total,
    page: pageNum,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  });
});

// GET /api/products/diagnostic - Catalog diagnostic check (Admin Protected)
router.get('/diagnostic', requireAdmin, (req: Request, res: Response) => {
  const all = db.products.getAll();
  const withImages = all.filter(p => p.images && p.images.length > 0 && !p.images[0].includes('placeholder'));
  const withPrice = all.filter(p => p.priceAvailable);
  const withoutPrice = all.filter(p => !p.priceAvailable);
  const withPackSize = all.filter(p => p.packSizes && p.packSizes.length > 0);
  const withoutPackSize = all.filter(p => !p.packSizes || p.packSizes.length === 0);
  const withUsedFor = all.filter(p => p.usedFor && p.usedFor !== 'Information not available');
  const withoutUsedFor = all.filter(p => !p.usedFor || p.usedFor === 'Information not available');

  res.json({
    totalProducts: all.length,
    withImages: withImages.length,
    withPrice: withPrice.length,
    withoutPrice: withoutPrice.length,
    withPackSize: withPackSize.length,
    withoutPackSize: withoutPackSize.length,
    withUsedFor: withUsedFor.length,
    withoutUsedFor: withoutUsedFor.length,
    products: all
  });
});

// GET /api/products/:slug - Product detail (public)
router.get('/:slug', (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  const product = db.products.getBySlug(req.params.slug);
  if (!product) {
    return res.status(404).json({
      error: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
      requestId
    });
  }
  res.json(product);
});

// Admin endpoints:
// POST /api/products - Create product
router.post('/', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const created = db.products.create(req.body);
    logger.info(`Product created: ${created.name} (${created._id})`, { requestId, userId: req.user?.id });
    res.status(201).json(created);
  } catch (err: any) {
    logger.error('Failed to create product', err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to create product',
      code: 'PRODUCT_CREATE_FAILED',
      requestId
    });
  }
});

// PUT /api/products/:id - Edit product
router.put('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const updated = db.products.update(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
        requestId
      });
    }
    logger.info(`Product updated: ${updated.name} (${updated._id})`, { requestId, userId: req.user?.id });
    res.json(updated);
  } catch (err: any) {
    logger.error(`Failed to update product ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to update product',
      code: 'PRODUCT_UPDATE_FAILED',
      requestId
    });
  }
});

// POST /api/products/:id/upload-image - Upload and link image directly to product
router.post('/:id/upload-image', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const { imageBase64, imageUrl, filename, setPrimaryOnly } = req.body;
    let finalImageUrl = imageUrl;

    if (imageBase64) {
      finalImageUrl = saveBase64Image(imageBase64, filename || req.params.id);
    }

    if (!finalImageUrl) {
      return res.status(400).json({
        error: 'No image provided (provide imageBase64 or imageUrl)',
        code: 'IMAGE_MISSING',
        requestId
      });
    }

    const product = db.products.getById(req.params.id) || db.products.getBySlug(req.params.id);
    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
        requestId
      });
    }

    // Put new image first, keeping previous images as alternates
    const updatedImages = setPrimaryOnly
      ? [finalImageUrl]
      : [finalImageUrl, ...(product.images || []).filter(img => img !== finalImageUrl)];
    const updated = db.products.update(product._id, { images: updatedImages });

    logger.info(`Image uploaded for product ${product._id}: ${finalImageUrl}`, { requestId, userId: req.user?.id });

    res.json({
      success: true,
      imageUrl: finalImageUrl,
      product: updated
    });
  } catch (err: any) {
    logger.error(`Failed to upload product image for ${req.params.id}`, err, { requestId });
    res.status(400).json({
      error: err.message || 'Failed to upload image',
      code: 'IMAGE_UPLOAD_FAILED',
      requestId
    });
  }
});

// POST /api/products/batch-upload-images - Batch upload & auto-assign images from PDF
router.post('/batch-upload-images', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        error: 'Images array is required and must not be empty',
        code: 'INVALID_BATCH_PAYLOAD',
        requestId
      });
    }

    const allProducts = db.products.getAll();
    const results: Array<{ filename: string; matched: boolean; productName?: string; imageUrl?: string; error?: string }> = [];

    for (const item of images) {
      const { name, data } = item;
      const cleanBasename = path.basename(name, path.extname(name)).toLowerCase();

      const matchedProd = allProducts.find(p => {
        const slugMatch = p.slug.toLowerCase() === cleanBasename;
        const skuMatch = p.sku.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanBasename.replace(/[^a-z0-9]/g, '');
        const nameMatch = p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanBasename.replace(/[^a-z0-9]/g, '');
        return slugMatch || skuMatch || nameMatch;
      });

      if (data && typeof data === 'string' && data.startsWith('data:image')) {
        try {
          const imageUrl = saveBase64Image(data, cleanBasename);
          if (matchedProd) {
            const updatedImages = [imageUrl, ...(matchedProd.images || []).filter(img => img !== imageUrl)];
            db.products.update(matchedProd._id, { images: updatedImages });
            results.push({ filename: name, matched: true, productName: matchedProd.name, imageUrl });
          } else {
            results.push({ filename: name, matched: false, imageUrl });
          }
        } catch (imgErr: any) {
          results.push({ filename: name, matched: false, error: imgErr.message });
        }
      } else {
        results.push({ filename: name, matched: false, error: 'Invalid or unsupported image data format' });
      }
    }

    logger.info(`Batch upload processed ${images.length} images (${results.filter(r => r.matched).length} matched)`, {
      requestId,
      userId: req.user?.id
    });

    res.json({
      success: true,
      totalProcessed: images.length,
      matchedCount: results.filter(r => r.matched).length,
      results
    });
  } catch (err: any) {
    logger.error('Batch upload images failed', err, { requestId });
    res.status(500).json({
      error: err.message || 'Batch upload failed',
      code: 'BATCH_UPLOAD_FAILED',
      requestId
    });
  }
});

// DELETE /api/products/:id - Delete product
router.delete('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const success = db.products.delete(req.params.id);
    if (!success) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
        requestId
      });
    }
    logger.info(`Product deleted: ${req.params.id}`, { requestId, userId: req.user?.id });
    res.json({
      success: true,
      message: 'Product deleted successfully',
      requestId
    });
  } catch (err: any) {
    logger.error(`Failed to delete product ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to delete product',
      code: 'PRODUCT_DELETE_FAILED',
      requestId
    });
  }
});

export default router;
