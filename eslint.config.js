import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Base config shared by all packages
const baseConfig = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }
);

// Node.js environment (packages and api)
export const nodeConfig = tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.node,
    },
  }
);

// Browser environment (web app)
export const browserConfig = tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.browser,
    },
  }
);

// Default export for root-level linting
export default baseConfig;
