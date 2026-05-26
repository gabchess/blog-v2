/**
 * Auth Mutation Definitions
 *
 * Defines GraphQL mutations for user authentication with security best practices:
 * - signup: Register a new user with breach-checked password
 * - login: Authenticate with rate limiting and account lockout
 * - logout: Invalidate refresh token
 * - logoutAllDevices: Invalidate all sessions for a user
 * - refreshToken: Get new access token with token rotation and reuse detection
 * - revokeSession: Revoke a specific session
 *
 * Security features:
 * - RFC 8725 compliant JWT claims (sub, iss, aud, iat, exp, jti)
 * - Token rotation with grace period for network failures
 * - Device/IP binding validation (environment-aware)
 * - Rate limiting on all auth endpoints
 * - HttpOnly cookies for refresh tokens
 * - CSRF protection for mutations
 *
 * All auth mutations are marked PUBLIC (skipTypeScopes) since they handle
 * their own authentication via refresh tokens or don't require auth.
 */

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma, Prisma, type User } from '@octant/db';
import { SignupInputSchema, LoginInputSchema } from '@octant/validation';
import { builder } from '../../builder.js';
import {
  authConfig,
  rateLimitConfig,
  lockoutConfig,
  tokenRotationConfig,
  hashToken,
  generateTokenFamily,
} from '../../config/auth.js';
import { AuthorizationError } from '../../utils/auth.js';
import {
  extractRefreshToken,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../../middleware/csrf.js';
import type { RequestWithCookies } from '../../builder.js';
import { audit, auditWarn, auditAlert, getAuditContext, AuditEvent } from '../../utils/audit.js';
import { logger } from '../../utils/logger.js';

/**
 * Auth user type for responses (excludes passwordHash).
 */
const AuthUser = builder.objectRef<{
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}>('AuthUser').implement({
  description: 'User info in auth response (safe fields only)',
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'Date' }),
    updatedAt: t.expose('updatedAt', { type: 'Date' }),
  }),
});

/**
 * Auth response type containing tokens and user.
 *
 * Note: refreshToken is set via HttpOnly cookie using the cookieStore API.
 * The refreshToken field is deprecated and always returns null.
 */
const AuthPayload = builder.objectRef<{
  accessToken: string;
  user: User;
}>('AuthPayload').implement({
  description: 'Authentication response with tokens and user',
  fields: (t) => ({
    accessToken: t.exposeString('accessToken', {
      description: 'Short-lived JWT access token (15 min)',
    }),
    // DEPRECATED: Refresh token is now set via HttpOnly cookie
    // Kept for backwards compatibility but always returns null
    refreshToken: t.field({
      type: 'String',
      nullable: true,
      description: 'DEPRECATED: Refresh token is now set via HttpOnly cookie. Always returns null.',
      deprecationReason: 'Use HttpOnly cookie. This field always returns null.',
      resolve: () => null,
    }),
    user: t.field({
      type: AuthUser,
      description: 'The authenticated user',
      resolve: (parent) => parent.user,
    }),
  }),
});

/**
 * Set refresh token as HttpOnly cookie using the cookieStore API.
 * This is the secure way to store refresh tokens - they're never exposed to JavaScript.
 */
async function setRefreshTokenCookie(
  request: RequestWithCookies,
  token: string
): Promise<void> {
  const maxAge = authConfig.refreshTokenExpiryDays * 24 * 60 * 60;

  await request.cookieStore?.set({
    name: REFRESH_TOKEN_COOKIE_NAME,
    value: token,
    path: '/',
    maxAge,
    httpOnly: true,
    secure: authConfig.isProduction || authConfig.isStaging,
    sameSite: 'strict',
  });
}

/**
 * Clear the refresh token cookie on logout.
 */
async function clearRefreshTokenCookie(request: RequestWithCookies): Promise<void> {
  await request.cookieStore?.delete(REFRESH_TOKEN_COOKIE_NAME);
}

/**
 * Input type for signup mutation.
 */
const SignupInput = builder.inputType('SignupInput', {
  fields: (t) => ({
    email: t.string({ required: true, description: 'User email address' }),
    name: t.string({ required: true, description: 'User display name' }),
    password: t.string({ required: true, description: 'User password (min 12 chars)' }),
  }),
});

/**
 * Input type for login mutation.
 */
const LoginInput = builder.inputType('LoginInput', {
  fields: (t) => ({
    email: t.string({ required: true, description: 'User email address' }),
    password: t.string({ required: true, description: 'User password' }),
  }),
});

// Generic auth error for all auth failures (prevents user enumeration)
const AUTH_ERROR_MESSAGE = 'Invalid email or password';

// Dummy hash for timing attack mitigation
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.V5YD7xGEuqQK1a';

/**
 * Check if IP is rate limited for signup attempts.
 * Uses LoginAttempt table with a special email marker for signup tracking.
 */
async function checkSignupRateLimit(ipAddress: string, userAgent: string = 'unknown'): Promise<void> {
  const { windowMs, maxAttempts } = rateLimitConfig.signup;
  const windowStart = new Date(Date.now() - windowMs);

  // Count signup attempts by IP (using special marker email)
  const signupAttempts = await prisma.loginAttempt.count({
    where: {
      email: '__signup__',
      ipAddress,
      createdAt: { gte: windowStart },
    },
  });

  if (signupAttempts >= maxAttempts) {
    // Audit: rate limit exceeded
    auditWarn(
      AuditEvent.RATE_LIMIT_EXCEEDED,
      { ipAddress, userAgent },
      { endpoint: 'signup', attempts: signupAttempts },
      'Signup rate limit exceeded'
    );
    throw new Error('Too many signup attempts. Please try again later.');
  }
}

/**
 * Record a signup attempt for rate limiting.
 */
async function recordSignupAttempt(ipAddress: string): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: '__signup__',
      ipAddress,
      success: true, // We record all attempts, success doesn't matter for signup
    },
  });
}

/**
 * Check if email/IP is rate limited for login attempts.
 */
async function checkRateLimit(email: string, ipAddress: string, userAgent: string = 'unknown'): Promise<void> {
  const { windowMs, maxAttempts } = rateLimitConfig.login;
  const windowStart = new Date(Date.now() - windowMs);

  // Check attempts by email
  const emailAttempts = await prisma.loginAttempt.count({
    where: {
      email: email.toLowerCase(),
      success: false,
      createdAt: { gte: windowStart },
    },
  });

  if (emailAttempts >= maxAttempts) {
    // Audit: rate limit exceeded (don't reveal it's email-based)
    auditWarn(
      AuditEvent.RATE_LIMIT_EXCEEDED,
      { ipAddress, userAgent },
      { endpoint: 'login', attempts: emailAttempts },
      'Login rate limit exceeded'
    );
    // Return generic error to prevent user enumeration
    throw new Error(AUTH_ERROR_MESSAGE);
  }

  // Check attempts by IP (with multiplier for shared networks)
  const ipAttempts = await prisma.loginAttempt.count({
    where: {
      ipAddress,
      success: false,
      createdAt: { gte: windowStart },
    },
  });

  if (ipAttempts >= maxAttempts * rateLimitConfig.ipMultiplier) {
    // Audit: rate limit exceeded
    auditWarn(
      AuditEvent.RATE_LIMIT_EXCEEDED,
      { ipAddress, userAgent },
      { endpoint: 'login', attempts: ipAttempts, type: 'ip' },
      'Login rate limit exceeded (IP)'
    );
    // Return generic error to prevent user enumeration
    throw new Error(AUTH_ERROR_MESSAGE);
  }
}

/**
 * Check rate limit for refresh token endpoint.
 */
async function checkRefreshRateLimit(ipAddress: string, userAgent: string = 'unknown'): Promise<void> {
  const { windowMs, maxAttempts } = rateLimitConfig.refreshToken;
  const windowStart = new Date(Date.now() - windowMs);

  // Count recent refresh attempts from this IP
  // We track this via session lastUsedAt updates
  const recentRefreshes = await prisma.session.count({
    where: {
      ipAddress,
      lastUsedAt: { gte: windowStart },
    },
  });

  if (recentRefreshes >= maxAttempts) {
    // Audit: rate limit exceeded
    auditWarn(
      AuditEvent.RATE_LIMIT_EXCEEDED,
      { ipAddress, userAgent },
      { endpoint: 'refreshToken', attempts: recentRefreshes },
      'Refresh token rate limit exceeded'
    );
    throw new Error('Too many token refresh attempts. Please try again later.');
  }
}

/**
 * Record a login attempt for rate limiting.
 */
async function recordLoginAttempt(
  email: string,
  ipAddress: string,
  success: boolean
): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: email.toLowerCase(),
      ipAddress,
      success,
    },
  });
}

/**
 * Check if account is locked due to too many failed attempts.
 */
async function checkAccountLockout(email: string, ipAddress: string, userAgent: string = 'unknown'): Promise<void> {
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
    // Audit: account lockout triggered
    auditWarn(
      AuditEvent.ACCOUNT_LOCKOUT,
      { ipAddress, userAgent },
      { attempts: failedAttempts },
      'Account lockout triggered'
    );
    // Return generic error to prevent user enumeration
    throw new Error(AUTH_ERROR_MESSAGE);
  }
}

/**
 * Generate JWT access token with RFC 8725 standard claims.
 */
function generateAccessToken(userId: string, sessionId: string): string {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      // Standard claims (RFC 8725)
      sub: userId,                      // Subject - the user ID
      iss: authConfig.jwtIssuer,        // Issuer
      aud: authConfig.jwtAudience,      // Audience
      iat: now,                         // Issued at
      jti: sessionId,                   // JWT ID - links to session for revocation
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
 * Returns both the session ID and the raw refresh token.
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

/**
 * Validate device binding for token refresh (production security).
 */
function validateDeviceBinding(
  session: { ipAddress: string | null; userAgent: string | null },
  currentIp: string,
  currentUserAgent: string
): { valid: boolean; reason?: string } {
  const config = tokenRotationConfig;

  // Skip validation if disabled
  if (!config.validateDeviceBinding) {
    return { valid: true };
  }

  // Check IP change
  if (!config.allowIpChange && session.ipAddress && session.ipAddress !== currentIp) {
    return { valid: false, reason: 'IP_MISMATCH' };
  }

  // Check User-Agent change
  if (!config.allowUserAgentChange && session.userAgent && session.userAgent !== currentUserAgent) {
    return { valid: false, reason: 'USER_AGENT_MISMATCH' };
  }

  return { valid: true };
}

/**
 * Signup mutation - creates a new user account.
 *
 * PUBLIC: No authentication required.
 * Sets refresh token as HttpOnly cookie.
 */
builder.mutationField('signup', (t) =>
  t.field({
    type: AuthPayload,
    description: 'Register a new user account',
    // PUBLIC: Skip authentication requirement
    skipTypeScopes: true,
    args: {
      input: t.arg({ type: SignupInput, required: true }),
    },
    resolve: async (_parent, args, context) => {
      // Check signup rate limiting first
      await checkSignupRateLimit(context.ipAddress, context.userAgent);

      // Validate input
      const validated = SignupInputSchema.parse(args.input);

      // Record signup attempt for rate limiting (before any DB checks)
      await recordSignupAttempt(context.ipAddress);

      // Check if email already exists (case-insensitive)
      const existing = await prisma.user.findUnique({
        where: { email: validated.email.toLowerCase() },
      });
      if (existing) {
        throw new Error('Email already registered');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(validated.password, authConfig.bcryptRounds);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: validated.email.toLowerCase(),
          name: validated.name,
          passwordHash,
        },
      });

      // Create session and generate tokens
      const { sessionId, refreshToken } = await createSession(
        user.id,
        context.ipAddress,
        context.userAgent
      );
      const accessToken = generateAccessToken(user.id, sessionId);

      // Set refresh token as HttpOnly cookie
      await setRefreshTokenCookie(context.request, refreshToken);

      // Audit: signup success
      audit(
        AuditEvent.SIGNUP_SUCCESS,
        getAuditContext(context),
        { userId: user.id, email: user.email },
        'User signup successful'
      );

      return {
        accessToken,
        user,
      };
    },
  })
);

/**
 * Login mutation - authenticates user and returns tokens.
 *
 * PUBLIC: No authentication required.
 * Sets refresh token as HttpOnly cookie.
 */
builder.mutationField('login', (t) =>
  t.field({
    type: AuthPayload,
    description: 'Authenticate user and get tokens',
    // PUBLIC: Skip authentication requirement
    skipTypeScopes: true,
    args: {
      input: t.arg({ type: LoginInput, required: true }),
    },
    resolve: async (_parent, args, context) => {
      // Validate input
      const validated = LoginInputSchema.parse(args.input);
      const email = validated.email.toLowerCase();

      // Check rate limiting
      await checkRateLimit(email, context.ipAddress, context.userAgent);

      // Check account lockout
      await checkAccountLockout(email, context.ipAddress, context.userAgent);

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Timing attack mitigation - still hash compare
        await bcrypt.compare(validated.password, DUMMY_HASH);
        // Record failed attempt before throwing
        await recordLoginAttempt(email, context.ipAddress, false);
        // Audit: login failed (user not found)
        auditWarn(
          AuditEvent.LOGIN_FAILED,
          getAuditContext(context),
          { email, reason: 'user_not_found' },
          'Login failed - user not found'
        );
        throw new Error(AUTH_ERROR_MESSAGE);
      }

      // Verify password
      const isValid = await bcrypt.compare(validated.password, user.passwordHash);
      if (!isValid) {
        // Record failed attempt
        await recordLoginAttempt(email, context.ipAddress, false);
        // Audit: login failed (wrong password)
        auditWarn(
          AuditEvent.LOGIN_FAILED,
          getAuditContext(context),
          { email, userId: user.id, reason: 'invalid_password' },
          'Login failed - invalid password'
        );
        throw new Error(AUTH_ERROR_MESSAGE);
      }

      // Record successful attempt
      await recordLoginAttempt(email, context.ipAddress, true);

      // Create session and generate tokens
      const { sessionId, refreshToken } = await createSession(
        user.id,
        context.ipAddress,
        context.userAgent
      );
      const accessToken = generateAccessToken(user.id, sessionId);

      // Set refresh token as HttpOnly cookie
      await setRefreshTokenCookie(context.request, refreshToken);

      // Audit: login success
      audit(
        AuditEvent.LOGIN_SUCCESS,
        getAuditContext(context),
        { userId: user.id, email: user.email, sessionId },
        'User login successful'
      );

      return {
        accessToken,
        user,
      };
    },
  })
);

/**
 * Logout mutation - invalidates the refresh token.
 *
 * PUBLIC: No authentication required (uses refresh token from cookie).
 * Clears the refresh token cookie.
 */
builder.mutationField('logout', (t) =>
  t.field({
    type: 'Boolean',
    description: 'Invalidate refresh token (logout)',
    // PUBLIC: Skip authentication requirement (uses cookie)
    skipTypeScopes: true,
    // Deprecated: refreshToken argument. Now reads from cookie.
    args: {
      refreshToken: t.arg.string({
        required: false,
        description: 'DEPRECATED: Refresh token is now read from HttpOnly cookie',
      }),
    },
    resolve: async (_parent, args, context) => {
      // Try to get token from cookie first, then fall back to argument
      const token = extractRefreshToken(context.request) || args.refreshToken;

      if (!token) {
        // No token to invalidate, but still clear cookie
        await clearRefreshTokenCookie(context.request);
        return false;
      }

      try {
        // Find and delete session by hashed token
        const session = await prisma.session.findUnique({
          where: { tokenHash: hashToken(token) },
        });
        await prisma.session.delete({
          where: { tokenHash: hashToken(token) },
        });
        // Clear the cookie
        await clearRefreshTokenCookie(context.request);

        // Audit: logout success
        audit(
          AuditEvent.LOGOUT,
          getAuditContext(context),
          { sessionId: session?.id, userId: session?.userId },
          'User logout successful'
        );

        return true;
      } catch {
        // Token not found or already invalidated, still clear cookie
        await clearRefreshTokenCookie(context.request);
        return false;
      }
    },
  })
);

/**
 * LogoutAllDevices mutation - invalidates all sessions for the current user.
 *
 * PROTECTED: Requires authentication.
 */
builder.mutationField('logoutAllDevices', (t) =>
  t.field({
    type: 'Int',
    description: 'Invalidate all sessions for the current user',
    // Inherits authentication requirement from root Mutation type
    resolve: async (_parent, _args, context) => {
      // Context is guaranteed to have currentUser due to auth scope
      const result = await prisma.session.deleteMany({
        where: { userId: context.currentUser!.id },
      });

      // Audit: logout all devices
      audit(
        AuditEvent.LOGOUT_ALL,
        getAuditContext(context),
        { sessionsRevoked: result.count },
        'User logged out all devices'
      );

      return result.count;
    },
  })
);

/**
 * RefreshToken mutation - exchanges refresh token for new access token.
 * Implements token rotation with reuse detection and grace period for enhanced security.
 *
 * PUBLIC: No authentication required (uses refresh token from cookie).
 * Rotates the refresh token cookie.
 */
builder.mutationField('refreshToken', (t) =>
  t.field({
    type: AuthPayload,
    description: 'Exchange refresh token for new access token',
    // PUBLIC: Skip authentication requirement (uses cookie)
    skipTypeScopes: true,
    // Deprecated: refreshToken argument. Now reads from cookie.
    args: {
      refreshToken: t.arg.string({
        required: false,
        description: 'DEPRECATED: Refresh token is now read from HttpOnly cookie',
      }),
    },
    resolve: async (_parent, args, context) => {
      // Try to get token from cookie first, then fall back to argument
      const token = extractRefreshToken(context.request) || args.refreshToken;

      if (!token) {
        throw new Error('Refresh token required');
      }

      const tokenHash = hashToken(token);

      // Check rate limiting on refresh endpoint
      await checkRefreshRateLimit(context.ipAddress, context.userAgent);

      // Use transaction for atomic token rotation
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Check for token reuse (security breach detection)
        const reuseAttempt = await tx.session.findFirst({
          where: { previousTokenHash: tokenHash },
        });

        if (reuseAttempt) {
          // Check if within grace period (network failure scenario)
          const gracePeriodMs = tokenRotationConfig.gracePeriodSeconds * 1000;
          const rotationTime = reuseAttempt.lastUsedAt.getTime();
          const now = Date.now();

          if (now - rotationTime <= gracePeriodMs) {
            // Within grace period - return current tokens without rotation
            // This handles the case where client didn't receive the new token
            console.debug(`[${context.requestId}] Token reuse within grace period, family=${reuseAttempt.tokenFamily}`);

            const currentSession = await tx.session.findFirst({
              where: { tokenFamily: reuseAttempt.tokenFamily },
              include: { user: true },
              orderBy: { lastUsedAt: 'desc' },
            });

            if (currentSession) {
              // Generate new access token but don't rotate refresh token
              const accessToken = generateAccessToken(currentSession.userId, currentSession.id);
              // Note: Client should use the newer refresh token they may have received
              // No cookie update needed - return special marker
              return {
                accessToken,
                user: currentSession.user,
                _newRefreshToken: null as string | null, // No rotation needed
              };
            }
          }

          // Outside grace period - genuine token reuse attack
          // Revoke entire token family to protect user
          await tx.session.deleteMany({
            where: { tokenFamily: reuseAttempt.tokenFamily },
          });

          // Audit: token reuse attack detected
          auditAlert(
            AuditEvent.TOKEN_REUSE_DETECTED,
            getAuditContext(context),
            { tokenFamily: reuseAttempt.tokenFamily, userId: reuseAttempt.userId },
            'Token reuse detected - all sessions revoked'
          );

          throw new Error('Token reuse detected. All sessions have been revoked for security.');
        }

        // Find session by hashed token
        const session = await tx.session.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (!session) {
          throw new Error('Invalid refresh token');
        }

        // Check if expired
        if (session.expiresAt < new Date()) {
          // Clean up expired session
          await tx.session.delete({ where: { id: session.id } });
          throw new Error('Refresh token expired');
        }

        // Validate device binding (production only)
        const deviceValidation = validateDeviceBinding(
          session,
          context.ipAddress,
          context.userAgent
        );

        if (!deviceValidation.valid) {
          console.warn(`[${context.requestId}] Device binding validation failed: ${deviceValidation.reason}`);
          // In strict mode, revoke the session
          if (authConfig.isProduction) {
            await tx.session.delete({ where: { id: session.id } });
            throw new Error('Session invalidated due to suspicious activity.');
          }
          // In non-production, just log and continue
        }

        // Generate new tokens
        const accessToken = generateAccessToken(session.userId, session.id);
        const newRefreshToken = randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + authConfig.refreshTokenExpiryDays);

        // Rotate refresh token and track previous for reuse detection
        await tx.session.update({
          where: { id: session.id },
          data: {
            tokenHash: hashToken(newRefreshToken),
            previousTokenHash: tokenHash, // Store for reuse detection
            expiresAt,
            lastUsedAt: new Date(),
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });

        return {
          accessToken,
          user: session.user,
          _newRefreshToken: newRefreshToken, // Pass to set cookie after transaction
        };
      });

      // Set the new refresh token cookie after transaction completes
      if (result._newRefreshToken) {
        await setRefreshTokenCookie(context.request, result._newRefreshToken);

        // Audit: token refresh success
        audit(
          AuditEvent.TOKEN_REFRESH,
          getAuditContext(context),
          { userId: result.user.id },
          'Token refresh successful'
        );
      }

      return {
        accessToken: result.accessToken,
        user: result.user,
      };
    },
  })
);

/**
 * RevokeSession mutation - revokes a specific session by ID.
 *
 * PROTECTED: Requires authentication.
 * Users can only revoke their own sessions (IDOR prevention).
 */
builder.mutationField('revokeSession', (t) =>
  t.field({
    type: 'Boolean',
    description: 'Revoke a specific session by ID',
    // Inherits authentication requirement from root Mutation type
    args: {
      sessionId: t.arg.string({ required: true, description: 'Session ID to revoke' }),
    },
    resolve: async (_parent, args, context) => {
      // Find the session
      const session = await prisma.session.findUnique({
        where: { id: args.sessionId },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      // IDOR prevention: Only allow revoking own sessions
      if (session.userId !== context.currentUser!.id) {
        throw new AuthorizationError('Cannot revoke another user\'s session');
      }

      // Prevent revoking current session (use logout instead)
      if (context.sessionId && session.id === context.sessionId) {
        throw new Error('Cannot revoke current session. Use logout instead.');
      }

      await prisma.session.delete({
        where: { id: args.sessionId },
      });

      // Audit: session revoked
      audit(
        AuditEvent.SESSION_REVOKED,
        getAuditContext(context),
        { revokedSessionId: args.sessionId },
        'Session revoked'
      );

      return true;
    },
  })
);
