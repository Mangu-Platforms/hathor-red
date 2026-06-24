/**
 * Authentication Utilities
 * Hathor Red v2.0 - Token generation, password hashing, secure cookies
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Response } from 'express';
import { JWTPayload, TokenPair } from '../types';

const BCRYPT_COST_FACTOR = 12;
const JWT_DEFAULT_EXPIRE = '15m';
const JWT_REFRESH_EXPIRE_DAYS = 7;

function getTokenLifetimeSeconds(token: string): number {
  const decoded = jwt.decode(token) as JWTPayload | null;
  if (decoded?.exp && decoded?.iat) {
    return Math.max(decoded.exp - decoded.iat, 0);
  }

  return 0;
}

/**
 * Generate a pair of access and refresh tokens
 */
export function generateTokenPair(
  userId: number,
  username: string,
  role: string = 'listener'
): TokenPair {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  const jti = randomBytes(16).toString('hex');
  const accessToken = jwt.sign(
    { userId, username, role, jti },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRE || JWT_DEFAULT_EXPIRE,
      issuer: 'hathor-music',
    }
  );

  const refreshToken = randomBytes(32).toString('hex');
  const expiresIn = getTokenLifetimeSeconds(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

/**
 * Verify a JWT access token
 */
export function verifyAccessToken(token: string): JWTPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }
  return jwt.verify(token, secret, {
    issuer: 'hathor-music',
    clockTolerance: 60,
  }) as JWTPayload;
}

/**
 * Verify token without throwing
 */
export function verifyAccessTokenOptional(token: string): JWTPayload | null {
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

/**
 * Hash a refresh token for secure storage
 */
export async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST_FACTOR);
}

/**
 * Verify a refresh token against its hash
 */
export async function verifyRefreshToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Set authentication cookies on response
 */
export function setTokenCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const accessTokenMaxAge = getTokenExpiry(accessToken)?.getTime() ?? Date.now();
  const refreshMaxAge = JWT_REFRESH_EXPIRE_DAYS * 24 * 60 * 60 * 1000;

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: Math.max(accessTokenMaxAge - Date.now(), 0),
    path: '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: refreshMaxAge,
    path: '/api/v1/auth/refresh',
  });
}

/**
 * Clear authentication cookies
 */
export function clearTokenCookies(res: Response): void {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
}

/**
 * Extract JTI from token without verification
 */
export function getTokenJti(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as any;
    return decoded?.jti || null;
  } catch {
    return null;
  }
}

/**
 * Get token expiry date
 */
export function getTokenExpiry(token: string): Date | null {
  try {
    const decoded = jwt.decode(token) as any;
    return decoded?.exp ? new Date(decoded.exp * 1000) : null;
  } catch {
    return null;
  }
}