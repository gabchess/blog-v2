/**
 * Post Router
 *
 * Example CRUD router following ADR-104 patterns.
 * Note: Post model doesn't exist in schema yet - this is a template.
 */

import { z } from 'zod';
// import { prisma } from '@octant/db';  // Uncomment when Post model exists
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';

/**
 * Output schema for posts.
 */
const PostOutputSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  content: z.string(),
  published: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Input schema for creating posts.
 */
const CreatePostInputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  published: z.boolean().optional().default(false),
});

/**
 * Input schema for updating posts.
 */
const UpdatePostInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(10000).optional(),
  published: z.boolean().optional(),
});

// NOTE: This router is a template. The Post model needs to be added to the Prisma schema first.
// Uncomment and use when the Post model is available.

export const postRouter = router({
  /**
   * list - Get all published posts.
   */
  list: publicProcedure
    .output(z.array(PostOutputSchema))
    .query(async () => {
      // TODO: Implement when Post model exists
      // return prisma.post.findMany({
      //   where: { published: true },
      //   orderBy: { createdAt: 'desc' },
      // });
      return [];
    }),

  /**
   * byId - Get a single post by ID.
   */
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(PostOutputSchema.nullable())
    .query(async ({ input: _input }) => {
      // TODO: Implement when Post model exists
      // return prisma.post.findUnique({
      //   where: { id: input.id },
      // });
      return null;
    }),

  /**
   * myPosts - Get current user's posts.
   */
  myPosts: protectedProcedure
    .output(z.array(PostOutputSchema))
    .query(async ({ ctx: _ctx }) => {
      // TODO: Implement when Post model exists
      // return prisma.post.findMany({
      //   where: { userId: ctx.currentUser.id },
      //   orderBy: { createdAt: 'desc' },
      // });
      return [];
    }),

  /**
   * create - Create a new post.
   */
  create: protectedProcedure
    .input(CreatePostInputSchema)
    .output(PostOutputSchema)
    .mutation(async ({ input: _input, ctx: _ctx }) => {
      // TODO: Implement when Post model exists
      // return prisma.post.create({
      //   data: {
      //     ...input,
      //     userId: ctx.currentUser.id,
      //   },
      // });
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Post model not yet implemented',
      });
    }),

  /**
   * update - Update an existing post with ownership check.
   */
  update: protectedProcedure
    .input(UpdatePostInputSchema)
    .output(PostOutputSchema)
    .mutation(async ({ input: _input, ctx: _ctx }) => {
      // TODO: Implement when Post model exists
      // const post = await prisma.post.findUnique({
      //   where: { id: input.id },
      // });
      //
      // // IDOR prevention
      // if (!post || post.userId !== ctx.currentUser.id) {
      //   throw new TRPCError({ code: 'NOT_FOUND', message: 'Post not found' });
      // }
      //
      // const { id, ...data } = input;
      // return prisma.post.update({
      //   where: { id },
      //   data,
      // });
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Post model not yet implemented',
      });
    }),

  /**
   * delete - Delete a post with ownership check.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input: _input, ctx: _ctx }) => {
      // TODO: Implement when Post model exists
      // const post = await prisma.post.findUnique({
      //   where: { id: input.id },
      // });
      //
      // // IDOR prevention
      // if (!post || post.userId !== ctx.currentUser.id) {
      //   throw new TRPCError({ code: 'NOT_FOUND', message: 'Post not found' });
      // }
      //
      // await prisma.post.delete({ where: { id: input.id } });
      // return { success: true };
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Post model not yet implemented',
      });
    }),
});
