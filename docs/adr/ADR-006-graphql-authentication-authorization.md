# ADR-006: GraphQL Authentication and Authorization

## Status
Implemented

## Context

The authentication system (PRD-AUTH) requires secure GraphQL API protection. ADR-004 established GraphQL Yoga + Pothos as our API layer, but did not address authentication and authorization patterns. A security audit (ADR-006) and gap analysis identified 21 specific issues that must be addressed.

### Current State

| Component | Status | Notes |
|-----------|--------|-------|
| JWT verification in context | ✅ Implemented | Algorithm allowlist, issuer/audience validation |
| Token rotation with reuse detection | ✅ Implemented | Family tracking, grace period |
| Rate limiting (login, refresh) | ✅ Implemented | IP-based with config |
| GraphQL Armor | ✅ Implemented | Depth, complexity, alias limits |
| Declarative authorization | ✅ Implemented | Pothos Scope Auth with `skipTypeScopes` for public endpoints |
| Field-level authorization | ✅ Implemented | User.email and User.sessions owner-only |
| Default deny policy | ✅ Implemented | Root Query/Mutation require auth by default |
| CSRF protection | ✅ Implemented | Double-submit cookie pattern (see ADR-005) |
| HttpOnly refresh tokens | ✅ Implemented | Tokens in HttpOnly cookies (see ADR-005) |
| Audit logging | ✅ Implemented | Pino structured logging with security events |

### Security Audit Findings

From ADR-006 and gap analysis, critical auth issues have been addressed:

| Gap | Severity | Status |
|-----|----------|--------|
| No declarative authorization layer | High | ✅ Fixed - Pothos Scope Auth plugin |
| No default deny policy | High | ✅ Fixed - Root types require auth |
| Error messages leak account existence | High | ✅ Fixed - Generic AUTH_ERROR_MESSAGE |
| Missing CSRF protection | Critical | ✅ Fixed - see ADR-005 |
| Refresh tokens in response body | Medium | ✅ Fixed - HttpOnly cookies |
| No field-level authorization | Medium | ✅ Fixed - Owner-only email/sessions |

---

## Decision

We adopt a **layered authentication and authorization architecture** using Pothos Scope Auth plugin with defense-in-depth principles.

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
│                     GraphQL Context Layer                            │
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
│                   Pothos Scope Auth Layer                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Auth Scopes (evaluated per-request)                        │    │
│  │  - public: true                                             │    │
│  │  - authenticated: !!context.currentUser                     │    │
│  │  - isOwner: (resource) => resource.userId === user.id       │    │
│  │  - admin: context.currentUser?.role === 'ADMIN'             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Default Strategy: authRequired                             │    │
│  │  - All fields require authentication unless marked public   │    │
│  │  - New fields are protected by default                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Resolver Layer                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Business Logic Authorization                               │    │
│  │  - Ownership checks (IDOR prevention)                       │    │
│  │  - Resource-specific rules                                  │    │
│  │  - Rate limiting per operation                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Authentication Architecture

### 1.1 JWT Token Strategy

**Decision**: Short-lived access tokens (15 min) + rotated refresh tokens (7 days).

| Token | Type | Expiry | Storage (Client) | Storage (Server) |
|-------|------|--------|------------------|------------------|
| Access | JWT | 15 min | Memory only | None (stateless) |
| Refresh | UUID v4 | 7 days | HttpOnly cookie | SHA-256 hash in DB |

**JWT Claims** (RFC 8725 compliant):
```typescript
interface AccessTokenPayload {
  sub: string;      // User ID
  iss: string;      // Issuer (e.g., "octant-api")
  aud: string;      // Audience (e.g., "octant-app")
  iat: number;      // Issued at
  exp: number;      // Expiration
  jti: string;      // Unique token ID
}
```

**Implementation** (`apps/graphql/src/index.ts`):
```typescript
const yoga = createYoga({
  schema,
  context: async ({ request }): Promise<Context> => {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    let currentUser: User | null = null;
    let sessionId: string | null = null;

    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET, {
          algorithms: ['HS256'],  // Algorithm allowlist
          issuer: 'octant-api',
          audience: 'octant-app',
        }) as AccessTokenPayload;

        currentUser = await prisma.user.findUnique({
          where: { id: payload.sub },
        });
        sessionId = payload.jti;
      } catch (error) {
        // Log but don't throw - allows public queries
        console.debug('JWT verification failed:', error.message);
      }
    }

    return {
      currentUser,
      sessionId,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'unknown',
    };
  },
});
```

### 1.2 Refresh Token Handling

**Decision**: HttpOnly cookies for refresh tokens to prevent XSS attacks.

**Current State** (Gap 14):
```typescript
// BAD: Refresh token in response body
return { accessToken, refreshToken, user };
```

**Required Implementation**:
```typescript
// GOOD: Refresh token in HttpOnly cookie
const response = new Response(JSON.stringify({ accessToken, user }), {
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': [
      `__Host-refresh_token=${refreshToken}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      `Max-Age=${7 * 24 * 60 * 60}`,
    ].join('; '),
  },
});
```

**Cookie Security Requirements**:
- `__Host-` prefix: Requires Secure and Path=/
- `HttpOnly`: Prevents JavaScript access
- `Secure`: HTTPS only
- `SameSite=Strict`: Prevents CSRF

### 1.3 Token Reuse Detection

**Decision**: Token family tracking with immediate revocation on reuse.

Already implemented in `apps/graphql/src/schema/mutations/auth.ts`:
```typescript
// Check if token was already rotated (reuse detection)
if (session.previousTokenHash === tokenHash) {
  // Token reuse detected - revoke entire family
  await prisma.session.deleteMany({
    where: { tokenFamily: session.tokenFamily },
  });

  logAuditEvent({
    type: AuditEventType.TOKEN_REUSE_DETECTED,
    userId: session.userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  throw new GraphQLError('Session compromised. All sessions revoked.');
}
```

---

## Part 2: Authorization Architecture

### 2.1 Pothos Scope Auth Plugin

**Decision**: Use `@pothos/plugin-scope-auth` for declarative authorization.

**Installation**:
```bash
pnpm --filter graphql add @pothos/plugin-scope-auth
```

**Builder Configuration** (`apps/graphql/src/builder.ts`):
```typescript
import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type PrismaTypes from '@pothos/plugin-prisma/generated';
import { prisma } from '@octant/db';

export interface Context {
  currentUser: User | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
}

export interface PothosTypes {
  PrismaTypes: PrismaTypes;
  Context: Context;
  AuthScopes: {
    public: boolean;
    authenticated: boolean;
    isOwner: boolean;
    admin: boolean;
  };
  Scalars: {
    Date: { Input: Date; Output: Date };
  };
}

export const builder = new SchemaBuilder<PothosTypes>({
  plugins: [PrismaPlugin, ScopeAuthPlugin],
  prisma: {
    client: prisma,
  },
  scopeAuth: {
    // Default: require authentication for all fields
    defaultStrategy: 'all',

    // Auth scopes evaluated per-request
    authScopes: async (context) => ({
      public: true,
      authenticated: !!context.currentUser,
      isOwner: false, // Evaluated per-field with skipTypeScopes
      admin: context.currentUser?.role === 'ADMIN',
    }),

    // Error handling
    unauthorizedError: () => new GraphQLError('Not authorized', {
      extensions: { code: 'FORBIDDEN' },
    }),
  },
});
```

### 2.2 Default Deny Policy

**Decision**: All fields require authentication unless explicitly marked public.

**Schema-Level Application**:
```typescript
// Root query type with default auth requirement
builder.queryType({
  authScopes: { authenticated: true },  // Default for all queries
});

builder.mutationType({
  authScopes: { authenticated: true },  // Default for all mutations
});
```

**Public Endpoints** (explicit opt-out):
```typescript
// Public query - explicitly marked
builder.queryField('me', (t) =>
  t.field({
    type: 'User',
    nullable: true,
    authScopes: { public: true },  // Override default
    resolve: (_parent, _args, context) => context.currentUser,
  })
);

// Public mutations for auth
builder.mutationField('login', (t) =>
  t.field({
    type: AuthPayloadType,
    authScopes: { public: true },  // No auth required
    args: { input: t.arg({ type: LoginInput, required: true }) },
    resolve: async (_parent, args, context) => {
      // Login logic...
    },
  })
);

builder.mutationField('signup', (t) =>
  t.field({
    type: AuthPayloadType,
    authScopes: { public: true },
    args: { input: t.arg({ type: SignupInput, required: true }) },
    resolve: async (_parent, args, context) => {
      // Signup logic...
    },
  })
);

builder.mutationField('refreshToken', (t) =>
  t.field({
    type: AuthPayloadType,
    authScopes: { public: true },  // Uses cookie, not auth header
    resolve: async (_parent, _args, context) => {
      // Token refresh logic...
    },
  })
);
```

### 2.3 Field-Level Authorization

**Decision**: Protect sensitive fields with scope requirements.

**User Type with Field Protection** (`apps/graphql/src/schema/types/user.ts`):
```typescript
builder.prismaObject('User', {
  authScopes: { authenticated: true },  // Type-level default
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    createdAt: t.expose('createdAt', { type: 'Date' }),

    // Sensitive field - owner or admin only
    email: t.exposeString('email', {
      authScopes: (user, context) => {
        // Owner can see their own email
        if (context.currentUser?.id === user.id) return true;
        // Admin can see all emails
        if (context.currentUser?.role === 'ADMIN') return true;
        return false;
      },
    }),

    // Sensitive relation - owner only
    sessions: t.relation('sessions', {
      authScopes: (user, context) => {
        return context.currentUser?.id === user.id;
      },
    }),
  }),
});
```

**Session Type** (`apps/graphql/src/schema/types/session.ts`):
```typescript
builder.prismaObject('Session', {
  // Sessions should only be visible to their owner
  authScopes: (session, context) => {
    return context.currentUser?.id === session.userId;
  },
  fields: (t) => ({
    id: t.exposeID('id'),
    createdAt: t.expose('createdAt', { type: 'Date' }),
    lastUsedAt: t.expose('lastUsedAt', { type: 'Date' }),
    ipAddress: t.exposeString('ipAddress'),
    userAgent: t.exposeString('userAgent'),

    // Computed field - is this the current session?
    isCurrent: t.boolean({
      resolve: (session, _args, context) => {
        return session.id === context.sessionId;
      },
    }),

    // Remove or protect the user relation to prevent data leakage
    // user: t.relation('user'),  // REMOVED - prevents reverse lookup
  }),
});
```

### 2.4 IDOR Prevention Pattern

**Decision**: Standardize ownership checks with utility functions.

**Authorization Utilities** (`apps/graphql/src/utils/auth.ts`):
```typescript
import { GraphQLError } from 'graphql';
import type { Context } from '../builder.js';

export class AuthorizationError extends GraphQLError {
  constructor(message = 'Access denied') {
    super(message, { extensions: { code: 'FORBIDDEN' } });
  }
}

export class AuthenticationError extends GraphQLError {
  constructor(message = 'Authentication required') {
    super(message, { extensions: { code: 'UNAUTHENTICATED' } });
  }
}

/**
 * Assert that the current user is authenticated.
 */
export function requireAuth(context: Context): asserts context is Context & { currentUser: User } {
  if (!context.currentUser) {
    throw new AuthenticationError();
  }
}

/**
 * Assert that the current user owns the specified resource.
 */
export function requireOwnership(context: Context, resourceUserId: string): void {
  requireAuth(context);

  if (context.currentUser.id !== resourceUserId) {
    throw new AuthorizationError('You do not have access to this resource');
  }
}

/**
 * Assert that the current user is an admin.
 */
export function requireAdmin(context: Context): void {
  requireAuth(context);

  if (context.currentUser.role !== 'ADMIN') {
    throw new AuthorizationError('Admin access required');
  }
}

/**
 * Assert ownership or admin access.
 */
export function requireOwnershipOrAdmin(context: Context, resourceUserId: string): void {
  requireAuth(context);

  const isOwner = context.currentUser.id === resourceUserId;
  const isAdmin = context.currentUser.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    throw new AuthorizationError();
  }
}
```

**Usage in Resolvers**:
```typescript
builder.queryField('user', (t) =>
  t.prismaField({
    type: 'User',
    nullable: true,
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (query, _parent, args, context) => {
      // IDOR prevention: Only allow fetching own user data (or admin)
      requireOwnershipOrAdmin(context, args.id);

      return prisma.user.findUnique({
        ...query,
        where: { id: args.id },
      });
    },
  })
);
```

---

## Part 3: CSRF Protection

### 3.1 Double-Submit Cookie Pattern

**Decision**: Implement CSRF protection for all mutations using double-submit cookies.

**Implementation** (`apps/graphql/src/middleware/csrf.ts`):
```typescript
import crypto from 'node:crypto';

const CSRF_COOKIE = '__Host-csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Generate a new CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate CSRF token from cookie and header.
 */
export function validateCsrf(request: Request): boolean {
  // Skip for non-mutation requests
  if (request.method !== 'POST') return true;

  // Parse cookie
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [key, ...val] = c.trim().split('=');
      return [key, val.join('=')];
    })
  );

  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = request.headers.get(CSRF_HEADER);

  // Both must exist and match
  if (!cookieToken || !headerToken) return false;

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  );
}

/**
 * Set CSRF cookie on response.
 */
export function setCsrfCookie(response: Response, token: string): void {
  response.headers.append('Set-Cookie', [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'Secure',
    'SameSite=Strict',
    'Max-Age=86400',  // 24 hours
  ].join('; '));
}
```

**Server Integration** (`apps/graphql/src/index.ts`):
```typescript
const yoga = createYoga({
  schema,
  context: async ({ request }) => {
    // CSRF validation for mutations
    if (request.method === 'POST') {
      const body = await request.clone().json();
      const isMutation = body.query?.trim().startsWith('mutation');

      if (isMutation && !validateCsrf(request)) {
        throw new GraphQLError('CSRF validation failed', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
    }

    // ... rest of context setup
  },
});
```

**Frontend Integration** (`apps/admin/src/lib/graphql-client.ts`):
```typescript
import { Client, fetchExchange } from 'urql';

function getCsrfToken(): string {
  const match = document.cookie.match(/__Host-csrf=([^;]+)/);
  return match?.[1] || '';
}

export const client = new Client({
  url: '/graphql',
  exchanges: [fetchExchange],
  fetchOptions: () => ({
    credentials: 'include',  // Include cookies
    headers: {
      'x-csrf-token': getCsrfToken(),
    },
  }),
});
```

---

## Part 4: Error Message Standardization

### 4.1 Prevent Account Enumeration

**Decision**: All authentication failures return identical error messages.

**Implementation** (`apps/graphql/src/schema/mutations/auth.ts`):
```typescript
const AUTH_ERROR = new GraphQLError('Invalid email or password', {
  extensions: { code: 'INVALID_CREDENTIALS' },
});

builder.mutationField('login', (t) =>
  t.field({
    type: AuthPayloadType,
    authScopes: { public: true },
    args: { input: t.arg({ type: LoginInput, required: true }) },
    resolve: async (_parent, args, context) => {
      const { email, password } = args.input;

      // Rate limit check
      const rateLimited = await checkLoginRateLimit(email, context.ipAddress);
      if (rateLimited) {
        // Log detailed info server-side
        console.warn('Login rate limited', { email, ip: context.ipAddress });
        // Return generic error to client
        throw AUTH_ERROR;
      }

      // Lockout check
      const lockedOut = await checkAccountLockout(email);
      if (lockedOut) {
        console.warn('Login blocked - account locked', { email });
        throw AUTH_ERROR;
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        // Timing attack mitigation - still hash compare
        await bcrypt.compare(password, DUMMY_HASH);
        await recordLoginAttempt(email, context.ipAddress, false);
        throw AUTH_ERROR;
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await recordLoginAttempt(email, context.ipAddress, false);
        throw AUTH_ERROR;
      }

      // Success - create session and return tokens
      await recordLoginAttempt(email, context.ipAddress, true);
      // ...
    },
  })
);
```

---

## Part 5: Session Management

### 5.1 Session Listing Query

**Decision**: Users can view their active sessions.

**Implementation** (`apps/graphql/src/schema/queries/auth.ts`):
```typescript
builder.queryField('mySessions', (t) =>
  t.field({
    type: [SessionType],
    authScopes: { authenticated: true },
    description: 'List all active sessions for the current user',
    resolve: async (_parent, _args, context) => {
      return prisma.session.findMany({
        where: {
          userId: context.currentUser!.id,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      });
    },
  })
);
```

### 5.2 Individual Session Revocation

**Implementation** (`apps/graphql/src/schema/mutations/auth.ts`):
```typescript
builder.mutationField('revokeSession', (t) =>
  t.field({
    type: 'Boolean',
    authScopes: { authenticated: true },
    args: {
      sessionId: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      // Find the session
      const session = await prisma.session.findUnique({
        where: { id: args.sessionId },
      });

      if (!session) {
        throw new GraphQLError('Session not found');
      }

      // IDOR prevention: Only allow revoking own sessions
      if (session.userId !== context.currentUser!.id) {
        throw new AuthorizationError('Cannot revoke another user\'s session');
      }

      // Prevent revoking current session (use logout instead)
      if (session.id === context.sessionId) {
        throw new GraphQLError('Cannot revoke current session. Use logout instead.');
      }

      await prisma.session.delete({
        where: { id: args.sessionId },
      });

      return true;
    },
  })
);
```

---

## Part 6: Audit Logging

### 6.1 Logging Strategy

**Decision**: Use Pino for high-performance structured JSON logging with automatic sensitive data redaction.

**Why Pino**:
- Native GraphQL Yoga integration via logging interface
- High performance (fastest Node.js logger)
- Structured JSON output for log aggregation (ELK, Datadog, etc.)
- Built-in redaction for sensitive fields
- Child loggers for request-scoped context
- Pretty printing in development via `pino-pretty`

### 6.2 Logger Configuration

**Implementation** (`apps/graphql/src/utils/logger.ts`):
```typescript
import pino from 'pino';

// Paths to redact from logs (prevents credential leakage)
const REDACT_PATHS = [
  'password', 'passwordHash', 'accessToken', 'refreshToken',
  'token', 'tokenHash', 'previousTokenHash',
  'authorization', 'cookie', 'headers.authorization', 'headers.cookie',
  '*.password', '*.token', 'variables.password', 'variables.token',
];

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (isDevelopment ? 'debug' : 'info'),
  base: { service: 'graphql-api', env: process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  // Pretty print in development only
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// GraphQL Yoga logging integration
export const yogaLogger = {
  debug: (...args) => logger.debug(args[0], args[1]),
  info: (...args) => logger.info(args[0], args[1]),
  warn: (...args) => logger.warn(args[0], args[1]),
  error: (...args) => logger.error(args[0], args[1]),
};
```

### 6.3 Security Event Logging

**Implementation** (`apps/graphql/src/utils/audit.ts`):
```typescript
import { logger } from './logger.js';

// Namespaced event types for easy filtering
export enum AuditEvent {
  // Authentication
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILED = 'auth.login.failed',
  SIGNUP_SUCCESS = 'auth.signup.success',
  LOGOUT = 'auth.logout',
  LOGOUT_ALL = 'auth.logout.all',

  // Token lifecycle
  TOKEN_REFRESH = 'auth.token.refresh',
  TOKEN_REFRESH_FAILED = 'auth.token.refresh.failed',
  TOKEN_REUSE_DETECTED = 'auth.token.reuse',
  TOKEN_EXPIRED = 'auth.token.expired',
  TOKEN_INVALID = 'auth.token.invalid',

  // Session management
  SESSION_CREATED = 'session.created',
  SESSION_REVOKED = 'session.revoked',

  // Security events
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  ACCOUNT_LOCKOUT = 'security.lockout',
  AUTH_REQUIRED = 'auth.required',
  ACCESS_DENIED = 'auth.denied',
  CSRF_FAILED = 'security.csrf.failed',
}

// Child logger with audit component tag
const auditLogger = logger.child({ component: 'audit' });

interface AuditContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
}

// Log levels by severity
export function audit(event: AuditEvent, context: AuditContext, data?: Record<string, unknown>, message?: string): void {
  auditLogger.info({ event, ...context, ...data }, message ?? event);
}

export function auditWarn(event: AuditEvent, context: AuditContext, data?: Record<string, unknown>, message?: string): void {
  auditLogger.warn({ event, ...context, ...data }, message ?? event);
}

export function auditAlert(event: AuditEvent, context: AuditContext, data?: Record<string, unknown>, message?: string): void {
  auditLogger.error({ event, ...context, ...data }, message ?? event);
}
```

### 6.4 Log Output Examples

**Development** (pino-pretty):
```
12:34:56 INFO (audit): User login successful
    event: "auth.login.success"
    userId: "user_123"
    ipAddress: "192.168.1.1"
    userAgent: "Mozilla/5.0..."
```

**Production** (JSON for log aggregation):
```json
{"level":30,"time":"2026-01-15T12:34:56.789Z","service":"graphql-api","env":"production","component":"audit","event":"auth.login.success","userId":"user_123","ipAddress":"192.168.1.1","userAgent":"Mozilla/5.0...","msg":"User login successful"}
```

### 6.5 Events Logged

| Event | Level | Trigger |
|-------|-------|---------|
| `auth.signup.success` | INFO | New user registration |
| `auth.login.success` | INFO | Successful authentication |
| `auth.login.failed` | WARN | Wrong password or user not found |
| `auth.logout` | INFO | Single session logout |
| `auth.logout.all` | INFO | All sessions revoked |
| `auth.token.refresh` | INFO | Access token refreshed |
| `auth.token.reuse` | ERROR | Stolen token detected, family revoked |
| `auth.token.expired` | DEBUG | Normal token expiration |
| `auth.token.invalid` | WARN | Malformed or tampered JWT |
| `session.revoked` | INFO | User revoked specific session |
| `security.rate_limit` | WARN | Rate limit exceeded |
| `security.lockout` | WARN | Account locked due to failed attempts |
| `security.csrf.failed` | WARN | CSRF validation failed |

---

## Implementation Checklist

### Phase 1: Core Authorization (P0) ✅ Complete

- [x] Install `@pothos/plugin-scope-auth`
- [x] Configure builder with auth scopes
- [x] Add default deny policy to query/mutation types
- [x] Mark public endpoints explicitly (`login`, `signup`, `refreshToken`, `me`)
- [x] Add field-level auth to User.email and User.sessions
- [x] Protect Session type with ownership scope

### Phase 2: CSRF & Token Security (P0) ✅ Complete

- [x] Implement CSRF double-submit cookie pattern
- [x] Migrate refresh tokens to HttpOnly cookies
- [x] Update frontend to include CSRF header
- [x] Remove refresh token from response body

### Phase 3: Error Standardization (P0) ✅ Complete

- [x] Unify all auth error messages
- [x] Add timing attack mitigation (dummy hash compare)
- [x] Update rate limit errors to use generic message
- [x] Update lockout errors to use generic message

### Phase 4: Session Management (P1) ✅ Complete

- [x] Add `mySessions` query
- [x] Add `revokeSession` mutation
- [x] Add `isCurrent` computed field to Session
- [x] Remove `user` relation from Session type

### Phase 5: Audit Logging (P1) ✅ Complete

- [x] Implement audit logging utility (Pino structured logging)
- [x] Add audit events to all auth mutations
- [ ] Configure log aggregation (deployment-specific)

---

## Consequences

### Positive

- **Defense in depth**: Multiple authorization layers prevent bypasses
- **Default deny**: New endpoints are protected by default
- **Type-safe authorization**: Pothos scopes are compile-time checked
- **CSRF protection**: Browser-based attacks mitigated
- **XSS protection**: Refresh tokens inaccessible to JavaScript
- **Audit trail**: All security events logged for forensics
- **User control**: Users can manage their own sessions

### Negative

- **Complexity**: Additional authorization layer to maintain
- **Performance**: Scope evaluation adds overhead per field
- **Migration effort**: Existing resolvers need auth scope annotations

### Trade-offs

- We accept scope evaluation overhead for security guarantees
- We accept migration effort for protection against authorization bypass
- We accept CSRF complexity for browser security

---

## Testing Strategy

All tests verify **actual database state**, not just API responses. This eliminates false negatives where tests pass but functionality is broken.

### Test Files

| File | Purpose | Tests |
|------|---------|-------|
| `graphql.e2e.test.ts` | Core functionality E2E tests | 17 |
| `security.pentest.e2e.test.ts` | Security penetration tests | 22 |
| `token-abuse.pentest.e2e.test.ts` | Token abuse scenarios | 15 |

### E2E Tests (`graphql.e2e.test.ts`)

**Auth Mutation Tests:**
- `signs up a new user` - Verifies user created in DB, session created, tokens returned
- `rejects duplicate email signup` - Verifies error returned
- `rejects short passwords` - Verifies error returned
- `logs in an existing user` - Verifies session created in DB with correct userId
- `rejects invalid password` - Verifies error returned
- `refreshes access token` - Verifies previousTokenHash set in DB (rotation tracking)
- `logs out (invalidates refresh token)` - Verifies session deleted from DB

**Auth Query Tests:**
- `returns null for unauthenticated me query`
- `blocks unauthenticated access to users query` - Verifies "Authentication required" error

**Validation Tests:**
- `rejects invalid signup input`
- `rejects common passwords` - Verifies error returned

**Rate Limiting Tests:**
- `records login attempts` - Verifies LoginAttempt records created in DB
- `BLOCKS login after exceeding lockout threshold (actual blocking)` - Pre-populates attempts, verifies blocking

### Security Penetration Tests (`security.pentest.e2e.test.ts`)

**RBAC Tests:**
- `BLOCKS unauthenticated access to admin-only users query`
- `BLOCKS authenticated user from accessing another users data via user(id)`
- `BLOCKS authenticated non-admin user from listing all users`
- `BLOCKS user from deleting another users account`

**Invalid JWT Token Attack Tests:**
- `BLOCKS request with invalid/malformed JWT token`
- `BLOCKS request with JWT signed with wrong secret`
- `BLOCKS request with expired JWT token`
- `BLOCKS JWT with none algorithm`
- `BLOCKS JWT with wrong issuer claim`
- `BLOCKS JWT with wrong audience claim`

**Protected Endpoints with Invalid Tokens:**
- Various tests verifying protected endpoints return "Authentication required"

**CSRF Tests:**
- `BLOCKS POST mutation without CSRF token (via HTTP)`
- `ALLOWS POST with valid CSRF token (double-submit)`

### Token Abuse Tests (`token-abuse.pentest.e2e.test.ts`)

**Refresh Token Abuse:**
- `BLOCKS refresh token reuse after rotation` - Verifies previousTokenHash tracking in DB
- `BLOCKS refresh token from different IP in production mode`
- `BLOCKS expired refresh token`
- `BLOCKS invalid refresh token (random UUID)`

**Brute Force Protection:**
- `BLOCKS brute force login attempts after threshold`
- `BLOCKS account after too many failed attempts (account lockout)`
- `BLOCKS login after exceeding lockout threshold (pre-populated)`

**GraphQL Query Abuse (config validation):**
- `validates depth limiting is configured`
- `validates alias limiting is configured`
- `validates batching limits are configured`

**CORS Protection:**
- `BLOCKS requests from disallowed origins` (config check)
- `validates CORS configuration is secure`
- `BLOCKS preflight from disallowed origin` (HTTP-level)
- `BLOCKS POST from disallowed origin` (HTTP-level)
- `ALLOWS requests from permitted origins`

### Running Tests

```bash
# Run all E2E tests with database
pnpm test:db

# Run specific test file
pnpm --filter graphql vitest run src/graphql.e2e.test.ts

# Run tests in watch mode
pnpm --filter graphql vitest src/graphql.e2e.test.ts
```

---

## References

### Standards
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [RFC 8725 JWT Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725)

### Libraries
- [Pothos Scope Auth Plugin](https://pothos-graphql.dev/docs/plugins/scope-auth)
- [GraphQL Yoga Authentication](https://the-guild.dev/graphql/yoga-server/tutorial/advanced/01-authentication)
- [GraphQL Armor](https://the-guild.dev/graphql/armor)

### Internal References
- [ADR-004: GraphQL API Architecture](./ADR-004-graphql-api-architecture.md)
- [ADR-006: Production Security Hardening](./ADR-006-production-security-hardening.md)
- [PRD-AUTH: Authentication System](../PRD-AUTH.md)
- [GraphQL Auth Gaps Report](../../graphql-auth-gaps-report.md)

---

*Document Version History:*
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-01-15 | Security Review | Initial draft from gap analysis |
