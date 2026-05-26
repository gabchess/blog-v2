/**
 * tRPC Instance + Context + Middleware
 *
 * Defines the tRPC instance, context creation, and base procedures.
 * Follows the patterns from ADR-104, ADR-105, and ADR-106.
 *
 * Security features:
 * - JWT authentication with RFC 8725 claims validation
 * - HttpOnly cookies for refresh tokens (ADR-005 compliant)
 * - CSRF protection via double-submit cookie pattern
 * - Request/response access for cookie operations
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateHTTPContextOptions } from '@trpc/server/adapters/standalone';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '@octant/db';
import { prisma } from '@octant/db';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { authConfig } from './config/auth.js';
import { logger } from './utils/logger.js';

/**
 * Context available to all tRPC procedures.
 * Includes req/res for cookie operations following ADR-005.
 */
export interface Context {
  currentUser: User | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  /** Node.js request for reading cookies */
  req: IncomingMessage;
  /** Node.js response for setting cookies */
  res: ServerResponse;
}

/**
 * JWT payload interface with standard claims.
 */
interface JwtPayload {
  sub: string;      // Subject (user ID)
  iss: string;      // Issuer
  aud: string;      // Audience
  iat: number;      // Issued at
  exp: number;      // Expiration
  jti: string;      // JWT ID (session ID)
}

/**
 * Extract client IP from Node.js request headers.
 */
function getClientIp(req: CreateHTTPContextOptions['req']): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Create context from incoming Node.js HTTP request.
 * Extracts JWT from Authorization header and validates.
 */
export async function createContext(opts: CreateHTTPContextOptions): Promise<Context> {
  const requestIdHeader = opts.req.headers['x-request-id'];
  const requestId = (typeof requestIdHeader === 'string' ? requestIdHeader : null) ?? randomUUID();
  const ipAddress = getClientIp(opts.req);
  const userAgentHeader = opts.req.headers['user-agent'];
  const userAgent = (typeof userAgentHeader === 'string' ? userAgentHeader : null) ?? 'unknown';

  let currentUser: User | null = null;
  let sessionId: string | null = null;

  // Extract and verify access token from Authorization header
  const authHeader = opts.req.headers['authorization'];
  const authHeaderStr = typeof authHeader === 'string' ? authHeader : null;

  if (authHeaderStr?.startsWith('Bearer ')) {
    const token = authHeaderStr.slice(7);
    try {
      // Verify with explicit algorithm allowlist and claims validation
      const decoded = jwt.verify(token, authConfig.jwtSecret, {
        algorithms: [authConfig.jwtAlgorithm],
        issuer: authConfig.jwtIssuer,
        audience: authConfig.jwtAudience,
      }) as JwtPayload;

      // Use 'sub' claim as the user ID (RFC 8725 compliant)
      const userId = decoded.sub;
      sessionId = decoded.jti;

      if (userId) {
        currentUser = await prisma.user.findUnique({
          where: { id: userId },
        });
      }
    } catch (error) {
      // Log verification failures for monitoring
      if (error instanceof jwt.TokenExpiredError) {
        logger.debug({ requestId }, 'Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        logger.warn({ requestId, error: (error as Error).message }, 'Invalid JWT');
      }
      // Invalid token - user remains null
    }
  }

  return {
    currentUser,
    sessionId,
    ipAddress,
    userAgent,
    requestId,
    req: opts.req,
    res: opts.res,
  };
}

/**
 * Initialize tRPC with context type.
 */
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Don't expose internal errors in production
        stack: process.env['NODE_ENV'] === 'development' ? error.stack : undefined,
      },
    };
  },
});

/**
 * Router factory.
 */
export const router = t.router;

/**
 * Logging middleware - applied to all procedures.
 */
const withLogging = t.middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;

  logger.info({
    path,
    type,
    duration,
    userId: ctx.currentUser?.id,
    requestId: ctx.requestId,
  }, 'tRPC request');

  return result;
});

/**
 * Authentication middleware.
 * Ensures currentUser is present and non-null.
 */
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      currentUser: ctx.currentUser, // Now non-null
    },
  });
});

/**
 * Admin middleware (placeholder for future RBAC).
 */
const isAdmin = t.middleware(async ({ ctx, next: _next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // TODO: Implement when role field is added to User model
  // if (ctx.currentUser.role !== 'ADMIN') {
  //   throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  // }
  // return _next({ ctx: { ...ctx, currentUser: ctx.currentUser } });
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
});

/**
 * 1. Public procedure - no auth, with logging
 */
export const publicProcedure = t.procedure.use(withLogging);

/**
 * 2. Protected procedure - extends public, adds auth
 */
export const protectedProcedure = publicProcedure.use(isAuthed);

/**
 * 3. Admin procedure - extends protected, adds role check
 */
export const adminProcedure = protectedProcedure.use(isAdmin);

/**
 * Create a caller for testing purposes.
 * Allows calling procedures without HTTP transport.
 */
export const createCallerFactory = t.createCallerFactory;
