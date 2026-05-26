/**
 * REST HTTP Server
 *
 * Production-ready Express server with:
 * - Health check endpoints (/health, /ready)
 * - Graceful shutdown
 * - CORS handling
 * - Security headers
 */

import { createServer } from 'node:http';
import { prisma } from '@octant/db-postgres';
import { authConfig, logAuthConfig } from './config/auth.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

const PORT = process.env['REST_PORT'] ?? 4000;

// Create app using the factory
const app = createApp();

// Create HTTP server for graceful shutdown
const server = createServer(app);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully...');
  server.close();
  await prisma.$disconnect();
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.listen(Number(PORT), () => {
  logAuthConfig();
  logger.info({ port: PORT, env: authConfig.env }, `REST server running on http://localhost:${PORT}`);
});
