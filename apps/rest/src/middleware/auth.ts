/**
 * Authentication Middleware
 *
 * Provides reusable JWT verification middleware for route protection.
 * Based on ADR-412: Express JWT Middleware Patterns
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtConfig } from '../config/auth.js';
import { AuditEvent, auditWarn } from '../utils/audit.js';

/**
 * Extend Express Request type to include userId.
 * Uses global augmentation for compatibility with NodeNext module resolution.
 */
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Middleware that requires valid JWT authentication.
 *
 * - Checks Authorization header for Bearer token
 * - Verifies JWT with explicit algorithm, issuer, and audience
 * - Attaches decoded userId to request on success
 * - Returns 403 Forbidden on any auth failure (per PROJECT.md requirement)
 *
 * @example
 * ```ts
 * router.post('/admin/rounds', requireAuth, (req, res) => {
 *   const adminId = req.userId; // guaranteed to exist
 *   // ...
 * });
 * ```
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  const auditContext = {
    ipAddress: req.ip ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
  };

  // Check for Bearer token format
  if (!authHeader?.startsWith('Bearer ')) {
    auditWarn(AuditEvent.AUTH_REQUIRED, auditContext, { reason: 'missing_header' }, 'No Authorization header');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT with explicit options per ADR-412:
    // - algorithms: prevents algorithm confusion attacks
    // - issuer/audience: validates standard claims
    const decoded = jwt.verify(token, jwtConfig.secret, {
      algorithms: [jwtConfig.algorithm],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    }) as { sub: string };

    // Attach userId to request for downstream handlers
    req.userId = decoded.sub;
    next();
  } catch (error) {
    const isExpired = error instanceof jwt.TokenExpiredError;
    auditWarn(
      isExpired ? AuditEvent.TOKEN_EXPIRED : AuditEvent.TOKEN_INVALID,
      auditContext,
      { error: error instanceof Error ? error.message : 'unknown' },
      isExpired ? 'Token expired' : 'Token invalid'
    );
    res.status(403).json({ error: 'Forbidden' });
  }
}

/**
 * Middleware that optionally extracts userId from JWT if present.
 *
 * Unlike requireAuth, this middleware:
 * - Does NOT reject requests without tokens
 * - Does NOT reject requests with invalid tokens
 * - Simply sets req.userId if a valid token is present
 *
 * Use this for routes that work differently for authenticated vs. unauthenticated users.
 *
 * @example
 * ```ts
 * router.get('/rounds/current', optionalAuth, (req, res) => {
 *   if (req.userId) {
 *     // Authenticated: return user's own round
 *   } else {
 *     // Unauthenticated: return public/active round
 *   }
 * });
 * ```
 */
export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  // No token? Continue without setting userId
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtConfig.secret, {
      algorithms: [jwtConfig.algorithm],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    }) as { sub: string };

    // Attach userId to request
    req.userId = decoded.sub;
  } catch {
    // Invalid token - just continue without userId (don't reject)
  }

  next();
}
