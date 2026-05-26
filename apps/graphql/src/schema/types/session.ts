/**
 * Session GraphQL Type Definition
 *
 * Defines the Session object type for the GraphQL schema using Pothos Prisma plugin.
 * Types are auto-generated from the Prisma schema to eliminate drift.
 *
 * Security:
 * - tokenHash is NOT exposed - only safe session metadata is returned.
 * - Sessions are only visible to their owner (enforced via User.sessions relation).
 * - The user relation is removed to prevent reverse lookups.
 */

import { builder } from '../../builder.js';

/**
 * Session object type representing a user session in the system.
 * Only safe fields are exposed - token hashes are never sent to clients.
 *
 * Note: This type is protected at the relation level (User.sessions has
 * ownership check). Direct session queries should also enforce ownership.
 */
builder.prismaObject('Session', {
  description: 'A user session (token data is hidden for security)',
  fields: (t) => ({
    id: t.exposeID('id', {
      description: 'Unique identifier for the session',
    }),
    expiresAt: t.expose('expiresAt', {
      type: 'Date',
      description: 'Timestamp when the session expires',
    }),
    createdAt: t.expose('createdAt', {
      type: 'Date',
      description: 'Timestamp when the session was created',
    }),
    lastUsedAt: t.expose('lastUsedAt', {
      type: 'Date',
      description: 'Timestamp when the session was last used',
    }),
    ipAddress: t.exposeString('ipAddress', {
      description: 'IP address of the client',
      nullable: true,
    }),
    userAgent: t.exposeString('userAgent', {
      description: 'User agent of the client',
      nullable: true,
    }),

    /**
     * Computed field indicating if this is the current session.
     * Useful for UIs showing "Current session" badge.
     */
    isCurrent: t.boolean({
      description: 'Whether this is the current session',
      resolve: (session, _args, context) => {
        // Compare session ID with the jti claim from the JWT
        return context.sessionId === session.id;
      },
    }),

    // SECURITY: Remove user relation to prevent reverse lookups.
    // Sessions should only be accessed through User.sessions which
    // has ownership protection.
    // user: t.relation('user', { ... })  // REMOVED
  }),
});
