/**
 * Auth Query Definitions
 *
 * Defines the `me` query for fetching the current authenticated user.
 * Also provides `mySessions` for viewing active sessions.
 *
 * Security: `me` is public (returns null if not authenticated).
 * `mySessions` requires authentication.
 */

import { prisma } from '@octant/db';
import { builder } from '../../builder.js';

/**
 * Query to fetch the currently authenticated user.
 * Returns null if not authenticated.
 *
 * This is a PUBLIC endpoint - anyone can call it, but it only
 * returns data for authenticated users.
 */
builder.queryField('me', (t) =>
  t.prismaField({
    type: 'User',
    nullable: true,
    description: 'Get the currently authenticated user',
    // Mark as public - this query can be called without authentication
    // It will return null for unauthenticated users
    skipTypeScopes: true,
    resolve: async (query, _parent, _args, context) => {
      if (!context.currentUser) {
        return null;
      }
      // Re-fetch with query optimizations for requested fields
      return prisma.user.findUnique({
        ...query,
        where: { id: context.currentUser.id },
      });
    },
  })
);

/**
 * Query to list all active sessions for the current user.
 *
 * Security: Requires authentication. Users can only see their own sessions.
 */
builder.queryField('mySessions', (t) =>
  t.prismaField({
    type: ['Session'],
    description: 'List all active sessions for the current user',
    // Inherits authentication requirement from root Query type
    resolve: async (query, _parent, _args, context) => {
      // Context is guaranteed to have currentUser due to auth scope
      const userId = context.currentUser!.id;

      return prisma.session.findMany({
        ...query,
        where: {
          userId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      });
    },
  })
);
