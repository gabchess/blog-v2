/**
 * Authorization Utilities
 *
 * Provides helper functions and error types for authorization checks.
 * Used throughout resolvers for consistent authorization handling.
 */

import { GraphQLError } from 'graphql';
import type { User } from '@octant/db';
import type { Context } from '../builder.js';

/**
 * GraphQL error for authentication failures.
 */
export class AuthenticationError extends GraphQLError {
  constructor(message = 'Authentication required') {
    super(message, {
      extensions: {
        code: 'UNAUTHENTICATED',
        http: { status: 401 },
      },
    });
  }
}

/**
 * GraphQL error for authorization failures.
 */
export class AuthorizationError extends GraphQLError {
  constructor(message = 'Access denied') {
    super(message, {
      extensions: {
        code: 'FORBIDDEN',
        http: { status: 403 },
      },
    });
  }
}

/**
 * Context type with authenticated user (non-null).
 */
export type AuthenticatedContext = Context & {
  currentUser: User;
};

/**
 * Assert that the current user is authenticated.
 * Throws AuthenticationError if not authenticated.
 */
export function requireAuth(context: Context): asserts context is AuthenticatedContext {
  if (!context.currentUser) {
    throw new AuthenticationError();
  }
}

/**
 * Assert that the current user owns the specified resource.
 * Throws AuthorizationError if not the owner.
 */
export function requireOwnership(context: Context, resourceUserId: string): void {
  requireAuth(context);

  if (context.currentUser.id !== resourceUserId) {
    throw new AuthorizationError('You do not have access to this resource');
  }
}

/**
 * Assert that the current user is an admin.
 * Note: Role field does not exist yet - this is a placeholder for future RBAC.
 */
export function requireAdmin(context: Context): void {
  requireAuth(context);

  // TODO: Implement when role field is added to User model
  // if (context.currentUser.role !== 'ADMIN') {
  //   throw new AuthorizationError('Admin access required');
  // }

  // For now, always deny admin access since RBAC is not implemented
  throw new AuthorizationError('Admin access required');
}

/**
 * Assert ownership or admin access.
 */
export function requireOwnershipOrAdmin(context: Context, resourceUserId: string): void {
  requireAuth(context);

  const isOwner = context.currentUser.id === resourceUserId;
  // const isAdmin = context.currentUser.role === 'ADMIN';

  // For now, only check ownership since RBAC is not implemented
  if (!isOwner) {
    throw new AuthorizationError('You do not have access to this resource');
  }
}

/**
 * Check if the current user is authenticated (returns boolean, doesn't throw).
 */
export function isAuthenticated(context: Context): context is AuthenticatedContext {
  return context.currentUser !== null;
}

/**
 * Check if the current user owns the specified resource.
 */
export function isOwner(context: Context, resourceUserId: string): boolean {
  return isAuthenticated(context) && context.currentUser.id === resourceUserId;
}
