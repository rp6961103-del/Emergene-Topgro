import { Request, Response, NextFunction } from 'express';
import { logger, generateRequestId } from '../utils/logger.ts';

export interface AppRequest extends Request {
  id?: string;
}

export function requestLogger(req: AppRequest, res: Response, next: NextFunction) {
  const incomingId = req.headers['x-request-id'];
  const requestId = (typeof incomingId === 'string' && incomingId.trim()) 
    ? incomingId.trim() 
    : generateRequestId();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    const context = {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode,
      durationMs
    };

    if (statusCode >= 500) {
      logger.error(`Request completed with server error`, undefined, context);
    } else if (statusCode >= 400) {
      logger.warn(`Request completed with client error`, context);
    } else {
      logger.info(`Request completed`, context);
    }
  });

  next();
}
