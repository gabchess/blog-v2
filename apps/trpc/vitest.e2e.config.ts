import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.e2e.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'mongodb://localhost:27017/octant_test?replicaSet=rs0',
      ENV: 'development',
    },
  },
});
