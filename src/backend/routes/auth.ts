import { Router } from 'express';
import crypto from 'node:crypto';
import { findUserByEmail, createUser } from '../db.ts';
import { hashPassword, verifyPassword, generateUserJwt, requireUserAuth, type AuthRequest } from '../auth.ts';
import { ErrorCode } from '../types.ts';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Valid email address is required',
      });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Password must be at least 6 characters long',
      });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'An account with this email already exists',
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const newUser = await createUser({
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
    });

    const token = generateUserJwt({ id: newUser.id, email: newUser.email });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Failed to complete registration',
    });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: ErrorCode.VALIDATION_ERROR,
        message: 'Email and password are required',
      });
      return;
    }

    const user = await findUserByEmail(String(email).toLowerCase().trim());
    if (!user) {
      res.status(401).json({
        success: false,
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
      return;
    }

    const isMatch = await verifyPassword(String(password), user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
      return;
    }

    const token = generateUserJwt({ id: user.id, email: user.email });

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Failed to process login',
    });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

// GET /api/auth/me
router.get('/me', requireUserAuth, (req: AuthRequest, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

export default router;
