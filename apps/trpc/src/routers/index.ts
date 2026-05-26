/**
 * App Router Composition
 *
 * Aggregates all domain routers into the main appRouter.
 * Export the AppRouter type for client usage.
 */

import { router } from '../trpc.js';
import { authRouter } from './auth.js';
import { userRouter } from './user.js';
import { sessionRouter } from './session.js';
import { postRouter } from './post.js';

/**
 * Main application router.
 * Composes all domain routers into a single entry point.
 */
export const appRouter = router({
  auth: authRouter,
  user: userRouter,
  session: sessionRouter,
  post: postRouter,
});

/**
 * Export type for client usage.
 * Clients import this type to get full type inference.
 *
 * @example
 * ```typescript
 * import type { AppRouter } from '@octant/trpc';
 * import { createTRPCClient } from '@trpc/client';
 *
 * const trpc = createTRPCClient<AppRouter>({
 *   links: [httpBatchLink({ url: 'http://localhost:4002' })],
 * });
 * ```
 */
export type AppRouter = typeof appRouter;
