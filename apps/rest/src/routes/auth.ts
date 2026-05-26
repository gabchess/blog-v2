/**
 * Auth Routes
 *
 * REST endpoints for authentication following ADR-205 patterns.
 * Implements: POST /auth/signup, POST /auth/login, POST /auth/logout,
 *             POST /auth/refresh, GET /auth/me
 *
 * Security features:
 * - HttpOnly cookies for refresh tokens
 * - CSRF double-submit cookie pattern
 * - JWT with RFC 8725 claims
 * - Rate limiting on all endpoints
 * - Account lockout after failed attempts
 * - Token rotation with reuse detection
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '@octant/db-postgres';
import { SignupInputSchema, LoginInputSchema } from '@octant/validation';
import {
  authConfig,
  lockoutConfig,
  hashToken,
  generateTokenFamily,
} from '../config/auth.js';
import { audit, auditWarn, auditAlert, AuditEvent } from '../utils/audit.js';
import {
  extractRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setCsrfCookie,
  generateCsrfToken,
} from '../middleware/csrf.js';
import { loginLimiter, signupLimiter, refreshLimiter } from '../middleware/rateLimiter.js';
import { requireAuth } from '../middleware/auth.js';

const router: ReturnType<typeof Router> = Router();

/** Generic error message to prevent email enumeration */
const AUTH_ERROR_MESSAGE = 'Invalid email or password';

/** Dummy hash for timing-safe comparison when user not found */
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.V5YD7xGEuqQK1a';

/**
 * Get client IP address from request.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0];
    return first ? first.trim() : 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Generate JWT access token with RFC 8725 claims.
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
    { expiresIn: authConfig.accessTokenExpiry, algorithm: authConfig.jwtAlgorithm }
  );
}

/**
 * Create a new session with refresh token.
 */
async function createSession(
  userId: string,
  ipAddress: string,
  userAgent: string,
  tokenFamily?: string
) {
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
 * @openapi
 * /auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupInput'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email already registered
 */
router.post('/signup', signupLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = SignupInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { email, password, name } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, name, passwordHash },
    });

    // Create session
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const { sessionId, refreshToken } = await createSession(user.id, ipAddress, userAgent);
    const accessToken = generateAccessToken(user.id, sessionId);

    // Set cookies
    setRefreshTokenCookie(res, refreshToken);
    setCsrfCookie(res, generateCsrfToken());

    audit(
      AuditEvent.SIGNUP_SUCCESS,
      { ipAddress, userAgent },
      { userId: user.id },
      'User signup successful'
    );

    return res.status(201).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Account temporarily locked
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = LoginInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    // Check for account lockout
    const recentFailures = await prisma.loginAttempt.count({
      where: {
        email: normalizedEmail,
        success: false,
        createdAt: { gte: new Date(Date.now() - lockoutConfig.windowMs) },
      },
    });

    if (recentFailures >= lockoutConfig.thresholdAttempts) {
      auditWarn(
        AuditEvent.ACCOUNT_LOCKOUT,
        { ipAddress, userAgent },
        { email: normalizedEmail },
        'Account locked out due to too many failed attempts'
      );
      return res.status(429).json({ error: 'Account temporarily locked. Try again later.' });
    }

    // Find user and compare password (timing-safe)
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordValid) {
      // Record failed attempt
      await prisma.loginAttempt.create({
        data: { email: normalizedEmail, ipAddress, success: false },
      });
      auditWarn(
        AuditEvent.LOGIN_FAILED,
        { ipAddress, userAgent },
        { email: normalizedEmail },
        'Login failed - invalid credentials'
      );
      return res.status(401).json({ error: AUTH_ERROR_MESSAGE });
    }

    // Record successful login attempt
    await prisma.loginAttempt.create({
      data: { email: normalizedEmail, ipAddress, success: true },
    });

    // Create session
    const { sessionId, refreshToken } = await createSession(user.id, ipAddress, userAgent);
    const accessToken = generateAccessToken(user.id, sessionId);

    // Set cookies
    setRefreshTokenCookie(res, refreshToken);
    setCsrfCookie(res, generateCsrfToken());

    audit(
      AuditEvent.LOGIN_SUCCESS,
      { ipAddress, userAgent },
      { userId: user.id },
      'Login successful'
    );

    return res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: End current session
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshToken = extractRefreshToken(req);
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      const session = await prisma.session.findUnique({ where: { tokenHash } });

      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
        audit(
          AuditEvent.LOGOUT,
          { ipAddress, userAgent, sessionId: session.id },
          { userId: session.userId },
          'User logged out'
        );
      }
    }

    clearRefreshTokenCookie(res);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Rotate refresh token
 *     description: Exchanges the current refresh token for a new one. Implements token reuse detection.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', refreshLimiter, async (req: Request, res: Response) => {
  try {
    const oldRefreshToken = extractRefreshToken(req);
    if (!oldRefreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const oldTokenHash = hashToken(oldRefreshToken);
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    // Atomic token rotation with Prisma transaction
    const result = await prisma.$transaction(async (tx) => {
      // Find session by current token hash
      const session = await tx.session.findUnique({
        where: { tokenHash: oldTokenHash },
        include: { user: true },
      });

      if (!session) {
        // Token not found - check if it was previously rotated (reuse detection)
        const reuseSession = await tx.session.findFirst({
          where: { previousTokenHash: oldTokenHash },
        });

        if (reuseSession) {
          // Token reuse detected! Revoke entire token family
          await tx.session.deleteMany({
            where: { tokenFamily: reuseSession.tokenFamily },
          });
          auditAlert(
            AuditEvent.TOKEN_REUSE_DETECTED,
            { ipAddress, userAgent },
            { tokenFamily: reuseSession.tokenFamily },
            'Token reuse detected - family revoked'
          );
        }
        return null;
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        await tx.session.delete({ where: { id: session.id } });
        auditWarn(
          AuditEvent.TOKEN_EXPIRED,
          { ipAddress, userAgent },
          { sessionId: session.id, userId: session.userId },
          'Refresh token expired'
        );
        return null;
      }

      // Generate new refresh token
      const newRefreshToken = randomUUID();
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + authConfig.refreshTokenExpiryDays);

      // Update session with new token, keeping old token hash for reuse detection
      await tx.session.update({
        where: { id: session.id },
        data: {
          tokenHash: hashToken(newRefreshToken),
          previousTokenHash: oldTokenHash,
          expiresAt: newExpiresAt,
          lastUsedAt: new Date(),
          ipAddress,
          userAgent,
        },
      });

      audit(
        AuditEvent.TOKEN_REFRESH,
        { ipAddress, userAgent, sessionId: session.id },
        { userId: session.userId },
        'Token refreshed successfully'
      );

      return { session, user: session.user, newRefreshToken };
    });

    if (!result) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Generate new access token and set cookies
    const accessToken = generateAccessToken(result.user.id, result.session.id);
    setRefreshTokenCookie(res, result.newRefreshToken);
    setCsrfCookie(res, generateCsrfToken());

    return res.json({ accessToken });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user info
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden - not authenticated or invalid token
 *       404:
 *         description: User not found
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as authRouter };
