/**
 * Session Router
 *
 * Session management procedures following ADR-106.
 * Implements: mySessions, revoke, revokeAll
 */

import { z } from 'zod';
import { prisma } from '@octant/db';
import { router, protectedProcedure } from '../trpc.js';
import { audit, getAuditContext, AuditEvent } from '../utils/audit.js';
import { TRPCError } from '@trpc/server';

/**
 * Output schema for sessions - prevents leaking tokenHash.
 */
const SessionOutputSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  isCurrent: z.boolean(),
});

export const sessionRouter = router({
  /**
   * mySessions - List current user's active sessions.
   */
  mySessions: protectedProcedure
    .output(z.array(SessionOutputSchema))
    .query(async ({ ctx }) => {
      const sessions = await prisma.session.findMany({
        where: {
          userId: ctx.currentUser.id,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { lastUsedAt: 'desc' },
      });

      return sessions.map(session => ({
        ...session,
        isCurrent: session.id === ctx.sessionId,
      }));
    }),

  /**
   * revoke - Revoke a specific session by ID.
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.boolean())
    .mutation(async ({ input, ctx }) => {
      // Find the session
      const session = await prisma.session.findUnique({
        where: { id: input.id },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // IDOR prevention: Only allow revoking own sessions
      if (session.userId !== ctx.currentUser.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot revoke another user\'s session',
        });
      }

      // Prevent revoking current session
      if (ctx.sessionId && session.id === ctx.sessionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot revoke current session. Use logout instead.',
        });
      }

      await prisma.session.delete({
        where: { id: input.id },
      });

      audit(
        AuditEvent.SESSION_REVOKED,
        getAuditContext(ctx),
        { revokedSessionId: input.id },
        'Session revoked'
      );

      return true;
    }),

  /**
   * revokeAll - Revoke all sessions except current.
   */
  revokeAll: protectedProcedure
    .output(z.number())
    .mutation(async ({ ctx }) => {
      // Delete all sessions except current
      const result = await prisma.session.deleteMany({
        where: {
          userId: ctx.currentUser.id,
          id: ctx.sessionId ? { not: ctx.sessionId } : undefined,
        },
      });

      audit(
        AuditEvent.LOGOUT_ALL,
        getAuditContext(ctx),
        { sessionsRevoked: result.count },
        'User revoked all other sessions'
      );

      return result.count;
    }),
});
