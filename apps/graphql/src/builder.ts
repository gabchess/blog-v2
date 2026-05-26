/**
 * Pothos SchemaBuilder Setup with Prisma and Scope Auth Plugins
 *
 * This module configures the Pothos schema builder with:
 * - Prisma plugin: Auto-generates GraphQL types from Prisma models
 * - Scope Auth plugin: Declarative authorization with default deny policy
 *
 * Security: All queries and mutations require authentication by default.
 * Public endpoints must be explicitly marked with { public: true } scope.
 */

import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type PrismaTypes from '@pothos/plugin-prisma/generated';
import { GraphQLError } from 'graphql';
import { prisma, Prisma, type User } from '@octant/db';
import { AuthenticationError, AuthorizationError } from './utils/auth.js';

/**
 * Extended Request type with cookieStore from the cookies plugin.
 * The cookieStore is added by @whatwg-node/server-plugin-cookies.
 */
export interface RequestWithCookies {
  headers: Headers;
  cookieStore?: {
    get(name: string): Promise<{ name: string; value: string } | null>;
    set(options: {
      name: string;
      value: string;
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'strict' | 'lax' | 'none';
    }): Promise<void>;
    delete(name: string): Promise<void>;
  };
}

/**
 * GraphQL context type containing the authenticated user and request metadata.
 */
export interface Context {
  /** The authenticated user (null if not authenticated) */
  currentUser: User | null;
  /** Current session ID from JWT jti claim (null if not authenticated) */
  sessionId: string | null;
  /** Client IP address for rate limiting */
  ipAddress: string;
  /** Client User-Agent for session tracking */
  userAgent: string;
  /** Request ID for log correlation */
  requestId: string;
  /** Request object with cookieStore for setting HttpOnly cookies */
  request: RequestWithCookies;
}

/**
 * Auth scopes for the Pothos Scope Auth plugin.
 *
 * - public: Allows unauthenticated access (must be explicitly set)
 * - authenticated: Requires any authenticated user
 * - isOwner: Dynamic scope for ownership checks (evaluated per-field)
 */
export interface AuthScopes {
  public: boolean;
  authenticated: boolean;
}

/**
 * Type definitions for Pothos schema builder.
 * Uses auto-generated PrismaTypes from the Prisma schema.
 */
export interface PothosTypes {
  PrismaTypes: PrismaTypes;
  Scalars: {
    Date: {
      Input: Date;
      Output: Date;
    };
  };
  Context: Context;
  AuthScopes: AuthScopes;
  AuthContexts: {
    authenticated: Context & { currentUser: User };
  };
}

/**
 * Configured Pothos schema builder instance with Prisma and Scope Auth plugins.
 * Use this builder to define all GraphQL types, queries, and mutations.
 *
 * IMPORTANT: Default policy is "authenticated required".
 * All fields require authentication unless explicitly marked with:
 *   authScopes: { public: true }
 */
export const builder = new SchemaBuilder<PothosTypes>({
  plugins: [ScopeAuthPlugin, PrismaPlugin],
  prisma: {
    client: prisma,
    dmmf: Prisma.dmmf,
  },
  scopeAuth: {
    // Evaluate auth scopes for each request
    authScopes: async (context) => ({
      // Public scope is always true (used for opt-out)
      public: true,
      // Authenticated scope checks if user exists in context
      authenticated: !!context.currentUser,
    }),

    // Error thrown when authentication is required but user is not authenticated
    unauthorizedError: (_parent, _context, _info, _result) => {
      return new AuthenticationError('Authentication required');
    },
  },
});

// Register custom Date scalar
builder.scalarType('Date', {
  serialize: (value) => value.toISOString(),
  parseValue: (value) => new Date(value as string),
});
