/**
 * Pino Logger Configuration
 *
 * Structured JSON logging for the GraphQL API.
 * Uses pino-pretty in development for human-readable output.
 *
 * Features:
 * - Automatic sensitive data redaction
 * - Request-scoped child loggers
 * - Native GraphQL Yoga integration
 */

import pino from 'pino';
import { authConfig } from '../config/auth.js';

/**
 * Paths to redact from logs to prevent sensitive data leakage.
 * Supports nested paths with wildcards.
 */
const REDACT_PATHS = [
  // Auth tokens
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'token',
  'tokenHash',
  'previousTokenHash',
  // Headers
  'authorization',
  'cookie',
  'headers.authorization',
  'headers.cookie',
  // Nested paths
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  // Variables in GraphQL
  'variables.password',
  'variables.token',
];

/**
 * Root logger instance.
 * Use child loggers for request-scoped logging.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (authConfig.isDevelopment ? 'debug' : 'info'),

  // Service metadata
  base: {
    service: 'graphql-api',
    env: authConfig.env,
  },

  // ISO timestamps
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive data
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },

  // Pretty print in development
  transport: authConfig.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss',
        },
      }
    : undefined,
});

/**
 * GraphQL Yoga logging interface.
 * Integrates Pino with Yoga's native logging system.
 */
export const yogaLogger = {
  debug: (...args: unknown[]) => logger.debug(args[0] as object, args[1] as string),
  info: (...args: unknown[]) => logger.info(args[0] as object, args[1] as string),
  warn: (...args: unknown[]) => logger.warn(args[0] as object, args[1] as string),
  error: (...args: unknown[]) => logger.error(args[0] as object, args[1] as string),
};

/**
 * Create a child logger with request context.
 * Use this in resolvers for request-scoped logging.
 */
export function createRequestLogger(context: {
  requestId: string;
  userId?: string | null;
  sessionId?: string | null;
  ipAddress?: string;
}) {
  return logger.child({
    requestId: context.requestId,
    userId: context.userId ?? undefined,
    sessionId: context.sessionId ?? undefined,
    ipAddress: context.ipAddress,
  });
}

export type Logger = pino.Logger;
