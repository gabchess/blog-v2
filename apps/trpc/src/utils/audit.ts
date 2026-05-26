/**
 * Audit Logging Utility
 *
 * Provides structured audit logging for security-relevant events.
 */

import { logger } from './logger.js';

/**
 * Security event types that trigger audit logging.
 */
export enum AuditEvent {
  // Authentication
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILED = 'auth.login.failed',
  SIGNUP_SUCCESS = 'auth.signup.success',
  LOGOUT = 'auth.logout',
  LOGOUT_ALL = 'auth.logout.all',

  // Token lifecycle
  TOKEN_REFRESH = 'auth.token.refresh',
  TOKEN_REFRESH_FAILED = 'auth.token.refresh.failed',
  TOKEN_REUSE_DETECTED = 'auth.token.reuse',
  TOKEN_EXPIRED = 'auth.token.expired',
  TOKEN_INVALID = 'auth.token.invalid',

  // Session management
  SESSION_CREATED = 'session.created',
  SESSION_REVOKED = 'session.revoked',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  ACCOUNT_LOCKOUT = 'security.lockout',

  // Authorization
  AUTH_REQUIRED = 'auth.required',
  ACCESS_DENIED = 'auth.denied',
}

/**
 * Audit logger - child of root logger with audit context.
 */
const auditLogger = logger.child({ component: 'audit' });

/**
 * Common context for audit events.
 */
export interface AuditContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Log an audit event with structured data.
 */
export function audit(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>,
  message?: string
): void {
  auditLogger.info(
    {
      event,
      ...context,
      ...data,
    },
    message ?? event
  );
}

/**
 * Log a security warning (failed attempts, suspicious activity).
 */
export function auditWarn(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>,
  message?: string
): void {
  auditLogger.warn(
    {
      event,
      ...context,
      ...data,
    },
    message ?? event
  );
}

/**
 * Log a security alert (potential attack, breach detected).
 */
export function auditAlert(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>,
  message?: string
): void {
  auditLogger.error(
    {
      event,
      ...context,
      ...data,
    },
    message ?? event
  );
}

/**
 * Create audit context from tRPC context.
 */
export function getAuditContext(context: {
  requestId?: string;
  currentUser?: { id: string } | null;
  sessionId?: string | null;
  ipAddress: string;
  userAgent: string;
}): AuditContext {
  return {
    requestId: context.requestId,
    userId: context.currentUser?.id,
    sessionId: context.sessionId ?? undefined,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
