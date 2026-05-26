/**
 * Auth Configuration
 *
 * Centralized authentication configuration with environment-aware settings.
 * Matches the GraphQL API's auth configuration for consistency.
 */

import { createHash, randomUUID } from 'node:crypto';

/**
 * Environment type - controls security strictness
 */
export type Environment = 'prod' | 'staging' | 'dev';

/**
 * Get current environment from ENV variable
 */
export function getEnvironment(): Environment {
  const env = process.env['ENV']?.toLowerCase();
  if (env === 'prod' || env === 'production') return 'prod';
  if (env === 'staging') return 'staging';
  return 'dev';
}

const ENV = getEnvironment();
const isProduction = ENV === 'prod';
const isStaging = ENV === 'staging';
const isDevelopment = ENV === 'dev';

// Validate JWT secret based on environment
const JWT_SECRET = process.env['JWT_SECRET'];

if (!JWT_SECRET) {
  if (isProduction) {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
  }
  if (isStaging) {
    throw new Error('FATAL: JWT_SECRET environment variable is required in staging.');
  }
  console.warn('WARNING: JWT_SECRET not set. Using insecure default for development only.');
}

if (JWT_SECRET && JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET must be at least 32 characters for adequate security.');
}

/**
 * JWT configuration - standard claims for RFC 8725 compliance
 */
export const jwtConfig = {
  /** JWT secret for signing tokens */
  secret: JWT_SECRET ?? 'dev-secret-only-for-local-development-not-for-production',

  /** JWT signing algorithm */
  algorithm: 'HS256' as const,

  /** Access token expiry (short-lived) */
  accessTokenExpiry: '15m',

  /** Refresh token expiry in days */
  refreshTokenExpiryDays: 7,

  /** Token issuer claim */
  issuer: process.env['JWT_ISSUER'] ?? 'octant-api',

  /** Token audience claim */
  audience: process.env['JWT_AUDIENCE'] ?? 'octant-client',
} as const;

/**
 * Rate limiting configuration - environment-aware
 */
export const rateLimitConfig = {
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: isProduction ? 5 : isStaging ? 20 : 1000,
  },
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: isProduction ? 3 : isStaging ? 10 : 1000,
  },
  refreshToken: {
    windowMs: 60 * 1000, // 1 minute
    maxAttempts: isProduction ? 30 : isStaging ? 100 : 10000,
  },
  /** IP-based multiplier for shared networks */
  ipMultiplier: isProduction ? 2 : isStaging ? 5 : 100,
} as const;

/**
 * Account lockout configuration - environment-aware
 */
export const lockoutConfig = {
  /** Number of failed attempts before lockout */
  thresholdAttempts: isProduction ? 10 : isStaging ? 25 : 1000,
  /** Time window to count failed attempts */
  windowMs: 60 * 60 * 1000, // 1 hour
  /** How long to lock the account */
  durationMs: isProduction ? 15 * 60 * 1000 : isStaging ? 5 * 60 * 1000 : 1000,
} as const;

/**
 * Token rotation configuration
 */
export const tokenRotationConfig = {
  /** Grace period (seconds) after rotation where old token is still accepted */
  gracePeriodSeconds: isProduction ? 30 : isStaging ? 60 : 120,
  /** Whether to validate device fingerprint on refresh */
  validateDeviceBinding: isProduction,
  /** Whether to allow IP changes during token refresh */
  allowIpChange: !isProduction,
  /** Whether to allow User-Agent changes during token refresh */
  allowUserAgentChange: isDevelopment,
} as const;

/**
 * Password configuration
 */
export const passwordConfig = {
  /** Bcrypt rounds for password hashing */
  bcryptRounds: 12,
  /** Minimum password length */
  minLength: 12,
  /** Maximum password length */
  maxLength: 64,
} as const;

/**
 * CORS configuration - environment-aware
 */
export const corsConfig = {
  /** Allowed origins */
  origins: isProduction
    ? (process.env['CORS_ORIGINS']?.split(',') ?? ['https://admin.octant.com', 'https://app.octant.com'])
    : isStaging
      ? (process.env['CORS_ORIGINS']?.split(',') ?? ['https://staging.octant.com'])
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:4001', 'http://localhost:4002'],
  /** Allow credentials (cookies, auth headers) */
  credentials: true,
  /** Allowed HTTP methods */
  methods: ['GET', 'POST', 'OPTIONS'],
  /** Allowed headers - includes X-CSRF-Token for CSRF protection (ADR-005) */
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  /** Headers to expose to client */
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
} as const;

/**
 * Combined auth configuration
 */
export const authConfig = {
  // JWT settings
  jwtSecret: jwtConfig.secret,
  jwtAlgorithm: jwtConfig.algorithm,
  jwtIssuer: jwtConfig.issuer,
  jwtAudience: jwtConfig.audience,
  accessTokenExpiry: jwtConfig.accessTokenExpiry,
  refreshTokenExpiryDays: jwtConfig.refreshTokenExpiryDays,

  // Password settings
  bcryptRounds: passwordConfig.bcryptRounds,

  // Environment flags
  env: ENV,
  isProduction,
  isStaging,
  isDevelopment,

  // Rate limiting
  rateLimit: rateLimitConfig,

  // Lockout
  lockout: lockoutConfig,

  // Token rotation
  tokenRotation: tokenRotationConfig,

  // CORS
  cors: corsConfig,
} as const;

/**
 * Hash a token using SHA-256 for secure storage.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure random token family ID.
 */
export function generateTokenFamily(): string {
  return createHash('sha256')
    .update(randomUUID())
    .digest('hex')
    .slice(0, 16);
}

/**
 * Log configuration on startup (non-sensitive values only)
 */
export function logAuthConfig(): void {
  console.log(`Auth config loaded for environment: ${ENV}`);
  console.log(`  - Rate limits: login=${rateLimitConfig.login.maxAttempts}, signup=${rateLimitConfig.signup.maxAttempts}`);
  console.log(`  - Lockout threshold: ${lockoutConfig.thresholdAttempts} attempts`);
  console.log(`  - CORS origins: ${corsConfig.origins.join(', ')}`);
}
