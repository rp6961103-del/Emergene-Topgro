import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../services/db.ts';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

function generateToken(user: { _id: string; email: string; role: 'customer' | 'admin'; name: string }) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Name, email and password are required',
        code: 'VALIDATION_ERROR',
        requestId
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = db.users.findByEmail(trimmedEmail);
    if (existing) {
      logger.warn(`Registration attempt for already registered email: ${trimmedEmail}`, { requestId });
      return res.status(400).json({
        error: 'An account with this email already exists',
        code: 'EMAIL_ALREADY_EXISTS',
        requestId
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = db.users.create({
      name: name.trim(),
      email: trimmedEmail,
      passwordHash,
      phone: phone ? phone.trim() : '',
      role: 'customer',
      addresses: []
    });

    const token = generateToken(user);
    logger.info(`New user registered successfully: ${user.email} (${user._id})`, { requestId, userId: user._id });

    res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        addresses: user.addresses
      },
      token
    });
  } catch (err: any) {
    logger.error('Registration failed unexpectedly', err, { requestId });
    res.status(500).json({
      error: err.message || 'Registration failed',
      code: 'REGISTRATION_ERROR',
      requestId
    });
  }
});

// POST /api/auth/login - Customer Login
router.post('/login', async (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        code: 'VALIDATION_ERROR',
        requestId
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const user = db.users.findByEmail(trimmedEmail);
    if (!user) {
      logger.warn(`Failed login attempt: email not found '${trimmedEmail}'`, { requestId });
      return res.status(401).json({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
        requestId
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      logger.warn(`Failed login attempt: incorrect password for '${trimmedEmail}'`, { requestId, userId: user._id });
      return res.status(401).json({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
        requestId
      });
    }

    const token = generateToken(user);
    logger.info(`User logged in successfully: ${user.email} (${user.role})`, { requestId, userId: user._id });

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        addresses: user.addresses
      },
      token
    });
  } catch (err: any) {
    logger.error('Login process encountered server error', err, { requestId });
    res.status(500).json({
      error: err.message || 'Login failed',
      code: 'LOGIN_ERROR',
      requestId
    });
  }
});

// POST /api/auth/admin-login - Admin Login (strictly verifies role === 'admin')
router.post('/admin-login', async (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  try {
    const { username, email, password } = req.body;
    const loginIdentifier = typeof username === 'string' ? username : email;
    if (typeof loginIdentifier !== 'string' || !loginIdentifier.trim() || !password) {
      return res.status(400).json({
        error: 'Admin username and password are required',
        code: 'VALIDATION_ERROR',
        requestId
      });
    }

    const normalizedIdentifier = loginIdentifier.trim().toLowerCase();
    const user = db.users.findByUsername(normalizedIdentifier) || db.users.findByEmail(normalizedIdentifier);
    if (!user) {
      logger.warn('Failed admin login: account not found', { requestId });
      return res.status(401).json({
        error: 'Invalid administrator credentials',
        code: 'INVALID_ADMIN_CREDENTIALS',
        requestId
      });
    }

    if (user.role !== 'admin') {
      logger.warn('Customer account attempted admin login', { requestId, userId: user._id });
      return res.status(403).json({
        error: 'Access denied: This account does not possess administrator privileges',
        code: 'FORBIDDEN_NOT_ADMIN',
        requestId
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      logger.warn('Failed admin login: incorrect password', { requestId, userId: user._id });
      return res.status(401).json({
        error: 'Invalid administrator credentials',
        code: 'INVALID_ADMIN_CREDENTIALS',
        requestId
      });
    }

    const token = generateToken(user);
    logger.info(`Administrator logged in successfully: ${user.email}`, { requestId, userId: user._id });

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token
    });
  } catch (err: any) {
    logger.error('Admin login process encountered server error', err, { requestId });
    res.status(500).json({
      error: err.message || 'Admin login failed',
      code: 'ADMIN_LOGIN_ERROR',
      requestId
    });
  }
});

// GET /api/auth/me - Current verified user profile
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  if (!req.user) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'UNAUTHENTICATED',
      requestId
    });
  }

  const user = db.users.findById(req.user.id);
  if (!user) {
    logger.warn(`GET /me user ID ${req.user.id} not found in database`, { requestId });
    return res.status(404).json({
      error: 'User not found in database',
      code: 'USER_NOT_FOUND',
      requestId
    });
  }

  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    addresses: user.addresses || []
  });
});

// PUT /api/auth/addresses - Save customer addresses
router.put('/addresses', authenticate, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  if (!req.user) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'UNAUTHENTICATED',
      requestId
    });
  }

  const { addresses } = req.body;
  const updated = db.users.updateAddresses(req.user.id, addresses || []);
  if (!updated) {
    return res.status(404).json({
      error: 'User not found',
      code: 'USER_NOT_FOUND',
      requestId
    });
  }

  res.json({ addresses: updated.addresses });
});

export default router;
