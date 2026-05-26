/**
 * User Query Definitions
 *
 * Defines GraphQL queries for fetching users using Pothos Prisma plugin.
 * All queries require authentication via the root Query type authScopes.
 *
 * Security:
 * - users: Admin-only (currently disabled until RBAC is implemented)
 * - user: Users can ONLY fetch their own data (use 'me' query instead)
 *
 * Note: For fetching current user data, prefer the 'me' query in auth.ts
 * which is the recommended pattern for client applications.
 */

import { prisma } from '@octant/db';
import { builder } from '../../builder.js';
import { AuthorizationError } from '../../utils/auth.js';

/**
 * Query to fetch all users.
 * ADMIN ONLY - Currently disabled until role-based access control is implemented.
 * Regular users should use the 'me' query to fetch their own data.
 */
builder.queryField('users', (t) =>
  t.prismaField({
    type: ['User'],
    description: 'Fetch all users (admin only)',
    // Inherits authentication requirement from root Query type
    resolve: () => {
      // Admin-only: Until role-based access control is implemented,
      // this endpoint is disabled to prevent user enumeration attacks.
      // Users should use the 'me' query to fetch their own data.
      throw new AuthorizationError('Admin access required. Use the "me" query to fetch your own data.');
    },
  })
);

/**
 * Query to fetch a single user by ID.
 * Users can ONLY fetch their own data - use 'me' query instead.
 * This exists for admin functionality (future: role-based access).
 */
builder.queryField('user', (t) =>
  t.prismaField({
    type: 'User',
    nullable: true,
    description: 'Fetch a user by ID (own data only, prefer "me" query)',
    args: {
      id: t.arg.string({ required: true, description: 'The user ID' }),
    },
    // Inherits authentication requirement from root Query type
    resolve: (query, _parent, args, context) => {
      // Users can ONLY fetch their own data (IDOR prevention)
      // This prevents user enumeration and unauthorized data access
      if (context.currentUser!.id !== args.id) {
        throw new AuthorizationError('Access denied. You can only fetch your own user data. Use the "me" query instead.');
      }

      return prisma.user.findUnique({
        ...query,
        where: { id: args.id },
      });
    },
  })
);
