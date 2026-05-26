/**
 * User GraphQL Type Definition
 *
 * Defines the User object type for the GraphQL schema using Pothos Prisma plugin.
 * Types are auto-generated from the Prisma schema to eliminate drift.
 *
 * Security: Field-level authorization is applied to sensitive fields:
 * - email: Only visible to the user themselves
 * - sessions: Only visible to the user themselves
 */

import { builder } from '../../builder.js';

/**
 * User object type representing a user in the system.
 * Fields are derived directly from the Prisma User model.
 *
 * Field-level authorization:
 * - id, name, createdAt, updatedAt: Visible to any authenticated user
 * - email: Only visible to the owner (prevents email harvesting)
 * - sessions: Only visible to the owner (security-sensitive)
 */
builder.prismaObject('User', {
  description: 'A user in the system',
  fields: (t) => ({
    id: t.exposeID('id', {
      description: 'Unique identifier for the user',
    }),
    name: t.exposeString('name', {
      description: 'Display name of the user',
    }),
    createdAt: t.expose('createdAt', {
      type: 'Date',
      description: 'Timestamp when the user was created',
    }),
    updatedAt: t.expose('updatedAt', {
      type: 'Date',
      description: 'Timestamp when the user was last updated',
    }),

    /**
     * Email field - OWNER ONLY
     *
     * Security: Email addresses are sensitive PII and should only be
     * visible to the user themselves. This prevents email harvesting
     * and user enumeration attacks.
     */
    email: t.exposeString('email', {
      description: 'Email address of the user (only visible to owner)',
      // Dynamic authorization check: only allow if user is viewing their own data
      // Signature: (parent, args, context, info) => boolean | AuthScopes
      authScopes: (parent, _args, context, _info) => {
        // Allow if the requesting user is viewing their own profile
        return context.currentUser?.id === parent.id;
      },
    }),

    /**
     * Sessions relation - OWNER ONLY
     *
     * Security: Session data contains sensitive information (IP addresses,
     * user agents) and should only be visible to the user themselves.
     * This prevents attackers from enumerating active sessions.
     */
    sessions: t.relation('sessions', {
      description: 'Sessions associated with this user (only visible to owner)',
      // Dynamic authorization check: only allow if user is viewing their own data
      // Signature: (parent, args, context, info) => boolean | AuthScopes
      authScopes: (parent, _args, context, _info) => {
        return context.currentUser?.id === parent.id;
      },
    }),
  }),
});
