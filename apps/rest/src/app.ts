/**
 * Express Application Factory
 *
 * Creates an Express app instance that can be used by both
 * the production server (index.ts) and tests.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '@octant/db-postgres';
import { corsConfig } from './config/auth.js';
import { authRouter } from './routes/auth.js';
import { qfRouter } from './routes/qf.js';
import { setupOpenAPI } from './openapi.js';

const MAX_BODY_SIZE = '1mb';

/**
 * Create a configured Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // Body parsing
  app.use(express.json({ limit: MAX_BODY_SIZE }));

  // Security headers (matching tRPC/GraphQL, relaxed for Swagger UI)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Relaxed CSP for Swagger UI, strict for API endpoints
    if (req.path.startsWith('/api-docs')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
      );
    } else {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  });

  // CORS middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && corsConfig.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', String(corsConfig.credentials));
      res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(', '));
      res.setHeader('Access-Control-Expose-Headers', corsConfig.exposedHeaders?.join(', ') ?? '');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // OpenAPI documentation
  setupOpenAPI(app);

  // Health endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not ready' });
    }
  });

  // Auth routes
  app.use('/auth', authRouter);

  // QF Simulation routes
  app.use('/qf', qfRouter);

  return app;
}
