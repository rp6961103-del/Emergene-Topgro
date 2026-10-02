import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.ts';
import { AppRequest } from './logging.ts';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = (req as AppRequest).id || 'unknown';
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const isProd = process.env.NODE_ENV === 'production';

  logger.error(
    `Unhandled error: ${err.message || 'Internal server error'}`,
    err,
    {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode
    }
  );

  const safeMessage = (isProd && statusCode === 500)
    ? 'Internal server error'
    : (err.message || 'An unexpected error occurred');

  res.status(statusCode).json({
    error: safeMessage,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    requestId
  });
}
