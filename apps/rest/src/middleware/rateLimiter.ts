/**
 * Rate Limiter Middleware for Express
 *
 * Uses express-rate-limit for in-memory rate limiting.
 * This approach works for single-instance deployments.
 *
 * For multi-instance production deployments, swap to rate-limit-redis:
 * - Install: pnpm add rate-limit-redis redis
 * - Add Redis to docker-compose.yml
 * - Use RedisStore as the store option
 *
 * See ADR-206 for migration path.
 */

import rateLimit from 'express-rate-limit';
import { rateLimitConfig } from '../config/auth.js';

/**
 * Login rate limiter - by IP address.
 * Limits failed login attempts to prevent brute force attacks.
 */
export const loginLimiter = rateLimit({
  windowMs: rateLimitConfig.login.windowMs,
  max: rateLimitConfig.login.maxAttempts * rateLimitConfig.ipMultiplier,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Signup rate limiter - by IP address.
 * Limits signup attempts to prevent abuse.
 */
export const signupLimiter = rateLimit({
  windowMs: rateLimitConfig.signup.windowMs,
  max: rateLimitConfig.signup.maxAttempts,
  message: { error: 'Too many signup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Refresh rate limiter - by IP address.
 * Limits token refresh attempts to prevent token abuse.
 */
export const refreshLimiter = rateLimit({
  windowMs: rateLimitConfig.refreshToken.windowMs,
  max: rateLimitConfig.refreshToken.maxAttempts,
  message: { error: 'Too many refresh attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
