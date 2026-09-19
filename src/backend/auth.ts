import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById } from './db.ts';
import { ErrorCode } from './types.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'esp32-monitor-default-jwt-secret-phase1';
const SALT_ROUNDS = 10;

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

// Password utilities
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Device Token utilities
export function generateDeviceToken(): string {
  // Generates high-entropy token: esp32_tok_<48 hex chars>
  const random = crypto.randomBytes(24).toString('hex');
  return `esp32_tok_${random}`;
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

// User JWT utilities
export function generateUserJwt(user: AuthenticatedUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyUserJwt(token: string): AuthenticatedUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
    return {
      id: decoded.sub,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

// Express Middleware for User-Protected Endpoints
export async function requireUserAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: ErrorCode.UNAUTHORIZED,
      message: 'Authorization token required. Please login.',
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  const userPayload = verifyUserJwt(token);

  if (!userPayload) {
    res.status(401).json({
      success: false,
      error: ErrorCode.UNAUTHORIZED,
      message: 'Invalid or expired session token.',
    });
    return;
  }

  try {
    const user = await findUserById(userPayload.id);
    if (!user) {
      res.status(401).json({
        success: false,
        error: ErrorCode.UNAUTHORIZED,
        message: 'User account not found.',
      });
      return;
    }

    req.user = { id: user.id, email: user.email };
    next();
  } catch (error) {
    console.error('Auth middleware database error:', error);
    res.status(500).json({
      success: false,
      error: ErrorCode.SERVER_ERROR,
      message: 'Authentication check failed.',
    });
  }
}
