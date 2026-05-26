/**
 * Auth Router
 *
 * Authentication procedures following ADR-005 (security), ADR-105 (tRPC security),
 * and ADR-106 (tRPC auth patterns).
 *
 * Security features:
 * - HttpOnly cookies for refresh tokens (XSS protection)
 * - CSRF double-submit cookie pattern
 * - Token rotation with reuse detection
 * - Rate limiting on all auth endpoints including refresh
 * - Timing-safe password comparison
 *
 * Implements: login, signup, logout, refresh
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma, Prisma } from '@octant/db';
import { SignupInputSchema, LoginInputSchema } from '@octant/validation';
import { router, publicProcedure } from '../trpc.js';
import {
  authConfig,
  lockoutConfig,
  tokenRotationConfig,
  hashToken,
  generateTokenFamily,
} from '../config/auth.js';
import { audit, auditWarn, auditAlert, getAuditContext, AuditEvent } from '../utils/audit.js';
import { TRPCError } from '@trpc/server';
import {
  extractRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setCsrfCookie,
  generateCsrfToken,
} from '../middleware/csrf.js';
import {
  loginRateLimiter,
  signupRateLimiter,
  refreshRateLimiter,
} from '../middleware/rateLimiter.js';

// Generic auth error for all auth failures (prevents user enumeration)
const AUTH_ERROR_MESSAGE = 'Invalid email or password';

// Dummy hash for timing attack mitigation
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.V5YD7xGEuqQK1a';

/**
 * Output schema for auth responses - prevents leaking passwordHash.
 */
const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Auth payload schema.
 * Note: refreshToken is deprecated and always null.
 * Refresh tokens are now sent via HttpOnly cookie (ADR-005).
 */
const AuthPayloadSchema = z.object({
  accessToken: z.string(),
  /** @deprecated Refresh token is now set via HttpOnly cookie. Always null. */
  refreshToken: z.string().nullable(),
  user: AuthUserSchema,
});

/**
 * Generate JWT access token with RFC 8725 standard claims.
 */
function generateAccessToken(userId: string, sessionId: string): string {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: userId,
      iss: authConfig.jwtIssuer,
      aud: authConfig.jwtAudience,
      iat: now,
      jti: sessionId,
    },
    authConfig.jwtSecret,
    {
      expiresIn: authConfig.accessTokenExpiry,
      algorithm: authConfig.jwtAlgorithm,
    }
  );
}

/**
 * Create a new session with hashed token.
 */
async function createSession(
  userId: string,
  ipAddress: string,
  userAgent: string,
  tokenFamily?: string
): Promise<{ sessionId: string; refreshToken: string }> {
  const refreshToken = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + authConfig.refreshTokenExpiryDays);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      tokenFamily: tokenFamily ?? generateTokenFamily(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  return { sessionId: session.id, refreshToken };
}

// NOTE: Rate limiting is now handled by @trpc-limiter/memory middleware.
// See middleware/rateLimiter.ts for configuration.
// The LoginAttempt table is still used for audit trail and account lockout.

/**
 * Check account lockout.
 */
async function checkAccountLockout(email: string, ipAddress: string, userAgent: string): Promise<void> {
  const { thresholdAttempts, windowMs } = lockoutConfig;
  const windowStart = new Date(Date.now() - windowMs);

  const failedAttempts = await prisma.loginAttempt.count({
    where: {
      email: email.toLowerCase(),
      success: false,
      createdAt: { gte: windowStart },
    },
  });

  if (failedAttempts >= thresholdAttempts) {
    auditWarn(
      AuditEvent.ACCOUNT_LOCKOUT,
      { ipAddress, userAgent },
      { attempts: failedAttempts },
      'Account lockout triggered'
    );
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: AUTH_ERROR_MESSAGE });
  }
}

/**
 * Record login attempt for rate limiting.
 */
async function recordLoginAttempt(email: string, ipAddress: string, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: email.toLowerCase(),
      ipAddress,
      success,
    },
  });
}


/**
 * Validate device binding for token refresh.
 */
function validateDeviceBinding(
  session: { ipAddress: string | null; userAgent: string | null },
  currentIp: string,
  currentUserAgent: string
): { valid: boolean; reason?: string } {
  const config = tokenRotationConfig;

  if (!config.validateDeviceBinding) {
    return { valid: true };
  }

  if (!config.allowIpChange && session.ipAddress && session.ipAddress !== currentIp) {
    return { valid: false, reason: 'IP_MISMATCH' };
  }

  if (!config.allowUserAgentChange && session.userAgent && session.userAgent !== currentUserAgent) {
    return { valid: false, reason: 'USER_AGENT_MISMATCH' };
  }

  return { valid: true };
}

export const authRouter = router({
  /**
   * Signup - Register a new user account.
   * Rate limiting is applied via middleware.
   */
  signup: publicProcedure
    .use(signupRateLimiter)
    .input(SignupInputSchema)
    .output(AuthPayloadSchema)
    .mutation(async ({ input, ctx }) => {
      // Record signup attempt for audit trail
      await prisma.loginAttempt.create({
        data: { email: '__signup__', ipAddress: ctx.ipAddress, success: true },
      });

      // Check if email exists
      const existing = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(input.password, authConfig.bcryptRounds);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash,
        },
      });

      // Create session and generate tokens
      const { sessionId, refreshToken } = await createSession(
        user.id,
        ctx.ipAddress,
        ctx.userAgent
      );
      const accessToken = generateAccessToken(user.id, sessionId);

      // Set refresh token as HttpOnly cookie (ADR-005)
      setRefreshTokenCookie(ctx.res, refreshToken);

      // Set CSRF cookie for subsequent requests
      setCsrfCookie(ctx.res, generateCsrfToken());

      // Audit log
      audit(
        AuditEvent.SIGNUP_SUCCESS,
        getAuditContext(ctx),
        { userId: user.id, email: user.email },
        'User signup successful'
      );

      return {
        accessToken,
        refreshToken: null, // Deprecated: now sent via HttpOnly cookie
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      };
    }),

  /**
   * Login - Authenticate user and return tokens.
   * Rate limiting is applied via middleware.
   */
  login: publicProcedure
    .use(loginRateLimiter)
    .input(LoginInputSchema)
    .output(AuthPayloadSchema)
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase();

      // Check account lockout (separate from rate limiting - tracks failed passwords)
      await checkAccountLockout(email, ctx.ipAddress, ctx.userAgent);

      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Timing attack mitigation
        await bcrypt.compare(input.password, DUMMY_HASH);
        await recordLoginAttempt(email, ctx.ipAddress, false);

        auditWarn(
          AuditEvent.LOGIN_FAILED,
          getAuditContext(ctx),
          { email, reason: 'user_not_found' },
          'Login failed - user not found'
        );

        throw new TRPCError({ code: 'UNAUTHORIZED', message: AUTH_ERROR_MESSAGE });
      }

      // Verify password
      const isValid = await bcrypt.compare(input.password, user.passwordHash);
      if (!isValid) {
        await recordLoginAttempt(email, ctx.ipAddress, false);

        auditWarn(
          AuditEvent.LOGIN_FAILED,
          getAuditContext(ctx),
          { email, userId: user.id, reason: 'invalid_password' },
          'Login failed - invalid password'
        );

        throw new TRPCError({ code: 'UNAUTHORIZED', message: AUTH_ERROR_MESSAGE });
      }

      // Record successful attempt
      await recordLoginAttempt(email, ctx.ipAddress, true);

      // Create session and generate tokens
      const { sessionId, refreshToken } = await createSession(
        user.id,
        ctx.ipAddress,
        ctx.userAgent
      );
      const accessToken = generateAccessToken(user.id, sessionId);

      // Set refresh token as HttpOnly cookie (ADR-005)
      setRefreshTokenCookie(ctx.res, refreshToken);

      // Set CSRF cookie for subsequent requests
      setCsrfCookie(ctx.res, generateCsrfToken());

      audit(
        AuditEvent.LOGIN_SUCCESS,
        getAuditContext(ctx),
        { userId: user.id, email: user.email, sessionId },
        'User login successful'
      );

      return {
        accessToken,
        refreshToken: null, // Deprecated: now sent via HttpOnly cookie
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      };
    }),

  /**
   * Logout - Invalidate the refresh token.
   * Reads refresh token from HttpOnly cookie only (ADR-005).
   * SECURITY: Does not accept tokens from request body to prevent XSS token theft.
   */
  logout: publicProcedure
    .input(z.object({}))
    .output(z.boolean())
    .mutation(async ({ ctx }) => {
      // SECURITY: Only accept refresh token from HttpOnly cookie (not request body)
      const token = extractRefreshToken(ctx.req);

      if (!token) {
        // No token to invalidate, but still clear cookie
        clearRefreshTokenCookie(ctx.res);
        return false;
      }

      try {
        const session = await prisma.session.findUnique({
          where: { tokenHash: hashToken(token) },
        });

        await prisma.session.delete({
          where: { tokenHash: hashToken(token) },
        });

        // Clear the refresh token cookie
        clearRefreshTokenCookie(ctx.res);

        audit(
          AuditEvent.LOGOUT,
          getAuditContext(ctx),
          { sessionId: session?.id, userId: session?.userId },
          'User logout successful'
        );

        return true;
      } catch {
        // Token not found or already invalidated, still clear cookie
        clearRefreshTokenCookie(ctx.res);
        return false;
      }
    }),

  /**
   * Refresh - Exchange refresh token for new access token with rotation.
   * Reads refresh token from HttpOnly cookie only (ADR-005).
   * SECURITY: Does not accept tokens from request body to prevent XSS token theft.
   * Rate limiting is applied via middleware.
   */
  refresh: publicProcedure
    .use(refreshRateLimiter)
    .input(z.object({}))
    .output(z.object({
      accessToken: z.string(),
      /** @deprecated Refresh token is now set via HttpOnly cookie. Always null. */
      refreshToken: z.string().nullable(),
      user: AuthUserSchema,
    }))
    .mutation(async ({ ctx }) => {
      // SECURITY: Only accept refresh token from HttpOnly cookie (not request body)
      const token = extractRefreshToken(ctx.req);

      if (!token) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Refresh token required' });
      }

      const tokenHash = hashToken(token);

      // Use transaction for atomic token rotation
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Check for token reuse
        const reuseAttempt = await tx.session.findFirst({
          where: { previousTokenHash: tokenHash },
        });

        if (reuseAttempt) {
          // Check grace period
          const gracePeriodMs = tokenRotationConfig.gracePeriodSeconds * 1000;
          const rotationTime = reuseAttempt.lastUsedAt.getTime();
          const now = Date.now();

          if (now - rotationTime <= gracePeriodMs) {
            // Within grace period - return current tokens
            const currentSession = await tx.session.findFirst({
              where: { tokenFamily: reuseAttempt.tokenFamily },
              include: { user: true },
              orderBy: { lastUsedAt: 'desc' },
            });

            if (currentSession) {
              const accessToken = generateAccessToken(currentSession.userId, currentSession.id);
              return {
                accessToken,
                refreshToken: null, // Token not rotated in grace period
                user: currentSession.user,
                _skipCookieSet: true, // Internal flag: don't set new cookie
              };
            }
          }

          // Token reuse attack - revoke entire family
          await tx.session.deleteMany({
            where: { tokenFamily: reuseAttempt.tokenFamily },
          });

          auditAlert(
            AuditEvent.TOKEN_REUSE_DETECTED,
            getAuditContext(ctx),
            { tokenFamily: reuseAttempt.tokenFamily, userId: reuseAttempt.userId },
            'Token reuse detected - all sessions revoked'
          );

          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Token reuse detected. All sessions have been revoked for security.',
          });
        }

        // Find session by hashed token
        const session = await tx.session.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (!session) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
        }

        // Check expiration
        if (session.expiresAt < new Date()) {
          await tx.session.delete({ where: { id: session.id } });
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Refresh token expired' });
        }

        // Validate device binding
        const deviceValidation = validateDeviceBinding(session, ctx.ipAddress, ctx.userAgent);
        if (!deviceValidation.valid && authConfig.isProduction) {
          await tx.session.delete({ where: { id: session.id } });
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Session invalidated due to suspicious activity.',
          });
        }

        // Generate new tokens
        const accessToken = generateAccessToken(session.userId, session.id);
        const newRefreshToken = randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + authConfig.refreshTokenExpiryDays);

        // Rotate refresh token
        await tx.session.update({
          where: { id: session.id },
          data: {
            tokenHash: hashToken(newRefreshToken),
            previousTokenHash: tokenHash,
            expiresAt,
            lastUsedAt: new Date(),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });

        return {
          accessToken,
          refreshToken: null, // Deprecated: sent via cookie
          user: session.user,
          _newRefreshToken: newRefreshToken, // Internal: for cookie setting
        };
      });

      // Set the new refresh token cookie after transaction completes
      if ('_newRefreshToken' in result && result._newRefreshToken) {
        setRefreshTokenCookie(ctx.res, result._newRefreshToken);

        audit(
          AuditEvent.TOKEN_REFRESH,
          getAuditContext(ctx),
          { userId: result.user.id },
          'Token refresh successful'
        );
      }

      return {
        accessToken: result.accessToken,
        refreshToken: null, // Deprecated: now sent via HttpOnly cookie
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
      };
    }),
});
