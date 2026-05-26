/**
 * GraphQL Schema Assembly
 *
 * This module imports all type definitions, queries, and mutations,
 * then builds and exports the complete GraphQL schema.
 *
 * Types are derived from Prisma schema via @pothos/plugin-prisma,
 * eliminating drift between Prisma models and GraphQL types.
 *
 * SECURITY: Default deny policy is enforced via authScopes on root types.
 * All queries and mutations require authentication unless explicitly marked public.
 */

import { builder } from '../builder.js';

// Import type definitions (order matters - dependencies first)
import './types/session.js';
import './types/user.js';
import './types/weather.js';

// Import queries
import './queries/user.js';
import './queries/auth.js';
import './queries/weather.js';

// Import mutations
import './mutations/auth.js';

/**
 * Root Query type with default authentication requirement.
 *
 * All query fields require authentication unless they explicitly set:
 *   authScopes: { public: true }
 */
builder.queryType({
  description: 'Root query type',
  authScopes: {
    authenticated: true,
  },
});

/**
 * Root Mutation type with default authentication requirement.
 *
 * All mutation fields require authentication unless they explicitly set:
 *   authScopes: { public: true }
 */
builder.mutationType({
  description: 'Root mutation type',
  authScopes: {
    authenticated: true,
  },
});

/**
 * The complete GraphQL schema built from all type definitions,
 * queries, and mutations.
 */
export const schema = builder.toSchema();
