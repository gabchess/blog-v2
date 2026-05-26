/**
 * Pino Logger Configuration
 *
 * Structured JSON logging for the tRPC API.
 * Uses pino-pretty in development for human-readable output.
 */

import pino from 'pino';
import { authConfig } from '../config/auth.js';

/**
 * Paths to redact from logs to prevent sensitive data leakage.
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
  // Input variables
  'input.password',
  'input.token',
];

/**
 * Root logger instance.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (authConfig.isDevelopment ? 'debug' : 'info'),

  // Service metadata
  base: {
    service: 'trpc-api',
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
 * Create a child logger with request context.
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
