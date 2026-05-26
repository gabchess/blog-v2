import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  return {
    resolve: {
      alias: {
        '@signing': resolve(__dirname, 'src/signing'),
        '@serialization': resolve(__dirname, 'src/serialization'),
        '@storage': resolve(__dirname, 'src/storage'),
        '@merkle': resolve(__dirname, 'src/merkle'),
        '@batch': resolve(__dirname, 'src/batch'),
        '@math': resolve(__dirname, 'src/math'),
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
      env,
    },
  };
});
