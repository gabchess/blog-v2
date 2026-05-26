import { defineConfig } from 'turbowatch';
import path from 'node:path';

/**
 * Turbowatch configuration for dev server management.
 *
 * Usage:
 *   pnpm dev:watch              # Start all apps with graceful shutdown
 *
 * Graceful shutdown: Ctrl+C sends SIGTERM to all spawned processes.
 */

// Helper to create a backend trigger (tsx watch)
function backendTrigger(name: string, appDir: string) {
  const appPath = path.join(__dirname, 'apps', appDir);
  return {
    expression: [
      'anyof',
      ['match', '*.ts', 'basename'],
      ['match', '*.json', 'basename'],
    ],
    interruptible: true,
    name,
    initialRun: true,
    onChange: async ({ spawn }: { spawn: any }) => {
      await spawn`pnpm --filter @octant/${appDir} dev`;
    },
    persistent: true,
    onTeardown: async () => {
      console.log(`[${name}] Shutting down gracefully...`);
    },
  };
}

// Helper to create a frontend trigger (vite)
function frontendTrigger(name: string, appDir: string) {
  return {
    expression: [
      'anyof',
      ['match', '*.ts', 'basename'],
      ['match', '*.tsx', 'basename'],
      ['match', '*.json', 'basename'],
    ],
    interruptible: true,
    name,
    initialRun: true,
    onChange: async ({ spawn }: { spawn: any }) => {
      await spawn`pnpm --filter @octant/${appDir} dev`;
    },
    persistent: true,
    onTeardown: async () => {
      console.log(`[${name}] Shutting down gracefully...`);
    },
  };
}

export default defineConfig({
  project: __dirname,
  triggers: [
    // Backend APIs
    backendTrigger('rest', 'rest'),
    backendTrigger('graphql', 'graphql'),
    backendTrigger('trpc', 'trpc'),

    // Frontend Apps
    frontendTrigger('web', 'web'),
    frontendTrigger('admin', 'admin'),
    frontendTrigger('widget', 'widget'),
  ],
});
