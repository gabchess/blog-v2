/**
 * Auth Configuration
 *
 * Centralized authentication configuration with environment-aware settings.
 * Supports three environments: production, staging, development
 *
 * ENV=prod    - Strict security, low rate limits, all protections enabled
 * ENV=staging - Moderate security, medium rate limits, most protections enabled
 * ENV=dev     - Relaxed security, high rate limits, debugging enabled
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
 *
 * Production: Strict limits to prevent abuse
 * Staging: Moderate limits for testing
 * Development: Very high limits to avoid friction
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
  /** IP-based multiplier (allows more attempts from single IP for shared networks) */
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
  /**
   * Grace period (in seconds) after rotation where old token is still accepted.
   * Prevents false-positive reuse detection from network failures.
   */
  gracePeriodSeconds: isProduction ? 30 : isStaging ? 60 : 120,

  /**
   * Whether to validate device fingerprint (IP + User-Agent) on refresh.
   * If enabled, tokens used from different devices trigger security review.
   */
  validateDeviceBinding: isProduction,

  /**
   * Whether to allow IP changes during token refresh.
   * Set to false in high-security environments.
   */
  allowIpChange: !isProduction,

  /**
   * Whether to allow User-Agent changes during token refresh.
   */
  allowUserAgentChange: isDevelopment,
} as const;

/**
 * GraphQL security configuration - environment-aware
 */
export const graphqlSecurityConfig = {
  /** Maximum query depth allowed */
  maxDepth: isProduction ? 5 : isStaging ? 7 : 10,

  /** Maximum query complexity score */
  maxComplexity: isProduction ? 100 : isStaging ? 200 : 1000,

  /** Maximum number of aliases in a single query */
  maxAliases: isProduction ? 5 : isStaging ? 10 : 50,

  /** Maximum directives per operation */
  maxDirectives: isProduction ? 10 : isStaging ? 20 : 50,

  /** Maximum tokens in query */
  maxTokens: isProduction ? 1000 : isStaging ? 2000 : 10000,

  /** Disable introspection in non-dev environments */
  disableIntrospection: !isDevelopment,

  /** Enable GraphiQL playground */
  enableGraphiQL: isDevelopment,

  /** Disable batching for mutations (security) */
  disableMutationBatching: isProduction || isStaging,

  /** Maximum batch size for queries */
  maxBatchSize: isProduction ? 2 : isStaging ? 5 : 10,
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
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:4001'],

  /** Allow credentials (cookies, auth headers) */
  credentials: true,

  /** Allowed HTTP methods */
  methods: ['GET', 'POST', 'OPTIONS'],

  /** Allowed headers */
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],

  /** Headers to expose to client */
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
} as const;

/**
 * Security headers configuration
 */
export const securityHeadersConfig = {
  /** Enable HSTS (only in production with HTTPS) */
  enableHSTS: isProduction,

  /** HSTS max age in seconds (1 year) */
  hstsMaxAge: 31536000,

  /** Include subdomains in HSTS */
  hstsIncludeSubdomains: true,

  /** Content Security Policy */
  contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",

  /** X-Frame-Options */
  frameOptions: 'DENY',

  /** X-Content-Type-Options */
  contentTypeOptions: 'nosniff',

  /** Referrer Policy */
  referrerPolicy: 'strict-origin-when-cross-origin',
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
 * Combined auth configuration for backwards compatibility
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

  // GraphQL security
  graphqlSecurity: graphqlSecurityConfig,

  // CORS
  cors: corsConfig,

  // Security headers
  securityHeaders: securityHeadersConfig,
} as const;

/**
 * Hash a token using SHA-256 for secure storage.
 * Refresh tokens should never be stored in plaintext.
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
 * Log environment configuration on startup (non-sensitive values only)
 */
export function logAuthConfig(): void {
  console.log(`Auth config loaded for environment: ${ENV}`);
  console.log(`  - Rate limits: login=${rateLimitConfig.login.maxAttempts}, signup=${rateLimitConfig.signup.maxAttempts}`);
  console.log(`  - Lockout threshold: ${lockoutConfig.thresholdAttempts} attempts`);
  console.log(`  - GraphQL: depth=${graphqlSecurityConfig.maxDepth}, complexity=${graphqlSecurityConfig.maxComplexity}`);
  console.log(`  - Introspection: ${graphqlSecurityConfig.disableIntrospection ? 'disabled' : 'enabled'}`);
  console.log(`  - CORS origins: ${corsConfig.origins.join(', ')}`);
}
