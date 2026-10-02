import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import productsRouter from './backend/routes/products.ts';
import categoriesRouter from './backend/routes/categories.ts';
import ordersRouter from './backend/routes/orders.ts';
import authRouter from './backend/routes/auth.ts';
import enquiriesRouter from './backend/routes/enquiries.ts';
import settingsRouter from './backend/routes/settings.ts';
import { db } from './backend/services/db.ts';
import { requestLogger } from './backend/middleware/logging.ts';
import { errorHandler } from './backend/middleware/errorHandler.ts';
import { logger } from './backend/utils/logger.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Production safety verification
if (isProduction && !process.env.JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET environment variable is missing in production environment!');
  process.exit(1);
}

// Basic Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Structured Request Logging Middleware
app.use(requestLogger);

// Serve static images directly
app.use('/images', express.static(path.resolve(__dirname, 'public/images')));

// API Routes
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auth', authRouter);
app.use('/api/enquiries', enquiriesRouter);
app.use('/api/settings', settingsRouter);

// Dynamic Sitemap XML (Stage 22)
app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const products = db.products.getAll();
  const categories = db.categories.getAll();
  const baseUrl = process.env.APP_URL || 'https://emergene-topgro.com';

  const xmlUrls = [
    `<url><loc>${baseUrl}/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>`,
    `<url><loc>${baseUrl}/products</loc><priority>0.9</priority><changefreq>daily</changefreq></url>`,
    `<url><loc>${baseUrl}/about</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>`,
    `<url><loc>${baseUrl}/contact</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>`,
    ...categories.map(c => `<url><loc>${baseUrl}/products?category=${encodeURIComponent(c.name)}</loc><priority>0.8</priority><changefreq>weekly</changefreq></url>`),
    ...products.map(p => `<url><loc>${baseUrl}/products/${p.slug}</loc><priority>0.7</priority><changefreq>weekly</changefreq></url>`)
  ];

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls.join('\n')}
</urlset>`;

  res.header('Content-Type', 'application/xml');
  res.send(sitemapXml);
});

// Centralized Express Error Handler for API routes
app.use('/api', errorHandler);

// Vite middleware in development vs Static files in production
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Global error handler for any remaining routes
  app.use(errorHandler);

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`EMERGENE & TOPGRO server started successfully on http://0.0.0.0:${PORT} [mode: ${process.env.NODE_ENV || 'development'}]`);
  });

  const handleShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down server gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

startServer();
