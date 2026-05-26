import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.e2e.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Tests are self-contained - they start their own server instance
    // No need for external server or globalSetup
    env: {
      POSTGRES_URL:
        process.env.POSTGRES_URL ||
        'postgresql://postgres:postgres@localhost:5432/octant_test',
      ENV: 'development',
    },
  },
});
