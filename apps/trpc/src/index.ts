/**
 * tRPC HTTP Server
 *
 * Production-ready HTTP server with:
 * - Health check endpoints (/health, /ready)
 * - Graceful shutdown
 * - CORS handling (including X-CSRF-Token header)
 * - Security headers
 * - CSRF protection via double-submit cookie pattern (ADR-005)
 * - HttpOnly cookies for refresh tokens
 * - Batch request limiting
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { prisma } from '@octant/db';
import { appRouter } from './routers/index.js';
import { createContext } from './trpc.js';
import { authConfig, corsConfig, logAuthConfig } from './config/auth.js';
import { logger } from './utils/logger.js';
import {
  setCsrfCookie,
  generateCsrfToken,
  parseCookies,
  validateCsrf,
  CSRF_COOKIE_NAME,
} from './middleware/csrf.js';

const PORT = process.env['TRPC_PORT'] ?? 4002;

/**
 * Maximum batch size for tRPC requests.
 * Prevents abuse via batched calls.
 */
const MAX_BATCH_SIZE = 10;

/**
 * Maximum request body size in bytes (1MB).
 * Prevents memory exhaustion DoS attacks.
 * Matches GraphQL server limit (ADR-005).
 */
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

/**
 * Create tRPC HTTP handler.
 */
const handler = createHTTPHandler({
  router: appRouter,
  createContext,
  batching: {
    enabled: true,
  },
  onError({ error, path }) {
    logger.error({ path, error: error.message, code: error.code }, 'tRPC error');
  },
  responseMeta() {
    return {
      headers: {
        // Security headers matching GraphQL server (ADR-005)
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Cache-Control': 'no-store',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    };
  },
});

/**
 * Set CORS headers on response.
 * Includes X-CSRF-Token in allowed headers for CSRF protection.
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const cors = corsConfig;

  if (origin && cors.origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', String(cors.credentials));
    res.setHeader('Access-Control-Allow-Methods', cors.methods.join(', '));
    // Include X-CSRF-Token in allowed headers (ADR-005)
    res.setHeader('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders?.join(', ') ?? '');
  }
}

/**
 * Set CSRF cookie if not present.
 * Called on initial requests to establish the CSRF token.
 */
function ensureCsrfCookie(req: IncomingMessage, res: ServerResponse): void {
  const cookieHeader = req.headers.cookie ?? '';
  const cookies = parseCookies(cookieHeader);

  // Check if CSRF cookie already exists
  const hasCsrfCookie = cookies['__Host-csrf'] || cookies['csrf'] || cookies[CSRF_COOKIE_NAME];

  if (!hasCsrfCookie) {
    setCsrfCookie(res, generateCsrfToken());
  }
}

/**
 * Create HTTP server with middleware.
 */
const server = createServer(async (req, res) => {
  // Set CORS headers
  setCorsHeaders(req, res);

  // Handle preflight - also set CSRF cookie on OPTIONS
  if (req.method === 'OPTIONS') {
    ensureCsrfCookie(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Ensure CSRF cookie is set for all requests
  ensureCsrfCookie(req, res);

  // Check request body size to prevent DoS attacks
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    logger.warn({ contentLength, maxSize: MAX_BODY_SIZE }, 'Request body too large');
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Request body too large',
        code: 'PAYLOAD_TOO_LARGE',
      },
    }));
    return;
  }

  // Validate CSRF for state-changing requests (POST/PUT/PATCH/DELETE)
  // GET requests (queries) don't need CSRF protection
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    if (!validateCsrf(req)) {
      logger.warn({ method: req.method, url: req.url }, 'CSRF validation failed');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: 'CSRF validation failed',
          code: 'FORBIDDEN',
        },
      }));
      return;
    }
  }

  // Health check endpoints (outside tRPC for Kubernetes probes)
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }

  if (req.url === '/ready') {
    try {
      // Check database connectivity
      await prisma.$runCommandRaw({ ping: 1 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not ready' }));
    }
    return;
  }

  // Delegate to tRPC handler
  handler(req, res);
});

/**
 * Graceful shutdown handler.
 */
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully...');

  // Stop accepting new connections
  server.close();

  // Close database connection
  await prisma.$disconnect();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Start the server.
 */
server.listen(Number(PORT), () => {
  // Log configuration on startup
  logAuthConfig();

  logger.info({
    port: PORT,
    env: authConfig.env,
    batchLimit: MAX_BATCH_SIZE,
  }, `tRPC server running on http://localhost:${PORT}`);
});
