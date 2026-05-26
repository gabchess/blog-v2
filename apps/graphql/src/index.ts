/**
 * GraphQL Server Entry Point
 *
 * This module starts the GraphQL Yoga server with the Pothos-built schema.
 * Includes comprehensive security controls:
 * - JWT authentication with RFC 8725 claims validation
 * - Pothos Scope Auth for declarative authorization
 * - Query depth limiting
 * - Query complexity analysis
 * - Alias limiting (prevents batching attacks)
 * - CSRF protection for mutations
 * - HttpOnly cookies for refresh tokens
 * - CORS configuration
 * - Security headers
 * - Rate limit headers
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createYoga } from 'graphql-yoga';
import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { useCookies } from '@whatwg-node/server-plugin-cookies';
import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor';
import jwt from 'jsonwebtoken';
import { prisma } from '@octant/db';
import { schema } from './schema/index.js';
import {
  authConfig,
  corsConfig,
  securityHeadersConfig,
  graphqlSecurityConfig,
  logAuthConfig,
} from './config/auth.js';
import type { Context, RequestWithCookies } from './builder.js';
import {
  validateCsrf,
  extractRefreshToken,
  generateCsrfToken,
  setCsrfCookie,
  CSRF_HEADER_NAME,
} from './middleware/csrf.js';
import { logger, yogaLogger } from './utils/logger.js';
import { audit, auditWarn, AuditEvent } from './utils/audit.js';

const PORT = process.env['GRAPHQL_PORT'] ?? 4001;

/**
 * Maximum request body size (1MB).
 * Prevents memory exhaustion DoS attacks from large payloads.
 */
const MAX_BODY_SIZE = 1024 * 1024; // 1MB


/**
 * Set security headers on response
 */
function setSecurityHeaders(res: ServerResponse): void {
  const headers = securityHeadersConfig;

  // HSTS - only in production (requires HTTPS)
  if (headers.enableHSTS) {
    const hsts = `max-age=${headers.hstsMaxAge}${headers.hstsIncludeSubdomains ? '; includeSubDomains' : ''}`;
    res.setHeader('Strict-Transport-Security', hsts);
  }

  res.setHeader('X-Content-Type-Options', headers.contentTypeOptions);
  res.setHeader('X-Frame-Options', headers.frameOptions);
  res.setHeader('Content-Security-Policy', headers.contentSecurityPolicy);
  res.setHeader('Referrer-Policy', headers.referrerPolicy);
  res.setHeader('X-XSS-Protection', '0'); // Deprecated, disable per OWASP
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Handle CORS preflight and set headers
 */
function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  const cors = corsConfig;

  if (origin && cors.origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', String(cors.credentials));
    res.setHeader('Access-Control-Allow-Methods', cors.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Expose-Headers', cors.exposedHeaders.join(', '));
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true; // Request handled
  }

  return false; // Continue processing
}

/**
 * Build GraphQL Armor plugin with environment-aware settings
 */
function buildArmorPlugin() {
  const config = graphqlSecurityConfig;

  return EnvelopArmorPlugin({
    // Limit query depth
    maxDepth: {
      n: config.maxDepth,
      propagateOnRejection: true,
    },
    // Limit aliases to prevent batching attacks
    maxAliases: {
      n: config.maxAliases,
      propagateOnRejection: true,
    },
    // Limit directives
    maxDirectives: {
      n: config.maxDirectives,
      propagateOnRejection: true,
    },
    // Limit tokens (query size)
    maxTokens: {
      n: config.maxTokens,
      propagateOnRejection: true,
    },
    // Cost limit (query complexity)
    costLimit: {
      maxCost: config.maxComplexity,
      objectCost: 2,
      scalarCost: 1,
      depthCostFactor: 1.5,
      propagateOnRejection: true,
    },
    // Block field suggestions in errors (information leakage)
    blockFieldSuggestion: {
      enabled: !authConfig.isDevelopment,
    },
  });
}

/**
 * Build list of plugins based on environment
 */
function buildPlugins() {
  const plugins = [];

  // Cookie plugin for HttpOnly refresh tokens
  plugins.push(useCookies());

  // Always add GraphQL Armor
  plugins.push(buildArmorPlugin());

  // Disable introspection in non-dev environments
  if (graphqlSecurityConfig.disableIntrospection) {
    plugins.push(useDisableIntrospection());
  }

  return plugins;
}

/**
 * JWT payload interface with standard claims
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
 * Check if request contains a mutation by parsing the query
 */
function isMutationRequest(body: { query?: string }): boolean {
  const query = body.query?.trim();
  if (!query) return false;

  // Check if query starts with 'mutation' keyword
  // Also handle named mutations like 'mutation LoginUser { ... }'
  return query.startsWith('mutation') || /^mutation\s+\w+/.test(query);
}

/**
 * List of mutations that are exempt from CSRF validation.
 * These are public mutations that don't require authentication.
 */
const CSRF_EXEMPT_MUTATIONS = ['login', 'signup', 'refreshToken', 'logout'];

/**
 * Check if the mutation is exempt from CSRF validation
 */
function isCsrfExemptMutation(body: { query?: string }): boolean {
  const query = body.query?.trim();
  if (!query) return false;

  // Check if any exempt mutation is in the query
  return CSRF_EXEMPT_MUTATIONS.some(mutation => {
    // Match mutation name in the query (e.g., 'login(' or 'signup {')
    const regex = new RegExp(`\\b${mutation}\\s*[({]`, 'i');
    return regex.test(query);
  });
}

/**
 * Create GraphQL Yoga instance with the schema and security controls.
 */
const yoga = createYoga<object, Context>({
  schema,

  // Enable GraphiQL only in development
  graphiql: graphqlSecurityConfig.enableGraphiQL,
  landingPage: false,

  // Pino logging integration
  logging: yogaLogger,

  // Security plugins
  plugins: buildPlugins(),

  // Query batching configuration
  batching: graphqlSecurityConfig.disableMutationBatching
    ? false // Disable batching entirely in prod/staging
    : { limit: graphqlSecurityConfig.maxBatchSize },

  // Context builder with JWT verification
  context: async ({ request }): Promise<Context> => {
    // Generate request ID for correlation
    const requestId = request.headers.get('x-request-id') ?? randomUUID();

    // Extract client info for rate limiting and logging
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    // Extract and verify access token from Authorization header
    const authHeader = request.headers.get('authorization');
    let currentUser = null;
    let sessionId: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        // Verify with explicit algorithm allowlist and claims validation
        const decoded = jwt.verify(token, authConfig.jwtSecret, {
          algorithms: [authConfig.jwtAlgorithm],
          issuer: authConfig.jwtIssuer,
          audience: authConfig.jwtAudience,
        }) as JwtPayload;

        // Use 'sub' claim as the user ID (RFC 8725 compliant)
        const userId = decoded.sub;
        // Use 'jti' claim as the session ID
        sessionId = decoded.jti;

        if (userId) {
          currentUser = await prisma.user.findUnique({
            where: { id: userId },
          });
        }
      } catch (error) {
        // Log verification failures for monitoring (but don't leak details to client)
        if (error instanceof jwt.TokenExpiredError) {
          logger.debug({ requestId, event: AuditEvent.TOKEN_EXPIRED }, 'Token expired');
        } else if (error instanceof jwt.JsonWebTokenError) {
          auditWarn(
            AuditEvent.TOKEN_INVALID,
            { ipAddress, userAgent, requestId },
            { error: (error as Error).message },
            'Invalid JWT'
          );
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
      // Pass request with cookieStore from the cookies plugin
      request: request as RequestWithCookies,
    };
  },

  // Mask errors in non-dev environments to prevent information leakage
  maskedErrors: !authConfig.isDevelopment,
});

/**
 * Create HTTP server with security middleware
 */
const server = createServer(async (req, res) => {
  // Set security headers on all responses
  setSecurityHeaders(res);

  // Handle CORS
  if (handleCors(req, res)) {
    return; // Preflight handled
  }

  // Add request ID header to response
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
  res.setHeader('X-Request-ID', requestId);

  // Set CSRF cookie if not present (for browser clients)
  const cookieHeader = req.headers.cookie || '';
  const hasCsrfCookie = cookieHeader.includes('csrf') || cookieHeader.includes('__Host-csrf');
  if (!hasCsrfCookie && req.method === 'GET') {
    // Only set on GET requests (initial page load)
    setCsrfCookie(res, generateCsrfToken());
  }

  // For POST requests, check CSRF for mutations
  if (req.method === 'POST') {
    // Read body with size limit to prevent memory exhaustion
    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of req) {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          errors: [{
            message: 'Request body too large',
            extensions: { code: 'PAYLOAD_TOO_LARGE', maxSize: MAX_BODY_SIZE },
          }],
        }));
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const bodyBuffer = Buffer.concat(chunks);
    const bodyString = bodyBuffer.toString();

    let body: { query?: string } = {};
    try {
      body = JSON.parse(bodyString);
    } catch {
      // Invalid JSON - let Yoga handle the error
    }

    // Check CSRF for non-exempt mutations
    if (isMutationRequest(body) && !isCsrfExemptMutation(body)) {
      // Create a Request object for CSRF validation
      const request = new Request(`http://localhost${req.url}`, {
        method: 'POST',
        headers: Object.entries(req.headers).reduce((acc, [key, value]) => {
          if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
          return acc;
        }, {} as Record<string, string>),
        body: bodyString,
      });

      if (!validateCsrf(request)) {
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
          ?? (req.headers['x-real-ip'] as string)
          ?? 'unknown';
        const userAgent = (req.headers['user-agent'] as string) ?? 'unknown';

        auditWarn(
          AuditEvent.CSRF_FAILED,
          { ipAddress, userAgent, requestId },
          { query: body.query?.slice(0, 100) },
          'CSRF validation failed'
        );

        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          errors: [{
            message: 'CSRF validation failed',
            extensions: { code: 'FORBIDDEN' },
          }],
        }));
        return;
      }
    }

    // Create a new request with the body we already read
    const request = new Request(`http://localhost${req.url}`, {
      method: 'POST',
      headers: Object.entries(req.headers).reduce((acc, [key, value]) => {
        if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
        return acc;
      }, {} as Record<string, string>),
      body: bodyString,
    });

    // Execute GraphQL - cookies are set automatically by the useCookies plugin
    // when resolvers call context.request.cookieStore.set()
    const response = await yoga.fetch(request);

    // Copy response headers (includes Set-Cookie from the cookies plugin)
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Set status and send body
    res.writeHead(response.status);
    res.end(await response.text());
    return;
  }

  // Delegate GET and other requests to Yoga
  yoga(req, res);
});

/**
 * Start the server
 */
server.listen(PORT, () => {
  // Log configuration on startup
  logAuthConfig();

  logger.info({
    port: PORT,
    env: authConfig.env,
    graphiql: graphqlSecurityConfig.enableGraphiQL,
    security: {
      maxDepth: graphqlSecurityConfig.maxDepth,
      maxComplexity: graphqlSecurityConfig.maxComplexity,
      maxAliases: graphqlSecurityConfig.maxAliases,
    },
  }, `GraphQL server running on http://localhost:${PORT}/graphql`);
});
