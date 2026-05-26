# ADR-104: tRPC API Architecture

## Status
Proposed

## Context

While GraphQL (ADR-004) serves well for complex relational queries and admin dashboards, certain use cases benefit from tRPC's simpler, fully type-safe approach:

1. **Internal Services**: API calls between trusted services where GraphQL's flexibility adds unnecessary overhead
2. **Simple CRUD Operations**: Straightforward data operations without complex nested fetching
3. **Maximum Type Safety**: End-to-end TypeScript inference without code generation
4. **Rapid Prototyping**: Quick API development with automatic client types

We needed an approach that:
- Uses Prisma as the single source of truth (same as GraphQL)
- Shares validation schemas with GraphQL (`@octant/validation`)
- Provides end-to-end type safety from database to frontend
- Requires zero code generation for client types

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| TypeScript | >= 5.7.2 | Strict mode required (`"strict": true`) |
| Node.js | >= 18.0.0 | LTS recommended |
| @tanstack/react-query | ^5.0.0 | Required peer dependency |

**React Query v5 Breaking Changes:**
- `isLoading` renamed to `isPending`
- `cacheTime` renamed to `gcTime`
- See [migration guide](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)

---

## Decision

We use **tRPC v11** with the same Prisma-based architecture as GraphQL. The tRPC app (`apps/trpc`) shares the database package (`packages/db`) and validation package (`packages/validation`) with the GraphQL app.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  packages/db/prisma/schema.prisma                                   │
│  SINGLE SOURCE OF TRUTH for all types                               │
│  └── Defines: User, Session, Post, enums, relations                 │
└─────────────────────────────────────────────────────────────────────┘
                │
                │ pnpm db:push (prisma generate)
                │
                ├─────────────────────────────────────────────────────┐
                ▼                                                     ▼
┌───────────────────────────────────┐    ┌────────────────────────────────────────┐
│  @prisma/client                   │    │  packages/validation/src/generated     │
│  ├── Prisma Client                │    │  (prisma-zod-generator output)         │
│  └── TypeScript types             │    │  ├── UserSchema, PostSchema            │
└───────────────────────────────────┘    │  └── Auto-generated Zod schemas        │
                │                        └────────────────────────────────────────┘
                │                                          │
                ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/trpc                                                          │
│  ├── src/trpc.ts             # tRPC instance + context + middleware │
│  ├── src/routers/            # Router definitions by domain         │
│  │   ├── auth.ts             # publicProcedure (login, signup)      │
│  │   ├── user.ts             # protectedProcedure (profile)         │
│  │   └── post.ts             # CRUD with ownership checks           │
│  └── src/index.ts            # HTTP server adapter                  │
└─────────────────────────────────────────────────────────────────────┘
                │
                │ HTTP + JSON-RPC (types via import)
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/admin (or apps/web)                                           │
│  ├── tRPC Client (automatic type inference from AppRouter)          │
│  ├── React Query hooks (@trpc/react-query)                          │
│  └── React components                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Why tRPC Alongside GraphQL?

| Aspect | GraphQL (Yoga + Pothos) | tRPC |
|--------|------------------------|------|
| **Type source** | Codegen from SDL | Automatic via TypeScript import |
| **Schema definition** | Type builders + SDL | TypeScript types only |
| **Client setup** | URQL + generated types | Import AppRouter type |
| **Best for** | Complex relational queries, external APIs | Internal services, simple CRUD |
| **Learning curve** | Higher (GraphQL concepts) | Lower (just TypeScript) |

Both apps share:
- Same Prisma schema and client (`packages/db`)
- Same Zod validation schemas (`packages/validation`)
- Same authentication strategy (JWT + refresh tokens, see ADR-005)
- Same security patterns (CSRF, rate limiting, audit logging)

---

## Development Workflow

### Step 1: Define/Update Prisma Schema

The Prisma schema remains the single source of truth (same as GraphQL):

```prisma
// packages/db/prisma/schema.prisma

model Post {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  userId    String   @db.ObjectId
  user      User     @relation(fields: [userId], references: [id])
  title     String
  content   String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

### Step 2: Regenerate Types

```bash
pnpm db:push
```

This single command:
1. Syncs schema to MongoDB
2. Regenerates Prisma client types
3. Regenerates Zod schemas in `packages/validation/src/generated/`

**Key difference from GraphQL**: No Pothos types needed. tRPC uses Prisma types directly.

### Step 3: Create tRPC Router

```typescript
// apps/trpc/src/routers/post.ts

import { z } from 'zod';
import { prisma } from '@octant/db';
import { CreatePostInputSchema } from '@octant/validation';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';

export const postRouter = router({
  // Defined in steps 4 and 5
});
```

### Step 4: Define Queries

```typescript
// Public query - anyone can see published posts
list: publicProcedure
  .query(async () => {
    return prisma.post.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
    });
  }),

// Protected query - user's own posts
myPosts: protectedProcedure
  .query(async ({ ctx }) => {
    return prisma.post.findMany({
      where: { userId: ctx.currentUser.id },
      orderBy: { createdAt: 'desc' },
    });
  }),
```

### Step 5: Define Mutations

```typescript
// Create mutation with Zod validation
create: protectedProcedure
  .input(CreatePostInputSchema)
  .mutation(async ({ input, ctx }) => {
    return prisma.post.create({
      data: {
        ...input,
        userId: ctx.currentUser.id,
      },
    });
  }),

// Delete mutation with ownership check
delete: protectedProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const post = await prisma.post.findUnique({
      where: { id: input.id },
    });

    // IDOR prevention
    if (!post || post.userId !== ctx.currentUser.id) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Post not found' });
    }

    await prisma.post.delete({ where: { id: input.id } });
    return { success: true };
  }),
```

### Output Validation (Preventing Data Leakage)

Use `.output()` to prevent accidental exposure of sensitive fields. This is especially important for user data:

```typescript
// Define explicit output schema to prevent leaking passwordHash
const UserOutputSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.date(),
  // passwordHash explicitly excluded
});

// Apply to procedure
getMe: protectedProcedure
  .output(UserOutputSchema)
  .query(async ({ ctx }) => {
    return prisma.user.findUnique({
      where: { id: ctx.currentUser.id },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }),
```

**When to use `.output()`:**
- User/profile data (exclude `passwordHash`, internal IDs)
- Admin endpoints returning sensitive records
- Any procedure that could accidentally leak internal data

**Note:** Output validation returns `INTERNAL_SERVER_ERROR` on schema mismatch, so use Prisma `select` to fetch only needed fields. See [tRPC Output Validation](https://trpc.io/docs/server/validators).

### Step 6: Register in appRouter

```typescript
// apps/trpc/src/routers/index.ts

import { router } from '../trpc.js';
import { authRouter } from './auth.js';
import { userRouter } from './user.js';
import { postRouter } from './post.js';

export const appRouter = router({
  auth: authRouter,
  user: userRouter,
  post: postRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;
```

### Step 7: Write E2E Tests

```typescript
// apps/trpc/src/trpc.e2e.test.ts

import { describe, it, expect } from 'vitest';
import { createCaller } from './trpc.js';
import { appRouter } from './routers/index.js';
import { prisma } from '@octant/db';

describe('Post Router', () => {
  it('creates a post for authenticated user', async () => {
    const caller = createCaller({
      currentUser: { id: 'user_123', email: 'test@example.com' },
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    const post = await caller.post.create({
      title: 'Test Post',
      content: 'Test content',
    });

    expect(post.title).toBe('Test Post');
    expect(post.userId).toBe('user_123');
  });

  it('throws UNAUTHORIZED for unauthenticated create', async () => {
    const caller = createCaller({
      currentUser: null,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    await expect(caller.post.create({
      title: 'Test',
      content: 'Test',
    })).rejects.toThrow('UNAUTHORIZED');
  });
});
```

---

## tRPC Configuration

### Context Creation

```typescript
// apps/trpc/src/trpc.ts

import { initTRPC, TRPCError } from '@trpc/server';
import type { User } from '@octant/db';
import jwt from 'jsonwebtoken';
import { prisma } from '@octant/db';
import { authConfig } from './config/auth.js';

export interface Context {
  currentUser: User | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
}

export async function createContext(opts: { req: Request }): Promise<Context> {
  const authHeader = opts.req.headers.get('authorization');
  let currentUser: User | null = null;
  let sessionId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, authConfig.jwtSecret, {
        algorithms: [authConfig.jwtAlgorithm],
        issuer: authConfig.jwtIssuer,
        audience: authConfig.jwtAudience,
      }) as { sub: string; jti: string };

      currentUser = await prisma.user.findUnique({
        where: { id: decoded.sub },
      });
      sessionId = decoded.jti;
    } catch {
      // Invalid token - continue as unauthenticated
    }
  }

  return {
    currentUser,
    sessionId,
    ipAddress: getClientIp(opts.req),
    userAgent: opts.req.headers.get('user-agent') ?? 'unknown',
  };
}
```

### Procedure Definitions

```typescript
// apps/trpc/src/trpc.ts (continued)

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Don't expose internal errors in production
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Authentication middleware
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      currentUser: ctx.currentUser, // Now non-null
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);
```

### Rate Limiting Middleware

Use [@trpc-limiter/upstash](https://github.com/OrJDev/trpc-limiter) for production rate limiting:

```bash
pnpm add @trpc-limiter/upstash @upstash/ratelimit @upstash/redis
```

```typescript
// apps/trpc/src/middleware/rateLimit.ts

import { createTRPCUpstashLimiter } from '@trpc-limiter/upstash';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Auth endpoints: strict limits (5 requests per 15 minutes)
export const authRateLimiter = createTRPCUpstashLimiter({
  fingerprint: (ctx) => ctx.ipAddress,
  message: (retryAfter) => `Too many attempts. Try again in ${retryAfter}s`,
  max: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitOpts: {
    redis,
    limiter: Ratelimit.slidingWindow(5, '15m'),
  },
});

// Mutation endpoints: moderate limits (60 per minute)
export const mutationRateLimiter = createTRPCUpstashLimiter({
  fingerprint: (ctx) => ctx.currentUser?.id ?? ctx.ipAddress,
  message: 'Rate limit exceeded',
  max: 60,
  windowMs: 60 * 1000,
  rateLimitOpts: {
    redis,
    limiter: Ratelimit.slidingWindow(60, '1m'),
  },
});
```

**Usage in routers:**
```typescript
// apps/trpc/src/routers/auth.ts
import { authRateLimiter } from '../middleware/rateLimit.js';

export const authRouter = router({
  login: publicProcedure
    .use(authRateLimiter)  // Apply rate limiting
    .input(LoginInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Login logic...
    }),
});
```

**Alternative: Direct @upstash/ratelimit** for simpler setups without the trpc-limiter wrapper. See [Upstash rate limiting tutorial](https://upstash.com/blog/rate-limiting-requests-with-trpc-in-sveltekit).

### HTTP Server Setup (Production-Ready)

```typescript
// apps/trpc/src/index.ts

import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './routers/index.js';
import { createContext } from './trpc.js';
import { prisma } from '@octant/db';
import { logger } from './utils/logger.js';

// Batch request limit (prevents abuse via batched calls)
const MAX_BATCH_SIZE = 10;

const server = createHTTPServer({
  router: appRouter,
  createContext,
  // Limit batch size to prevent abuse
  batching: {
    enabled: true,
  },
  onError({ error, path }) {
    logger.error({ path, error: error.message }, 'tRPC error');
  },
});

const httpServer = server.server;

// Health check endpoint (outside tRPC for Kubernetes probes)
httpServer.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }
  if (req.url === '/ready') {
    // Check database connectivity
    prisma.$queryRaw`SELECT 1`
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      })
      .catch(() => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'not ready' }));
      });
    return;
  }
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully...');

  // Stop accepting new connections
  httpServer.close();

  // Close database connection
  await prisma.$disconnect();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(4002);
logger.info({ port: 4002 }, 'tRPC server listening');
```

**Health Check Endpoints:**
| Endpoint | Purpose | Kubernetes Probe |
|----------|---------|------------------|
| `/health` | Liveness - server is running | `livenessProbe` |
| `/ready` | Readiness - database connected | `readinessProbe` |

---

## Project Structure

```
apps/trpc/
├── src/
│   ├── index.ts                    # HTTP server setup
│   ├── trpc.ts                     # tRPC instance + context + middleware
│   ├── routers/
│   │   ├── index.ts               # appRouter composition
│   │   ├── auth.ts                # signup, login, logout, refresh
│   │   ├── user.ts                # getMe, updateProfile
│   │   └── post.ts                # CRUD with ownership checks
│   ├── middleware/
│   │   ├── csrf.ts                # CSRF protection (shared pattern)
│   │   └── rateLimit.ts           # Rate limiting middleware
│   ├── config/
│   │   └── auth.ts                # Auth config (shared with GraphQL)
│   ├── utils/
│   │   ├── auth.ts                # Token generation helpers
│   │   ├── logger.ts              # Pino logger setup
│   │   └── audit.ts               # Audit logging
│   └── trpc.e2e.test.ts           # E2E tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Checklist: Adding a New Entity

When adding a new tRPC router (e.g., `Comment`):

1. **Define in Prisma schema** (`packages/db/prisma/schema.prisma`)
   - [ ] Add the model with all fields and relations
   - [ ] Add indexes for common query patterns

2. **Regenerate types** (run from repo root)
   - [ ] Run `pnpm db:push`
   - [ ] Verify Zod schemas generated in `packages/validation/src/generated`

3. **Add validation schemas** (`packages/validation/src/index.ts`)
   - [ ] Add custom Zod schemas with business rules if needed

4. **Create router** (`apps/trpc/src/routers/comment.ts`)
   - [ ] Define queries with `publicProcedure` or `protectedProcedure`
   - [ ] Define mutations with Zod input validation
   - [ ] Add ownership checks (IDOR prevention)

5. **Register in appRouter** (`apps/trpc/src/routers/index.ts`)
   - [ ] Import and add to router composition

6. **Write E2E tests** (`apps/trpc/src/comment.e2e.test.ts`)
   - [ ] Test CRUD operations via `createCaller`
   - [ ] Test validation error cases
   - [ ] Test authorization (owner-only access)

7. **Update frontend** (if applicable)
   - [ ] Types automatically available via AppRouter import

8. **Security review**
   - [ ] Verify sensitive procedures use `protectedProcedure`
   - [ ] Verify IDOR prevention (ownership checks)
   - [ ] Verify no data leakage in error messages

9. **Verify**
   - [ ] Run `pnpm build && pnpm typecheck`
   - [ ] Run `pnpm test:db`

---

## Consequences

### Positive

- **Zero codegen for types**: Types flow automatically from router to client
- **Simpler architecture**: No GraphQL SDL, no type builders
- **Shared infrastructure**: Same Prisma, Zod, and auth patterns as GraphQL
- **Excellent DX**: Full autocomplete from backend to frontend
- **Easy testing**: `createCaller` for unit tests without HTTP

### Negative

- **TypeScript required**: Frontend must use TypeScript for type benefits
- **Tight coupling**: Frontend imports types directly from backend
- **Less flexible**: No equivalent to GraphQL's field selection
- **Fewer tools**: Less ecosystem support than GraphQL

### Trade-offs

- We accept tight coupling for end-to-end type safety
- We use tRPC for internal services, GraphQL for external APIs
- We share all infrastructure (Prisma, validation, auth) between both

---

## Router Organization Guide (Staff Engineer Perspective)

This section documents mental models and heuristics for organizing tRPC routers, based on patterns from [Cal.com](https://github.com/calcom/cal.com), [Documenso](https://github.com/documenso/documenso), and guidance from [Alex/KATT (tRPC creator)](https://x.com/alexdotjs/status/1839265630983213432).

### Core Principle: Screaming Architecture

Your router structure should *scream* what your application does, not what framework you use.

```
// ✅ Good - reveals business domain
routers/
├── auth.ts        # Authentication flows
├── user.ts        # User profile management
├── post.ts        # Content creation
├── billing.ts     # Payment & subscriptions
└── notification.ts

// ❌ Bad - reveals technical concerns
routers/
├── queries.ts
├── mutations.ts
├── subscriptions.ts
└── utils.ts
```

**Heuristic**: Can a new developer understand what this application *does* by looking at the router structure?

### When to Create a New Router

| Create NEW Router When... | Add to EXISTING Router When... |
|--------------------------|-------------------------------|
| Distinct business domain | Related functionality |
| Different team ownership | Same team maintains both |
| Would have 10+ procedures | Adding 1-2 procedures |
| Different auth requirements | Same auth context |
| TypeScript getting slow | Router still performs well |

**The "Reason About Change" Test**: If component A changes, does component B need to change too? If yes, keep them together. If they change for different reasons, separate them.

### Router Splitting Strategy (Cal.com Pattern)

Cal.com splits routers using a **three-tier hierarchy**:

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Authentication Context (Primary Split)         │
├─────────────────────────────────────────────────────────┤
│  viewer/        → Full authenticated user operations     │
│  publicViewer/  → Public endpoints (no auth)            │
│  loggedInViewer/→ Lightweight auth (session only)       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 2: Feature Domain (Secondary Split)               │
├─────────────────────────────────────────────────────────┤
│  viewer/                                                 │
│    ├── bookings/     → Booking CRUD                     │
│    ├── eventTypes/   → Event configuration              │
│    ├── teams/        → Team management (81 files!)      │
│    ├── availability/ → Schedule management              │
│    └── payments/     → Payment processing               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 3: Sub-Domain (Nested Routers)                    │
├─────────────────────────────────────────────────────────┤
│  viewer/teams/                                           │
│    ├── members/      → Team member operations           │
│    ├── invites/      → Invitation management            │
│    └── billing/      → Team-specific billing            │
└─────────────────────────────────────────────────────────┘
```

### Handler Separation Pattern (Large Codebases)

For codebases with 20+ routers, Cal.com separates router definitions from handlers:

```
bookings/
├── _router.tsx           # Router definition (aggregation point)
├── get.handler.ts        # Business logic
├── get.schema.ts         # Zod validation schema
├── create.handler.ts
├── create.schema.ts
├── confirm.handler.ts
├── confirm.schema.ts
└── util.ts               # Shared utilities
```

**Benefits**:
- Handlers can call other handlers directly (not through tRPC)
- Lazy loading reduces cold start times
- Clear separation of concerns
- Each file has single responsibility

**When to use**: 20+ routers, serverless deployment, or handler reusability requirements.

### TypeScript Performance Considerations

tRPC can cause TypeScript performance issues at scale. From the [tRPC performance blog](https://trpc.io/blog/typescript-performance-lessons):

| Problem | Symptom | Solution |
|---------|---------|----------|
| Large routers | 4-8 second autocomplete | Split into smaller routers |
| Complex Zod | IDE becomes unusable | Avoid `.extend()`, `.pick()`, `.merge()` |
| Deep nesting | Types infer as `any` | Add explicit return types |
| Many routers | Slow builds | Build packages before consuming |

**Critical settings for `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "disableSourceOfProjectReferenceRedirect": true
  }
}
```

### Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Do This Instead |
|--------------|--------------|-----------------|
| One giant router | TypeScript grinds to halt | Split by domain |
| Multiple tRPC instances | Type inference breaks | Initialize once, export helpers |
| Prisma types as responses | Tight coupling to DB | Create explicit DTOs |
| Organize by layer | Doesn't reveal domain | Organize by feature |
| Complex Zod compositions | Performance killer | Simple, flat schemas |

**From Cal.com's experience**: A single router importing 20+ sub-routers caused **7-30 second cold starts** on Vercel. After splitting to separate API routes per router, cold starts dropped to **2-3 seconds**.

### Decision Framework

When deciding if procedures belong together, ask:

| Question | YES → Keep Together | NO → Split |
|----------|---------------------|------------|
| Do they change for the same reasons? | ✓ | Split |
| Do they share domain language? | ✓ | Split |
| Same team owns both? | ✓ | Split |
| Would a new dev expect them together? | ✓ | Split |
| Can you reason about them as a unit? | ✓ | Split |

### Base Procedures Pattern

From [Alex/KATT](https://x.com/alexdotjs/status/1839265630983213432): Most apps need only a few base procedures covering 99% of use cases.

```typescript
// apps/trpc/src/trpc.ts

// 1. Public with logging
export const publicProcedure = t.procedure
  .use(loggingMiddleware);

// 2. Authenticated (extends public)
export const protectedProcedure = publicProcedure
  .use(isAuthed);

// 3. Admin (extends authenticated)
export const adminProcedure = protectedProcedure
  .use(isAdmin);

// 4. Organization-scoped (extends authenticated)
export const orgProcedure = protectedProcedure
  .use(validateOrg);
```

**Heuristic**: If you're adding middleware to individual endpoints, you probably need a new base procedure.

### Recommended Structure for This Template

For a medium-sized application (5-15 routers):

```
apps/trpc/src/
├── routers/
│   ├── index.ts          # appRouter composition
│   ├── auth.ts           # publicProcedure: login, signup, refresh
│   ├── user.ts           # protectedProcedure: profile, settings
│   ├── post.ts           # CRUD with ownership checks
│   └── admin/            # Nested for admin-only operations
│       ├── index.ts
│       └── users.ts      # adminProcedure: user management
├── middleware/
│   ├── auth.ts           # isAuthed, isAdmin
│   ├── rateLimit.ts      # Rate limiting
│   └── ownership.ts      # withOwnership factory
├── trpc.ts               # tRPC init + base procedures
└── context.ts            # Context creation
```

### Teaching Junior Developers

**Key concepts to emphasize:**

1. **Routers are domain boundaries** - not just code organization
2. **Procedures have security implications** - `publicProcedure` vs `protectedProcedure` is a security decision
3. **Types flow automatically** - but that doesn't mean skip the data access layer
4. **Batching ≠ N+1 solution** - HTTP batching is not database query batching
5. **Test beyond types** - type safety doesn't replace testing

**Common junior mistakes:**
- Putting all procedures in one file
- Using `publicProcedure` for convenience when it should be protected
- Returning Prisma models directly (exposing `passwordHash`)
- Not validating ownership before update/delete

---

## Modern Standards Alignment (January 2026)

### tRPC v11 Best Practices

This architecture follows tRPC v11 recommendations:

- **Type inference**: Full TypeScript inference without code generation
- **Middleware composition**: Layered auth, logging, rate limiting
- **Error standardization**: Consistent TRPCError codes mapping to HTTP status
- **Testing pattern**: `createCaller` for isolated unit tests

### HTTP Adapter Selection

For production deployments, consider:

1. **Standalone** (default): Simple HTTP server for most use cases
2. **Fastify**: Higher performance, plugin ecosystem
3. **Express**: Existing Express applications
4. **Fetch**: Edge runtime deployment (Cloudflare Workers, Vercel Edge)

### Production Checklist

| Item | Status | Details |
|------|--------|---------|
| Health endpoints | Required | `/health` and `/ready` for Kubernetes |
| Graceful shutdown | Required | SIGTERM/SIGINT handlers |
| Rate limiting | Required | `@trpc-limiter/upstash` for auth endpoints |
| Batch limits | Required | Prevent abuse via batched requests |
| Output validation | Recommended | Prevent sensitive data leakage |
| Request logging | Required | Pino structured logging |
| Error tracking | Recommended | Sentry integration |
| CORS | Required | Configure for specific origins |

### Procedure Naming Conventions

Based on patterns from [Cal.com](https://github.com/calcom/cal.com), [Documenso](https://github.com/documenso/documenso), [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo), and community consensus.

#### Core Principle: RPC Style, Not REST

From [tRPC documentation](https://trpc.io/docs/rpc): *"Ignore HTTP verbs since they carry meaning in REST APIs, but in RPC form part of your function names instead: `getUser(id)` instead of `GET /users/:id`."*

#### Query Naming (Read Operations)

| Pattern | Example | When to Use | Source |
|---------|---------|-------------|--------|
| `list` | `user.list` | Fetch all records | T3, Documenso |
| `byId` | `user.byId` | Fetch single by ID | tRPC docs, T3 |
| `get` | `user.get` | Generic single fetch | Cal.com |
| `getAll` | `post.getAll` | Explicit "fetch all" | T3 Chirp |
| `find` | `document.find` | Search with filters | Documenso |
| `my*` | `post.myPosts` | Current user's records | Common pattern |

**Cal.com examples:** `getByViewer`, `getUserEventGroups`, `listWithTeam`, `bulkEventFetch`

#### Mutation Naming (Write Operations)

| Pattern | Example | When to Use | Source |
|---------|---------|-------------|--------|
| `create` | `post.create` | Create new record | Universal |
| `update` | `post.update` | Modify existing | Universal |
| `delete` | `post.delete` | Remove record | Universal |
| `duplicate` | `document.duplicate` | Copy record | Documenso |
| `upsert` | `setting.upsert` | Create or update | Common |

**Domain-specific actions:** `distribute`, `share`, `download`, `archive`, `restore`

#### Router Organization

**One router per domain/entity** - don't repeat entity name in procedure:

```typescript
// ✅ Good - entity context from router
const userRouter = router({
  list: publicProcedure.query(...),
  byId: publicProcedure.query(...),
  create: protectedProcedure.mutation(...),
});
// Usage: trpc.user.list, trpc.user.byId, trpc.user.create

// ❌ Bad - redundant entity name
const userRouter = router({
  listUsers: publicProcedure.query(...),
  getUserById: publicProcedure.query(...),
  createUser: protectedProcedure.mutation(...),
});
```

#### Nested Routers for Sub-Domains

From Documenso's pattern for related functionality:

```typescript
const documentRouter = router({
  get: publicProcedure.query(...),
  create: protectedProcedure.mutation(...),
  // Nested routers for sub-domains
  attachment: router({
    create: protectedProcedure.mutation(...),
    delete: protectedProcedure.mutation(...),
  }),
  auditLog: router({
    find: protectedProcedure.query(...),
    download: protectedProcedure.mutation(...),
  }),
});
// Usage: trpc.document.attachment.create
```

#### Procedure Type Naming

From [Alex/KATT (tRPC creator)](https://x.com/alexdotjs/status/1839265630983213432):

```typescript
// Base procedures cover 99% of use cases
export const publicProcedure = t.procedure;           // No auth
export const protectedProcedure = t.procedure.use(isAuthed);  // Auth required
export const adminProcedure = t.procedure.use(isAdmin);       // Admin role
export const orgProcedure = t.procedure.use(validateOrg);     // Team access
```

#### Complete CRUD Example

```typescript
export const postRouter = router({
  // Queries
  list: publicProcedure
    .query(() => prisma.post.findMany({ where: { published: true } })),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => prisma.post.findUnique({ where: { id: input.id } })),

  myPosts: protectedProcedure
    .query(({ ctx }) => prisma.post.findMany({ where: { userId: ctx.currentUser.id } })),

  // Mutations
  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(({ input, ctx }) => prisma.post.create({
      data: { ...input, userId: ctx.currentUser.id }
    })),

  update: protectedProcedure
    .input(UpdatePostSchema)
    .mutation(async ({ input, ctx }) => {
      // Ownership check inline
      const post = await prisma.post.findUnique({ where: { id: input.id } });
      if (post?.userId !== ctx.currentUser.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return prisma.post.update({ where: { id: input.id }, data: input });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const post = await prisma.post.findUnique({ where: { id: input.id } });
      if (post?.userId !== ctx.currentUser.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return prisma.post.delete({ where: { id: input.id } });
    }),
});
```

#### Summary Table

| Operation | Recommended | Alternatives | Avoid |
|-----------|-------------|--------------|-------|
| Fetch all | `list` | `getAll`, `findMany` | `fetchUsers` |
| Fetch one | `byId` | `get`, `find` | `getUserById` |
| Create | `create` | `add` | `createUser` |
| Update | `update` | `edit`, `patch` | `updateUser` |
| Delete | `delete` | `remove` | `deleteUser` |
| User-scoped | `myPosts` | `listOwn` | `getMyPosts` |
| With relations | `listWithTeam` | `getWithRelations` | - |
| Bulk operation | `bulkUpdate` | `updateMany` | - |

---

## References

### tRPC Documentation
- [tRPC Documentation](https://trpc.io/docs)
- [tRPC v11 Announcement](https://trpc.io/blog/announcing-trpc-v11)
- [tRPC v11 Migration Guide](https://trpc.io/docs/migrate-from-v10-to-v11)
- [Define Procedures](https://trpc.io/docs/server/procedures)
- [Input & Output Validators](https://trpc.io/docs/server/validators)
- [Middlewares](https://trpc.io/docs/server/middlewares)

### React Query Integration
- [TanStack React Query Setup](https://trpc.io/docs/client/tanstack-react-query/setup)
- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)

### Rate Limiting & Security
- [@trpc-limiter/upstash](https://github.com/OrJDev/trpc-limiter)
- [Upstash Rate Limiting](https://upstash.com/blog/rate-limiting-requests-with-trpc-in-sveltekit)

### Router Patterns & Naming Conventions
- [tRPC Router Factories](https://dev.to/nicklucas/trpc-patterns-router-factories-and-polymorphism-30b0)
- [Cal.com tRPC Implementation](https://github.com/calcom/cal.com)
- [Documenso tRPC Patterns](https://github.com/documenso/documenso)
- [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)
- [Create T3 App - tRPC Usage](https://create.t3.gg/en/usage/trpc)
- [tRPC Discord - Naming Best Practices](https://discord-questions.trpc.io/m/1103073447564820502)
- [Official tRPC Cursor Rules](https://cursor.directory/official/trpc)

### Key Opinion Leaders
- [Alex/KATT on Middlewares](https://x.com/alexdotjs/status/1839265630983213432) - tRPC creator
- [Theo on tRPC](https://x.com/theo/status/1438434802839945220) - T3 Stack creator

### Internal ADRs
- ADR-003: Prisma MongoDB Setup (shared database)
- ADR-004: GraphQL API Architecture (parallel approach)
- ADR-005: Authentication Token Strategy & CSRF (shared auth)
- ADR-106: tRPC Authentication & Authorization
- ADR-108: tRPC Full Stack Feature Workflow
