/**
 * Rate Limiter Middleware
 *
 * Uses @trpc-limiter/memory for in-memory rate limiting.
 * This approach works for single-instance deployments.
 *
 * For multi-instance production deployments, swap to @trpc-limiter/redis:
 * - Install: pnpm add @trpc-limiter/redis redis
 * - Add Redis to docker-compose.yml
 * - Use createTRPCRedisLimiter instead
 *
 * See ADR-106 for migration path.
 */

import { createTRPCStoreLimiter } from '@trpc-limiter/memory';
import type { MiddlewareFunction } from '@trpc/server/unstable-core-do-not-import';
import { rateLimitConfig } from '../config/auth.js';

// Note: The library uses internal tRPC types (@trpc/server/unstable-core-do-not-import).
// We use type assertions for the ctx parameter since our Context type provides the needed fields.
interface RateLimitContext {
  ipAddress: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RateLimiterMiddleware = MiddlewareFunction<any, any, any, any, any>;

/**
 * Login rate limiter - by IP address.
 * Limits failed login attempts to prevent brute force attacks.
 */
export const loginRateLimiter: RateLimiterMiddleware = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `login:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many login attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.login.maxAttempts * rateLimitConfig.ipMultiplier,
  windowMs: rateLimitConfig.login.windowMs,
});

/**
 * Signup rate limiter - by IP address.
 * Limits signup attempts to prevent abuse.
 */
export const signupRateLimiter: RateLimiterMiddleware = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `signup:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many signup attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.signup.maxAttempts,
  windowMs: rateLimitConfig.signup.windowMs,
});

/**
 * Refresh rate limiter - by IP address.
 * Limits token refresh attempts to prevent token abuse.
 */
export const refreshRateLimiter: RateLimiterMiddleware = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `refresh:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many refresh attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.refreshToken.maxAttempts,
  windowMs: rateLimitConfig.refreshToken.windowMs,
});
