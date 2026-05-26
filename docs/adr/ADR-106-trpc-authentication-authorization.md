# ADR-106: tRPC Authentication and Authorization

## Status
Implemented

## Context

The tRPC API (`apps/trpc`) requires the same security guarantees as the GraphQL API (ADR-006). Both apps share:

- Same database with User, Session, LoginAttempt models (ADR-003)
- Same token strategy: JWT access tokens + HttpOnly refresh cookies (ADR-005)
- Same CSRF protection: double-submit cookie pattern (ADR-005)

This ADR documents how to implement the authentication and authorization patterns from ADR-006 using tRPC middleware instead of Pothos Scope Auth.

**Prerequisite**: This ADR follows the naming conventions, router organization, and base procedure patterns defined in [ADR-104: tRPC API Architecture](./ADR-104-trpc-api-architecture.md).

### Current State

| Component | Status | Notes |
|-----------|--------|-------|
| JWT verification in context | ✅ Shared | Same as GraphQL (see ADR-005) |
| Token rotation with reuse detection | ✅ Shared | Same logic, different procedures |
| Rate limiting | ✅ Middleware | tRPC middleware pattern |
| Declarative authorization | ✅ Middleware | `protectedProcedure` pattern |
| Default deny policy | ✅ Pattern | Use `protectedProcedure` as default |
| CSRF protection | ✅ Shared | Same double-submit pattern (ADR-005) |
| HttpOnly refresh tokens | ✅ Shared | Same cookie handling (ADR-005) |
| Audit logging | ✅ Shared | Same Pino setup |

---

## Decision

We adopt a **middleware-based authorization architecture** using tRPC's middleware composition pattern, equivalent to Pothos Scope Auth functionality.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HTTP Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │   CORS      │  │   CSRF      │  │   Security Headers          │  │
│  │   Config    │  │   Double    │  │   (HSTS, CSP, X-Frame)      │  │
│  │             │  │   Submit    │  │                             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     tRPC Context Layer                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  JWT Extraction & Verification                              │    │
│  │  - Algorithm allowlist (HS256 only)                         │    │
│  │  - Issuer/Audience validation                               │    │
│  │  - Populate context.currentUser                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   tRPC Middleware Layer                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Base Procedures                                            │    │
│  │  - publicProcedure: No auth required                        │    │
│  │  - protectedProcedure: Requires authenticated user          │    │
│  │  - adminProcedure: Requires admin role                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Composable Middleware                                      │    │
│  │  - withOwnership: Verify resource ownership                 │    │
│  │  - withRateLimit: Apply rate limiting                       │    │
│  │  - withAuditLog: Log security events                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Procedure Layer                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Business Logic                                             │    │
│  │  - Zod input validation (automatic)                         │    │
│  │  - Database operations via Prisma                           │    │
│  │  - Additional ownership checks if needed                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Comparison: Pothos Scope Auth vs tRPC Middleware

| Aspect | GraphQL (Pothos) | tRPC |
|--------|-----------------|------|
| Auth scopes | `authScopes: { authenticated: true }` | `protectedProcedure` middleware |
| Public endpoints | `skipTypeScopes: true` | `publicProcedure` |
| Field-level auth | `authScopes` callback on field | Computed field with ctx check |
| Ownership checks | `isOwner` scope callback | `withOwnership` middleware |
| Admin-only | `admin` scope | `adminProcedure` middleware |

---

## Part 1: Authentication Architecture

### 1.1 JWT Token Strategy

**Same as GraphQL** (ADR-005): Short-lived access tokens (15 min) + rotated refresh tokens (7 days).

| Token | Type | Expiry | Storage (Client) | Storage (Server) |
|-------|------|--------|------------------|------------------|
| Access | JWT | 15 min | Memory only | None (stateless) |
| Refresh | UUID v4 | 7 days | HttpOnly cookie | SHA-256 hash in DB |

### 1.2 Context Creation

**Implementation** (`apps/trpc/src/trpc.ts`):

```typescript
import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateHTTPContextOptions } from '@trpc/server/adapters/standalone';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '@octant/db';
import jwt from 'jsonwebtoken';
import { prisma } from '@octant/db';
import { authConfig } from './config/auth.js';

export interface Context {
  currentUser: User | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  req: IncomingMessage;   // Node.js request (standalone adapter)
  res: ServerResponse;    // Node.js response (for setting cookies)
}

export async function createContext(opts: CreateHTTPContextOptions): Promise<Context> {
  const authHeader = opts.req.headers.authorization;
  let currentUser: User | null = null;
  let sessionId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, authConfig.jwtSecret, {
        algorithms: [authConfig.jwtAlgorithm],  // Algorithm allowlist
        issuer: authConfig.jwtIssuer,
        audience: authConfig.jwtAudience,
      }) as { sub: string; jti: string };

      currentUser = await prisma.user.findUnique({
        where: { id: decoded.sub },
      });
      sessionId = decoded.jti;
    } catch (error) {
      // Log but don't throw - allows public procedures
      console.debug('JWT verification failed:', error);
    }
  }

  return {
    currentUser,
    sessionId,
    ipAddress: getClientIp(opts.req),
    userAgent: opts.req.headers['user-agent'] ?? 'unknown',
    requestId: crypto.randomUUID(),
    req: opts.req,
    res: opts.res,
  };
}
```

### 1.3 Refresh Token Handling

**Implementation** (`apps/trpc/src/routers/auth.ts`):

```typescript
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '@octant/db';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { generateAccessToken, hashToken } from '../utils/auth.js';
import { audit, AuditEvent } from '../utils/audit.js';

export const authRouter = router({
  // Following ADR-104 naming: short names, entity context from router
  // Usage: trpc.auth.refresh.mutate()
  refresh: publicProcedure
    .mutation(async ({ ctx }) => {
      // Extract refresh token from HttpOnly cookie
      const cookies = parseCookies(ctx.request.headers.get('cookie') ?? '');
      const refreshToken = cookies['__Host-refresh_token'];

      if (!refreshToken) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'No refresh token provided',
        });
      }

      const tokenHash = hashToken(refreshToken);

      // Find session by token hash
      const session = await prisma.session.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!session || session.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired refresh token',
        });
      }

      // Check for token reuse (security)
      if (session.previousTokenHash === tokenHash) {
        // Token reuse detected - revoke entire family
        await prisma.session.deleteMany({
          where: { tokenFamily: session.tokenFamily },
        });

        audit(AuditEvent.TOKEN_REUSE_DETECTED, {
          userId: session.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Session compromised. All sessions revoked.',
        });
      }

      // Rotate token
      const newRefreshToken = crypto.randomUUID();
      const newTokenHash = hashToken(newRefreshToken);

      await prisma.session.update({
        where: { id: session.id },
        data: {
          tokenHash: newTokenHash,
          previousTokenHash: tokenHash,
          lastUsedAt: new Date(),
        },
      });

      // Generate new access token
      const accessToken = generateAccessToken(session.user, session.id);

      audit(AuditEvent.TOKEN_REFRESH, {
        userId: session.userId,
        sessionId: session.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      // Return new tokens
      // Note: Actual cookie setting happens in HTTP layer
      return {
        accessToken,
        user: session.user,
        // refreshToken set via Set-Cookie header
      };
    }),
});
```

---

## Part 2: Authorization Architecture

### 2.1 Base Procedure Types

Following [ADR-104's base procedures pattern](./ADR-104-trpc-api-architecture.md#base-procedures-pattern), most apps need only a few base procedures covering 99% of use cases.

**Implementation** (`apps/trpc/src/trpc.ts`):

```typescript
const t = initTRPC.context<Context>().create();

export const router = t.router;
export const middleware = t.middleware;

// Logging middleware (applied to all procedures)
const withLogging = t.middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  logger.info({ path, type, duration, userId: ctx.currentUser?.id }, 'tRPC request');
  return result;
});

// 1. Public procedure - no auth, with logging
export const publicProcedure = t.procedure.use(withLogging);

// Authentication middleware
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      currentUser: ctx.currentUser,  // Now guaranteed non-null
      sessionId: ctx.sessionId!,
    },
  });
});

// 2. Protected procedure - extends public, adds auth
export const protectedProcedure = publicProcedure.use(isAuthed);

// Admin middleware
const isAdmin = t.middleware(async ({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.currentUser.role !== 'ADMIN') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({
    ctx: {
      ...ctx,
      currentUser: ctx.currentUser,
    },
  });
});

// 3. Admin procedure - extends protected, adds role check
export const adminProcedure = protectedProcedure.use(isAdmin);

// 4. Organization procedure (if needed) - extends protected, adds org context
// export const orgProcedure = protectedProcedure.use(validateOrg);
```

**Key pattern**: Each procedure extends the previous one, building a chain of middleware. This ensures logging is always applied, and auth checks compound properly.

### 2.2 Ownership Checks

**Current implementation**: Inline ownership checks are used in procedures rather than a separate middleware factory. This is simpler for most cases.

**Pattern** (recommended for complex cases):

```typescript
// apps/trpc/src/middleware/ownership.ts (if needed)

import { TRPCError } from '@trpc/server';
import { middleware } from '../trpc.js';

/**
 * Create middleware that verifies the current user owns the requested resource.
 * The resource must have a `userId` field.
 */
export function withOwnership<T extends { userId: string }>(
  getResource: (id: string) => Promise<T | null>
) {
  return middleware(async ({ ctx, rawInput, next }) => {
    if (!ctx.currentUser) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const input = rawInput as { id: string };
    const resource = await getResource(input.id);

    if (!resource || resource.userId !== ctx.currentUser.id) {
      // Generic error prevents resource enumeration (IDOR prevention)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
    }

    return next({
      ctx: {
        ...ctx,
        resource,  // Resource available in procedure
      },
    });
  });
}
```

**Note**: This middleware factory is a **recommended pattern** for future use when you have multiple procedures that need the same ownership check. Currently, the session router uses inline checks (see Section 2.4).

### 2.3 Default Deny Pattern

Unlike GraphQL's root type scopes, tRPC uses convention:

```typescript
// ✅ Protected by default - use protectedProcedure
create: protectedProcedure
  .input(CreatePostInputSchema)
  .mutation(async ({ input, ctx }) => {
    // ctx.currentUser guaranteed non-null
  }),

// ⚠️ Explicit public - only when necessary
login: publicProcedure
  .input(LoginInputSchema)
  .mutation(async ({ input, ctx }) => {
    // ctx.currentUser may be null
  }),
```

**Convention**: Always use `protectedProcedure` unless the endpoint must be public. Document public endpoints with comments.

### 2.4 Inline Ownership Checks

For simple cases, inline the check instead of using middleware:

```typescript
update: protectedProcedure
  .input(z.object({
    id: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    const post = await prisma.post.findUnique({
      where: { id: input.id },
    });

    // IDOR prevention
    if (!post || post.userId !== ctx.currentUser.id) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Post not found',  // Generic message
      });
    }

    return prisma.post.update({
      where: { id: input.id },
      data: input,
    });
  }),
```

---

## Part 3: CSRF Protection

### 3.1 Double-Submit Cookie Pattern

**Same implementation as GraphQL** (ADR-005). CSRF validation happens at the **HTTP layer**, BEFORE the tRPC handler processes the request.

**Implementation** (`apps/trpc/src/middleware/csrf.ts`):

```typescript
import { timingSafeEqual, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CSRF_COOKIE_NAME = process.env['ENV'] === 'prod' || process.env['ENV'] === 'staging'
  ? '__Host-csrf'
  : 'csrf';

export function validateCsrf(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || typeof headerToken !== 'string') {
    return false;
  }

  // Length check + timing-safe comparison
  if (cookieToken.length !== headerToken.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}
```

### 3.2 HTTP Layer Integration

**Key point**: CSRF validation happens in the HTTP request handler, BEFORE `createContext` is called. This ensures mutations are rejected early.

**Implementation** (`apps/trpc/src/index.ts`):

```typescript
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { createServer } from 'node:http';
import { appRouter } from './routers/index.js';
import { createContext } from './trpc.js';
import { validateCsrf, setCsrfCookie } from './middleware/csrf.js';

const handler = createHTTPHandler({ router: appRouter, createContext });

const server = createServer((req, res) => {
  // Set CSRF cookie on every response (for client to read)
  setCsrfCookie(res, generateCsrfToken());

  // CSRF validation for mutations (POST requests)
  if (req.method === 'POST') {
    // Allow CSRF bypass in development via env var
    const csrfDisabled = process.env['CSRF_DISABLED'] === 'true';

    if (!csrfDisabled && !validateCsrf(req)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: { message: 'CSRF validation failed', code: 'FORBIDDEN' }
      }));
      return;
    }
  }

  // Pass to tRPC handler (createContext called here)
  handler(req, res);
});
```

**Why HTTP layer, not createContext?**
- CSRF is a transport-level concern, not application logic
- Rejecting early prevents wasted database queries
- Cleaner separation of concerns

---

## Part 3b: Rate Limiting

### 3b.1 Library Selection

Use [@trpc-limiter/memory](https://github.com/OrJDev/trpc-limiter) for in-memory rate limiting:

```bash
pnpm add @trpc-limiter/memory
```

**Why @trpc-limiter/memory?**
- Native tRPC procedure-level middleware
- Zero external dependencies (no Redis required)
- Simple sliding window algorithm
- Works for single-instance deployments

**Migration path to Redis** (for multi-instance production):
```bash
# When scaling to multiple instances
pnpm add @trpc-limiter/redis redis
# Add Redis to docker-compose.yml
# Swap createTRPCStoreLimiter → createTRPCRedisLimiter
```

### 3b.2 Rate Limiter Middleware

**Implementation** (`apps/trpc/src/middleware/rateLimiter.ts`):

```typescript
import { createTRPCStoreLimiter } from '@trpc-limiter/memory';
import { rateLimitConfig } from '../config/auth.js';

// Note: The library requires internal tRPC types.
// We define a minimal interface for the context we need.
interface RateLimitContext {
  ipAddress: string;
}

/**
 * Login rate limiter - by IP address.
 * Limits failed login attempts to prevent brute force attacks.
 */
export const loginRateLimiter = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `login:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many login attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.login.maxAttempts * rateLimitConfig.ipMultiplier,
  windowMs: rateLimitConfig.login.windowMs,
});

/**
 * Signup rate limiter - by IP address.
 */
export const signupRateLimiter = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `signup:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many signup attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.signup.maxAttempts,
  windowMs: rateLimitConfig.signup.windowMs,
});

/**
 * Refresh rate limiter - by IP address.
 */
export const refreshRateLimiter = createTRPCStoreLimiter({
  fingerprint: (ctx: RateLimitContext) => `refresh:${ctx.ipAddress}`,
  message: (retryAfterMs: number) =>
    `Too many refresh attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
  max: rateLimitConfig.refreshToken.maxAttempts,
  windowMs: rateLimitConfig.refreshToken.windowMs,
});
```

### 3b.3 Applying Rate Limits

Rate limiters are applied as **procedure-level middleware** using `.use()`:

```typescript
// apps/trpc/src/routers/auth.ts
import {
  loginRateLimiter,
  signupRateLimiter,
  refreshRateLimiter,
} from '../middleware/rateLimiter.js';

export const authRouter = router({
  // Rate limiting via middleware
  login: publicProcedure
    .use(loginRateLimiter)
    .input(LoginInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Login logic...
    }),

  signup: publicProcedure
    .use(signupRateLimiter)
    .input(SignupInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Signup logic...
    }),

  refresh: publicProcedure
    .use(refreshRateLimiter)
    .input(z.object({}))
    .mutation(async ({ ctx }) => {
      // Token refresh logic...
    }),
});
```

### 3b.4 Rate Limit Configuration

Configuration is environment-aware (`apps/trpc/src/config/auth.ts`):

```typescript
const isProduction = ENV === 'prod';
const isStaging = ENV === 'staging';

export const rateLimitConfig = {
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: isProduction ? 5 : isStaging ? 20 : 1000,
  },
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: isProduction ? 3 : isStaging ? 10 : 1000,
  },
  refreshToken: {
    windowMs: 60 * 1000, // 1 minute
    maxAttempts: isProduction ? 30 : isStaging ? 100 : 10000,
  },
  ipMultiplier: isProduction ? 2 : isStaging ? 5 : 100,
};
```

### 3b.5 Audit Logging (Separate Concern)

Rate limiting and audit logging are separate concerns. The `LoginAttempt` table is still used for:
- Audit trail of all login attempts
- Account lockout detection (separate from rate limiting)

```typescript
// In login procedure (after rate limiter middleware)
await prisma.loginAttempt.create({
  data: {
    email: input.email.toLowerCase(),
    ipAddress: ctx.ipAddress,
    success: isValidPassword,
  },
});
```

### 3b.6 Rate Limit Tiers

| Endpoint Type | Limit (Prod) | Window | Fingerprint |
|--------------|--------------|--------|-------------|
| Login | 5 × ipMultiplier | 15 min | IP address |
| Signup | 3 | 1 hour | IP address |
| Refresh | 30 | 1 min | IP address |

### 3b.7 Memory Store Limitations

The in-memory store has these limitations:
- ⚠️ Rate limits reset when server restarts
- ⚠️ Does NOT work across multiple server instances
- ⚠️ No persistence (Redis version persists)

**When to migrate to Redis:**
- Running multiple server instances (horizontal scaling)
- Need rate limits to survive restarts
- Production deployments with load balancers

---

## Part 4: Error Message Standardization

### 4.1 Prevent Account Enumeration

**Same pattern as GraphQL** - all auth failures return identical errors.

Following [ADR-104 naming conventions](./ADR-104-trpc-api-architecture.md#procedure-naming-conventions):
- Router: `auth` (domain)
- Procedures: `login`, `signup`, `logout`, `refresh` (short action verbs)

```typescript
// apps/trpc/src/routers/auth.ts

const AUTH_ERROR = new TRPCError({
  code: 'UNAUTHORIZED',
  message: 'Invalid email or password',
});

// Dummy hash for timing attack mitigation
const DUMMY_HASH = '$2b$12$dummy.hash.for.timing.attack.mitigation';

export const authRouter = router({
  // Usage: trpc.auth.login.mutate({ email, password })
  login: publicProcedure
    .use(authRateLimiter)  // Rate limiting from Part 3b
    .input(LoginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { email, password } = input;

      // Rate limit check
      const rateLimited = await checkLoginRateLimit(email, ctx.ipAddress);
      if (rateLimited) {
        audit(AuditEvent.RATE_LIMIT_EXCEEDED, { email, ipAddress: ctx.ipAddress });
        throw AUTH_ERROR;  // Generic error
      }

      // Lockout check
      const lockedOut = await checkAccountLockout(email);
      if (lockedOut) {
        audit(AuditEvent.ACCOUNT_LOCKOUT, { email, ipAddress: ctx.ipAddress });
        throw AUTH_ERROR;  // Generic error
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        // Timing attack mitigation - still hash compare
        await bcrypt.compare(password, DUMMY_HASH);
        await recordLoginAttempt(email, ctx.ipAddress, false);
        throw AUTH_ERROR;  // Generic error
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await recordLoginAttempt(email, ctx.ipAddress, false);
        throw AUTH_ERROR;  // Generic error
      }

      // Success
      await recordLoginAttempt(email, ctx.ipAddress, true);
      const { accessToken, refreshToken } = await createSession(user, ctx);

      audit(AuditEvent.LOGIN_SUCCESS, {
        userId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { accessToken, user };
    }),
});
```

### 4.2 TRPCError Codes Reference

| Code | HTTP Status | Usage |
|------|-------------|-------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `NOT_FOUND` | 404 | Resource not found (or hidden for security) |
| `BAD_REQUEST` | 400 | Invalid input |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |

---

## Part 5: Session Management

Following [ADR-104 naming conventions](./ADR-104-trpc-api-architecture.md#procedure-naming-conventions): use short names, `my*` prefix for user-scoped queries.

### 5.1 Output Schema (Preventing Data Leakage)

Per ADR-104's output validation pattern, define explicit output schemas:

```typescript
// apps/trpc/src/routers/session.schema.ts

import { z } from 'zod';

// Output schema - explicitly excludes tokenHash, previousTokenHash
export const SessionOutputSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  isCurrent: z.boolean(),
});

export type SessionOutput = z.infer<typeof SessionOutputSchema>;
```

### 5.2 Session Listing

```typescript
// apps/trpc/src/routers/session.ts

import { SessionOutputSchema } from './session.schema.js';

export const sessionRouter = router({
  // ADR-104 naming: my* for user-scoped queries
  // Usage: trpc.session.mySessions.useQuery()
  mySessions: protectedProcedure
    .output(z.array(SessionOutputSchema))  // Explicit output validation
    .query(async ({ ctx }) => {
      const sessions = await prisma.session.findMany({
        where: {
          userId: ctx.currentUser.id,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          ipAddress: true,
          userAgent: true,
          // tokenHash, previousTokenHash explicitly NOT selected
        },
      });

      return sessions.map(session => ({
        ...session,
        isCurrent: session.id === ctx.sessionId,
      }));
    }),
});
```

### 5.3 Session Revocation

```typescript
  // ADR-104 naming: action verb without entity repetition
  // Usage: trpc.session.revoke.mutate({ id: 'session_123' })
  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))  // 'id' not 'sessionId' - entity context from router
    .mutation(async ({ input, ctx }) => {
      const session = await prisma.session.findUnique({
        where: { id: input.id },
      });

      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // IDOR prevention - use NOT_FOUND to prevent enumeration
      if (session.userId !== ctx.currentUser.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // Prevent revoking current session
      if (session.id === ctx.sessionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot revoke current session. Use logout instead.',
        });
      }

      await prisma.session.delete({ where: { id: input.id } });

      audit(AuditEvent.SESSION_REVOKED, {
        userId: ctx.currentUser.id,
        sessionId: input.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { success: true };
    }),

  // Revoke all sessions except current
  // Usage: trpc.session.revokeAll.mutate()
  revokeAll: protectedProcedure
    .mutation(async ({ ctx }) => {
      const result = await prisma.session.deleteMany({
        where: {
          userId: ctx.currentUser.id,
          id: { not: ctx.sessionId },  // Keep current session
        },
      });

      audit(AuditEvent.LOGOUT_ALL, {
        userId: ctx.currentUser.id,
        sessionId: ctx.sessionId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        sessionsRevoked: result.count,
      });

      return { count: result.count };
    }),
```

---

## Part 6: Audit Logging

### 6.1 Shared Logging Infrastructure

**Same Pino setup as GraphQL** (see ADR-006):

```typescript
// apps/trpc/src/utils/logger.ts

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

const REDACT_PATHS = [
  'password', 'passwordHash', 'accessToken', 'refreshToken',
  'token', 'tokenHash', 'authorization', 'cookie',
];

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (isDevelopment ? 'debug' : 'info'),
  base: { service: 'trpc-api', env: process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

### 6.2 Audit Events

```typescript
// apps/trpc/src/utils/audit.ts

import { logger } from './logger.js';

export enum AuditEvent {
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILED = 'auth.login.failed',
  SIGNUP_SUCCESS = 'auth.signup.success',
  LOGOUT = 'auth.logout',
  LOGOUT_ALL = 'auth.logout.all',
  TOKEN_REFRESH = 'auth.token.refresh',
  TOKEN_REUSE_DETECTED = 'auth.token.reuse',
  SESSION_REVOKED = 'session.revoked',
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  ACCOUNT_LOCKOUT = 'security.lockout',
  CSRF_FAILED = 'security.csrf.failed',
}

const auditLogger = logger.child({ component: 'audit' });

interface AuditContext {
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  email?: string;
}

export function audit(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>
): void {
  auditLogger.info({ event, ...context, ...data }, event);
}

export function auditWarn(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>
): void {
  auditLogger.warn({ event, ...context, ...data }, event);
}

export function auditAlert(
  event: AuditEvent,
  context: AuditContext,
  data?: Record<string, unknown>
): void {
  auditLogger.error({ event, ...context, ...data }, event);
}
```

---

## Complete Router Structure (ADR-104 Aligned)

Following [ADR-104's router organization guide](./ADR-104-trpc-api-architecture.md#router-organization-guide-staff-engineer-perspective):

```typescript
// apps/trpc/src/routers/index.ts

export const appRouter = router({
  auth: authRouter,       // Public auth procedures
  session: sessionRouter, // Session management (protected)
  user: userRouter,       // User profile (protected)
  // ... other domain routers
});
```

### Auth Router (`apps/trpc/src/routers/auth.ts`)

| Procedure | Type | Description |
|-----------|------|-------------|
| `login` | `publicProcedure` | Authenticate with email/password |
| `signup` | `publicProcedure` | Create new account |
| `logout` | `protectedProcedure` | End current session |
| `refresh` | `publicProcedure` | Rotate refresh token |

### Session Router (`apps/trpc/src/routers/session.ts`)

| Procedure | Type | Description |
|-----------|------|-------------|
| `mySessions` | `protectedProcedure` | List user's active sessions |
| `revoke` | `protectedProcedure` | Revoke single session |
| `revokeAll` | `protectedProcedure` | Revoke all except current |

### User Router (`apps/trpc/src/routers/user.ts`)

| Procedure | Type | Description |
|-----------|------|-------------|
| `me` | `protectedProcedure` | Get current user profile |
| `update` | `protectedProcedure` | Update profile |
| `changePassword` | `protectedProcedure` | Change password |

---

## Implementation Checklist

### Phase 1: Core Authorization ✅

- [ ] Configure tRPC with context creation
- [ ] Create `publicProcedure` and `protectedProcedure`
- [ ] Create `adminProcedure` if roles are used
- [ ] Document public endpoints with comments

### Phase 2: CSRF & Token Security ✅

- [ ] Implement CSRF validation in server
- [ ] Handle refresh tokens via HttpOnly cookies
- [ ] Implement token rotation with reuse detection

### Phase 3: Error Standardization ✅

- [ ] Use generic AUTH_ERROR for all auth failures
- [ ] Implement timing attack mitigation
- [ ] Use NOT_FOUND for ownership failures (IDOR)

### Phase 4: Session Management ✅

- [ ] Add `mySessions` query with `isCurrent` flag
- [ ] Add `revokeSession` mutation with ownership check
- [ ] Prevent revoking current session

### Phase 5: Audit Logging ✅

- [ ] Configure Pino logger with redaction
- [ ] Add audit events to all auth procedures
- [ ] Configure log aggregation (deployment-specific)

---

## Testing Strategy

All tests verify **actual database state**, not just API responses. This eliminates false negatives where tests pass but functionality is broken.

### Test Files

| File | Purpose | Tests |
|------|---------|-------|
| `trpc.e2e.test.ts` | Core functionality E2E tests | 30 |
| `security.pentest.e2e.test.ts` | Security penetration tests | 22 |
| `token-abuse.pentest.e2e.test.ts` | Token abuse scenarios | 12 |

### E2E Tests (`trpc.e2e.test.ts`)

**Auth Router Tests:**
- `signs up a new user` - Verifies user created in DB, session created, tokens returned
- `rejects duplicate email signup` - Verifies error AND no duplicate user in DB
- `rejects short passwords` - Verifies error AND no user created in DB
- `rejects common passwords` - Verifies error AND no user created in DB
- `logs in an existing user` - Verifies session created in DB with correct userId
- `rejects invalid password` - Verifies error AND no session created in DB
- `refreshes access token` - Verifies previousTokenHash set in DB (rotation tracking)
- `logs out and clears refresh token` - Verifies session deleted from DB

**User Router Tests:**
- `updates user profile` - Verifies DB was actually updated (not just response)
- `throws UNAUTHORIZED for unauthenticated user` - Verifies error AND data unchanged in DB
- `rejects incorrect current password` - Verifies error AND passwordHash unchanged in DB
- `changes password with correct current password` - Verifies passwordHash changed, old password fails

**Session Router Tests:**
- `revokes another session` - Verifies session deleted from DB
- `cannot revoke another user session (IDOR prevention)` - Verifies victim's session still exists in DB
- `revokeAll` - Verifies correct session count in DB (only user's other sessions deleted)

**Rate Limiting Tests:**
- `records login attempts` - Verifies LoginAttempt records created in DB
- `BLOCKS login after exceeding lockout threshold` - Pre-populates attempts, verifies TOO_MANY_REQUESTS

**Validation Tests:**
- `rejects invalid email format` - Verifies error AND no user created in DB
- `rejects empty name` - Verifies error AND no user created in DB

### Security Penetration Tests (`security.pentest.e2e.test.ts`)

**RBAC Tests:**
- `BLOCKS unauthenticated access to user.me` - Verifies UNAUTHORIZED
- `BLOCKS unauthenticated access to user.changePassword` - Verifies error AND passwordHash unchanged
- `BLOCKS user from revoking another users session` - Verifies NOT_FOUND AND victim's session still exists

**JWT Attack Tests:**
- `BLOCKS request with invalid/malformed JWT token`
- `BLOCKS request with JWT signed with wrong secret`
- `BLOCKS request with expired JWT token`
- `BLOCKS JWT with none algorithm`
- `BLOCKS JWT with wrong issuer claim`
- `BLOCKS JWT with wrong audience claim`
- `BLOCKS user.changePassword with wrong secret JWT` - Verifies error AND passwordHash unchanged
- `BLOCKS session.revokeAll with non-existent user JWT` - Verifies error AND no sessions deleted

**Authorization Tests:**
- `ALLOWS user to list their own sessions` - Verifies correct sessions returned AND other user's sessions excluded

**CSRF Tests:**
- `blocks POST requests without CSRF token`
- `allows POST with valid CSRF token (double-submit)`

### Token Abuse Tests (`token-abuse.pentest.e2e.test.ts`)

**Refresh Token Abuse:**
- `BLOCKS refresh token reuse after rotation` - Verifies previousTokenHash tracking in DB
- `BLOCKS expired refresh token`

**Brute Force Protection:**
- `records failed login attempts for audit trail` - Verifies LoginAttempt records with success=false
- `validates lockout configuration exists` - Config validation
- `BLOCKS login after exceeding lockout threshold (pre-populated)` - Verifies TOO_MANY_REQUESTS with correct password

**CSRF Protection:**
- `GUARD: CSRF_DISABLED must not be set for security tests`

### Running Tests

```bash
# Run all E2E tests with database
pnpm test:db

# Run specific test file
pnpm --filter trpc vitest run src/trpc.e2e.test.ts

# Run tests in watch mode
pnpm --filter trpc vitest src/trpc.e2e.test.ts
```

---

## Consequences

### Positive

- **Middleware composition**: Easy to combine auth, rate limiting, logging
- **Type-safe context**: `protectedProcedure` narrows `currentUser` type
- **Reusable patterns**: `withOwnership` middleware factory
- **Shared security**: Same patterns as GraphQL

### Negative

- **Convention-based**: No compile-time enforcement of default deny
- **Manual checks**: Some ownership checks still inline
- **Less declarative**: More procedural than Pothos scopes

### Trade-offs

- We accept convention-based security for simpler implementation
- We document security patterns clearly in this ADR
- We share audit logging and token handling with GraphQL

---

## References

### Standards
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [RFC 8725 JWT Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725)

### tRPC Resources
- [tRPC Middlewares](https://trpc.io/docs/server/middlewares)
- [tRPC Error Handling](https://trpc.io/docs/server/error-handling)
- [@trpc-limiter](https://github.com/OrJDev/trpc-limiter) - Memory, Redis, and Upstash backends

### Internal References
- [ADR-005: Authentication Token Strategy & CSRF](./ADR-005-graphql-authentication-token-strategy-csrf.md) - Shared token strategy
- [ADR-006: GraphQL Authentication & Authorization](./ADR-006-graphql-authentication-authorization.md) - Parallel patterns
- [ADR-104: tRPC API Architecture](./ADR-104-trpc-api-architecture.md) - **Naming conventions, router organization**
- [ADR-108: tRPC Full Stack Feature Workflow](./ADR-108-trpc-full-stack-feature-workflow.md) - Implementation workflow
