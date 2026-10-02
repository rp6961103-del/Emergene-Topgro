import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../services/db.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from './logging.ts';

const isProduction = process.env.NODE_ENV === 'production';

// In production, JWT_SECRET is strictly required from environment variables
if (isProduction && !process.env.JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET environment variable is missing in production!');
  throw new Error('JWT_SECRET environment variable is strictly required in production');
}

export const JWT_SECRET = process.env.JWT_SECRET || 'emergene_topgro_development_jwt_secret_2026_xyz';

export interface AuthUser {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  name: string;
}

export interface AuthRequest extends AppRequest {
  user?: AuthUser;
}

interface DecodedToken {
  id: string;
  email?: string;
  role?: string;
  name?: string;
  exp?: number;
  iat?: number;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const requestId = req.id || 'unknown';
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn('Authentication rejected: missing Authorization header', {
      requestId,
      path: req.originalUrl || req.url,
      method: req.method
    });
    return res.status(401).json({
      error: 'Authorization header is required',
      code: 'AUTH_HEADER_MISSING',
      requestId
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    logger.warn('Authentication rejected: invalid Bearer scheme', {
      requestId,
      path: req.originalUrl || req.url,
      method: req.method
    });
    return res.status(401).json({
      error: 'Invalid Authorization header format. Expected "Bearer <token>"',
      code: 'AUTH_HEADER_MALFORMED',
      requestId
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    logger.warn('Authentication rejected: empty token string', {
      requestId,
      path: req.originalUrl || req.url,
      method: req.method
    });
    return res.status(401).json({
      error: 'Authentication token is empty',
      code: 'AUTH_TOKEN_EMPTY',
      requestId
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;

    if (!decoded || !decoded.id) {
      logger.warn('Authentication rejected: token missing user id claim', {
        requestId,
        path: req.originalUrl || req.url
      });
      return res.status(401).json({
        error: 'Invalid token payload',
        code: 'AUTH_TOKEN_INVALID',
        requestId
      });
    }

    // Authoritative check against current database user
    const dbUser = db.users.findById(decoded.id);
    if (!dbUser) {
      logger.warn(`Authentication rejected: user ${decoded.id} not found in database`, {
        requestId,
        userId: decoded.id
      });
      return res.status(401).json({
        error: 'User account not found or has been deactivated',
        code: 'AUTH_USER_NOT_FOUND',
        requestId
      });
    }

    // Set verified user on request
    req.user = {
      id: dbUser._id,
      email: dbUser.email,
      role: dbUser.role,
      name: dbUser.name
    };

    logger.debug(`User authenticated successfully: ${dbUser.email} (${dbUser.role})`, {
      requestId,
      userId: dbUser._id
    });

    next();
  } catch (err: any) {
    const isExpired = err.name === 'TokenExpiredError';
    const message = isExpired
      ? 'Authentication session has expired. Please log in again.'
      : 'Authentication token is invalid or malformed';
    const code = isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID';

    logger.warn(`Authentication failed: ${err.message}`, {
      requestId,
      errorName: err.name,
      path: req.originalUrl || req.url
    });

    return res.status(401).json({
      error: message,
      code,
      requestId
    });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const proceedWithAdminCheck = () => {
    const requestId = req.id || 'unknown';

    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required for administrator access',
        code: 'AUTH_REQUIRED',
        requestId
      });
    }

    if (req.user.role !== 'admin') {
      logger.warn(`Admin access denied for user ${req.user.email} with role '${req.user.role}'`, {
        requestId,
        userId: req.user.id,
        role: req.user.role,
        path: req.originalUrl || req.url
      });
      return res.status(403).json({
        error: 'Access denied: Administrator privileges required',
        code: 'FORBIDDEN_ADMIN_REQUIRED',
        requestId
      });
    }

    next();
  };

  // If already authenticated upstream, verify admin role; otherwise authenticate first
  if (req.user) {
    proceedWithAdminCheck();
  } else {
    authenticate(req, res, () => proceedWithAdminCheck());
  }
}
