/**
 * User Router
 *
 * User profile procedures following ADR-106.
 * Implements: me, update
 */

import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@octant/db';
import { router, protectedProcedure } from '../trpc.js';
import { authConfig } from '../config/auth.js';
import { TRPCError } from '@trpc/server';

/**
 * Output schema for user profile - prevents leaking passwordHash.
 */
const UserOutputSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Input schema for profile updates.
 */
const UpdateProfileInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

/**
 * Input schema for password change.
 */
const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(64),
});

export const userRouter = router({
  /**
   * me - Get current user's profile.
   */
  me: protectedProcedure
    .output(UserOutputSchema)
    .query(async ({ ctx }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.currentUser.id },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      return user;
    }),

  /**
   * update - Update current user's profile.
   */
  update: protectedProcedure
    .input(UpdateProfileInputSchema)
    .output(UserOutputSchema)
    .mutation(async ({ input, ctx }) => {
      // Check if email is being changed and already exists
      if (input.email) {
        const existing = await prisma.user.findUnique({
          where: { email: input.email.toLowerCase() },
        });
        if (existing && existing.id !== ctx.currentUser.id) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
        }
      }

      const user = await prisma.user.update({
        where: { id: ctx.currentUser.id },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.email && { email: input.email.toLowerCase() }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return user;
    }),

  /**
   * changePassword - Change current user's password.
   */
  changePassword: protectedProcedure
    .input(ChangePasswordInputSchema)
    .output(z.boolean())
    .mutation(async ({ input, ctx }) => {
      // Get full user with passwordHash
      const user = await prisma.user.findUnique({
        where: { id: ctx.currentUser.id },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Verify current password
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(input.newPassword, authConfig.bcryptRounds);

      // Update password
      await prisma.user.update({
        where: { id: ctx.currentUser.id },
        data: { passwordHash },
      });

      return true;
    }),
});
