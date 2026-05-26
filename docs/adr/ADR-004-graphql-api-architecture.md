# ADR-004: GraphQL API Architecture

## Status
Accepted

## Context

While REST works well for simple CRUD operations with predictable data shapes, certain use cases benefit from GraphQL's flexibility:

1. **Admin Dashboards**: Complex UIs that need to fetch related data in a single request (products with their categories, orders with customers and line items)
2. **Complex Queries**: Clients need fine-grained control over which fields to fetch, avoiding over-fetching or under-fetching
3. **Real-time Subscriptions**: Live updates for dashboards, notifications, or collaborative features
4. **Rapid Frontend Iteration**: Frontend teams can modify queries without backend changes

We needed a code-first approach that:
- Uses Prisma as the single source of truth for data models
- Auto-generates GraphQL types from Prisma to eliminate drift
- Auto-generates Zod validation schemas for runtime validation
- Provides end-to-end type safety from database to GraphQL to client

## Decision

We use **Prisma** as the single source of truth, with **GraphQL Yoga** as the server runtime, **Pothos** with the Prisma plugin for code-first schema building, and **prisma-zod-generator** for auto-generated Zod validation schemas.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  packages/db/prisma/schema.prisma                                   │
│  SINGLE SOURCE OF TRUTH for all types                               │
│  └── Defines: User, Product, Session, enums, relations              │
└─────────────────────────────────────────────────────────────────────┘
                │
                │ pnpm db:push (prisma generate)
                │
                ├─────────────────────────────────────────────────────┐
                ▼                                                     ▼
┌───────────────────────────────────┐    ┌────────────────────────────────────────┐
│  @prisma/client                   │    │  packages/validation/src/generated     │
│  ├── Prisma Client                │    │  (prisma-zod-generator output)         │
│  └── PrismaTypes for Pothos       │    │  ├── ProductSchema                     │
└───────────────────────────────────┘    │  ├── ProductCreateInputSchema          │
                │                        │  └── ProductUpdateInputSchema          │
                │                        └────────────────────────────────────────┘
                ▼                                          │
┌─────────────────────────────────────────────────────────────────────┐
│  apps/graphql                                                       │
│  ├── src/builder.ts           # Pothos + PrismaPlugin               │
│  ├── src/schema/types/        # builder.prismaObject()              │
│  ├── src/schema/queries/      # t.prismaField() for queries         │
│  ├── src/schema/mutations/    # Zod validation + t.prismaField()    │
│  └── src/*.e2e.test.ts        # E2E tests using yoga.fetch()        │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Prisma as Single Source of Truth?

| Approach | Description | Chosen? |
|----------|-------------|---------|
| Manual types + Pothos | Define types in `@octant/types`, wire manually | No - drift risk |
| Prisma + Pothos Prisma Plugin | Prisma schema generates all types | **Yes** |

Benefits of Prisma as source of truth:
- **Zero drift**: GraphQL types are auto-generated from Prisma models
- **Database-aligned**: Schema matches actual database structure
- **Cascading generation**: One `db:push` regenerates Prisma client, Pothos types, AND Zod schemas

---

## Development Workflow

### Step 1: Define/Update Prisma Schema

The Prisma schema is the single source of truth for all data models:

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}

generator zod {
  provider = "prisma-zod-generator"
  output   = "../../validation/src/generated"
  config   = "./zod-generator.config.json"
}

generator pothos {
  provider = "prisma-pothos-types"
}

datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(auto()) @map("_id") @db.ObjectId
  email        String    @unique
  name         String
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
}

model Session {
  id                String   @id @default(auto()) @map("_id") @db.ObjectId
  userId            String   @db.ObjectId
  user              User     @relation(fields: [userId], references: [id])
  tokenHash         String   @unique
  tokenFamily       String
  previousTokenHash String?
  expiresAt         DateTime
  createdAt         DateTime @default(now())
  lastUsedAt        DateTime @default(now())
  ipAddress         String?
  userAgent         String?
}

model LoginAttempt {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  email     String
  ipAddress String
  success   Boolean
  createdAt DateTime @default(now())

  @@index([email, createdAt])
  @@index([ipAddress, createdAt])
}
```

### Step 2: Sync Database and Regenerate Types

Run `pnpm db:push` from the db package to:
1. Push schema changes to MongoDB
2. Regenerate Prisma client
3. Regenerate Pothos types (`PrismaTypes`)
4. Regenerate Zod schemas to `packages/validation/src/generated`

```bash
pnpm --filter @octant/db db:push
```

This single command cascades to regenerate all derived types.

### Step 3: Define GraphQL Types

Use `builder.prismaObject()` to define GraphQL object types that map directly to Prisma models:

```typescript
// apps/graphql/src/schema/types/user.ts

import { builder } from '../../builder.js';

/**
 * User object type - fields derived from Prisma User model.
 * builder.prismaObject() auto-generates field types from Prisma schema.
 *
 * Security: Field-level authorization is applied to sensitive fields.
 */
builder.prismaObject('User', {
  description: 'A user in the system',
  fields: (t) => ({
    id: t.exposeID('id', {
      description: 'Unique identifier for the user',
    }),
    name: t.exposeString('name', {
      description: 'Display name of the user',
    }),
    createdAt: t.expose('createdAt', {
      type: 'Date',
      description: 'Timestamp when the user was created',
    }),
    updatedAt: t.expose('updatedAt', {
      type: 'Date',
      description: 'Timestamp when the user was last updated',
    }),

    // Sensitive field - owner only (prevents email harvesting)
    email: t.exposeString('email', {
      description: 'Email address (only visible to owner)',
      authScopes: (parent, _args, context, _info) => {
        return context.currentUser?.id === parent.id;
      },
    }),

    // Sensitive relation - owner only
    sessions: t.relation('sessions', {
      description: 'Active sessions (only visible to owner)',
      authScopes: (parent, _args, context, _info) => {
        return context.currentUser?.id === parent.id;
      },
    }),
  }),
});
```

**Key insight**: `builder.prismaObject('User', ...)` links to the Prisma `User` model. Field types are validated against the Prisma schema at compile time. The `authScopes` callback enables field-level authorization.

### Step 4: Define Queries

Use `t.prismaField()` for type-safe queries with automatic Prisma query building:

```typescript
// apps/graphql/src/schema/queries/auth.ts

import { prisma } from '@octant/db';
import { builder } from '../../builder.js';

/**
 * Query to fetch the currently authenticated user.
 * Returns null if not authenticated.
 *
 * Security: This is PUBLIC - anyone can call it.
 * It returns data only for authenticated users.
 */
builder.queryField('me', (t) =>
  t.prismaField({
    type: 'User',
    nullable: true,
    description: 'Get the currently authenticated user',
    // Mark as public - skip root type's auth requirement
    skipTypeScopes: true,
    resolve: async (query, _parent, _args, context) => {
      if (!context.currentUser) {
        return null;
      }
      return prisma.user.findUnique({
        ...query,
        where: { id: context.currentUser.id },
      });
    },
  })
);

/**
 * Query to list all active sessions for the current user.
 * Requires authentication (inherits from root Query type).
 */
builder.queryField('mySessions', (t) =>
  t.prismaField({
    type: ['Session'],
    description: 'List all active sessions for the current user',
    // Inherits authentication requirement from root Query type
    resolve: async (query, _parent, _args, context) => {
      return prisma.session.findMany({
        ...query,
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

**Key insight**: The `query` parameter passed to the resolver contains Prisma-optimized select/include options based on the GraphQL query. This prevents over-fetching at the database level. Use `skipTypeScopes: true` to make queries public.

### Step 5: Define Mutations with Zod Validation

Mutations use Zod schemas from `@octant/validation` for runtime validation:

```typescript
// apps/graphql/src/schema/mutations/auth.ts

import { prisma } from '@octant/db';
import bcrypt from 'bcrypt';
import { SignupInputSchema, LoginInputSchema } from '@octant/validation';
import { builder } from '../../builder.js';
import { generateTokens, hashToken } from '../../utils/auth.js';

/**
 * Input type for user signup.
 */
const SignupInput = builder.inputType('SignupInput', {
  fields: (t) => ({
    email: t.string({ required: true, description: 'User email' }),
    name: t.string({ required: true, description: 'User display name' }),
    password: t.string({ required: true, description: 'User password' }),
  }),
});

/**
 * Signup mutation - creates a new user account.
 * PUBLIC: No authentication required.
 */
builder.mutationField('signup', (t) =>
  t.field({
    type: AuthPayload,
    description: 'Create a new user account',
    args: { input: t.arg({ type: SignupInput, required: true }) },
    // PUBLIC - skip authentication
    skipTypeScopes: true,
    resolve: async (_parent, args, context) => {
      // Validate input using hand-written Zod schema with business rules
      const validated = SignupInputSchema.parse(args.input);

      // Hash password with bcrypt (12 rounds)
      const passwordHash = await bcrypt.hash(validated.password, 12);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: validated.email,
          name: validated.name,
          passwordHash,
        },
      });

      // Generate tokens and create session
      const { accessToken, refreshToken, sessionId } = await generateTokens(
        user.id, context.ipAddress, context.userAgent
      );

      return { accessToken, user };
    },
  })
);
```

**Why Zod validation in mutations?**
- GraphQL validates types but not business rules (password length, blocked passwords, etc.)
- Zod schemas include business rules (12-char minimum, blocked password list)
- Validation errors are thrown as GraphQL errors with detailed messages

> **Note**: The `@octant/validation` package exports both auto-generated schemas (from prisma-zod-generator) for model types, and hand-written schemas for auth inputs that include business rules like password requirements.

### Step 6: Write E2E Tests

E2E tests run against real MongoDB using GraphQL Yoga's `fetch()` API. This pattern leverages the WHATWG Fetch standard, making tests portable across JavaScript runtimes and eliminating the need for HTTP server setup:

```typescript
// apps/graphql/src/graphql.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { prisma } from '@octant/db';
import { schema } from './schema/index.js';

const yoga = createYoga({ schema });

// Cookie jar for storing HttpOnly cookies from responses
const cookieJar = new Map<string, string>();

async function executeQuery(
  query: string,
  variables?: Record<string, unknown>,
  accessToken?: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers['authorization'] = `Bearer ${accessToken}`;
  }
  if (cookieJar.size > 0) {
    headers['cookie'] = Array.from(cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  // Parse Set-Cookie headers into jar
  const setCookies = response.headers.getSetCookie();
  for (const cookie of setCookies) {
    const [name, value] = cookie.split(';')[0]?.split('=') ?? [];
    if (name && value) cookieJar.set(name.trim(), value.trim());
  }

  return response.json();
}

describe('Auth E2E Tests', () => {
  let accessToken: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({});
    await prisma.session.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('signs up a new user', async () => {
    const result = await executeQuery(`
      mutation Signup($input: SignupInput!) {
        signup(input: $input) {
          accessToken
          user { id email name }
        }
      }
    `, {
      input: {
        email: 'test@example.com',
        name: 'Test User',
        password: 'securepassword123',
      },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data.signup.accessToken).toBeDefined();
    expect(result.data.signup.user.email).toBe('test@example.com');
    accessToken = result.data.signup.accessToken;
  });

  it('rejects weak passwords', async () => {
    const result = await executeQuery(`
      mutation Signup($input: SignupInput!) {
        signup(input: $input) { accessToken }
      }
    `, {
      input: {
        email: 'weak@example.com',
        name: 'Weak User',
        password: 'short',  // Fails 12-char minimum
      },
    });

    expect(result.errors).toBeDefined();
  });

  it('fetches current user with me query', async () => {
    const result = await executeQuery(`
      query Me { me { id email name } }
    `, undefined, accessToken);

    expect(result.errors).toBeUndefined();
    expect(result.data.me.email).toBe('test@example.com');
  });
});
```

### Step 7: Run Tests

Run E2E tests against real MongoDB:

```bash
./scripts/test.sh
```

This script:
1. Starts MongoDB via Docker Compose
2. Initializes replica set (required for Prisma transactions)
3. Pushes database schema
4. Runs all E2E tests with `pnpm turbo test:e2e`

---

## Pothos Builder Configuration

The builder is configured with the Prisma plugin for type-safe schema building:

```typescript
// apps/graphql/src/builder.ts

import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import type PrismaTypes from '@pothos/plugin-prisma/generated';
import { prisma, Prisma } from '@octant/db';

/**
 * Type definitions for Pothos schema builder.
 * Uses auto-generated PrismaTypes from the Prisma schema.
 */
export interface PothosTypes {
  PrismaTypes: PrismaTypes;
  Scalars: {
    Date: {
      Input: Date;
      Output: Date;
    };
  };
}

/**
 * Configured Pothos schema builder with Prisma plugin.
 */
export const builder = new SchemaBuilder<PothosTypes>({
  plugins: [PrismaPlugin],
  prisma: {
    client: prisma,
    dmmf: Prisma.dmmf,
  },
});

// Register custom Date scalar
builder.scalarType('Date', {
  serialize: (value) => value.toISOString(),
  parseValue: (value) => new Date(value as string),
});
```

**Key points**:
- `PrismaTypes` is auto-generated by `prisma-pothos-types` generator
- `builder.prismaObject()` and `t.prismaField()` are type-safe against Prisma models
- Custom scalars (Date) are registered once and used throughout

---

## Schema Assembly

All types, queries, and mutations are assembled in the schema index:

```typescript
// apps/graphql/src/schema/index.ts

import { builder } from '../builder.js';

// Import type definitions (order matters for dependencies)
import './types/session.js';
import './types/user.js';

// Import queries
import './queries/user.js';
import './queries/auth.js';

// Import mutations
import './mutations/auth.js';

/**
 * Root Query type with default authentication requirement.
 * All fields require authentication unless they set skipTypeScopes: true
 */
builder.queryType({
  description: 'Root query type',
  authScopes: { authenticated: true },
});

/**
 * Root Mutation type with default authentication requirement.
 */
builder.mutationType({
  description: 'Root mutation type',
  authScopes: { authenticated: true },
});

/**
 * Export the complete GraphQL schema.
 */
export const schema = builder.toSchema();
```

---

## Project Structure

```
turborepo-template/
├── packages/
│   ├── db/
│   │   ├── prisma/
│   │   │   └── schema.prisma        # SINGLE SOURCE OF TRUTH
│   │   └── src/
│   │       └── index.ts             # Exports prisma client + types
│   │
│   └── validation/
│       └── src/
│           ├── index.ts             # Re-exports + hand-written auth schemas
│           └── generated/           # Auto-generated Zod schemas
│
├── apps/
│   └── graphql/
│       ├── src/
│       │   ├── builder.ts           # Pothos + PrismaPlugin + ScopeAuth
│       │   ├── index.ts             # Yoga server with security middleware
│       │   ├── config/auth.ts       # Auth configuration
│       │   ├── middleware/csrf.ts   # CSRF protection
│       │   ├── utils/
│       │   │   ├── auth.ts          # Token generation, hashing
│       │   │   ├── audit.ts         # Security event logging
│       │   │   └── logger.ts        # Pino structured logging
│       │   ├── graphql.e2e.test.ts  # E2E tests
│       │   └── schema/
│       │       ├── index.ts         # Schema assembly with default deny
│       │       ├── types/
│       │       │   ├── user.ts      # builder.prismaObject() + field auth
│       │       │   └── session.ts
│       │       ├── queries/
│       │       │   ├── auth.ts      # me, mySessions queries
│       │       │   └── user.ts
│       │       └── mutations/
│       │           └── auth.ts      # signup, login, logout, refresh
│       └── package.json
│
└── scripts/
    └── test.sh                      # E2E test runner with MongoDB
```

---

## Checklist: Adding a New Entity

When adding a new GraphQL entity (e.g., `Post`):

1. **Define in Prisma schema** (`packages/db/prisma/schema.prisma`)
   - [ ] Add the model with all fields and relations
   - [ ] Add any new enums
   - [ ] Add indexes for common query patterns

2. **Regenerate types** (run from repo root)
   - [ ] Run `pnpm --filter @octant/db db:push`
   - [ ] Verify Zod schemas generated in `packages/validation/src/generated`

3. **Define GraphQL type** (`apps/graphql/src/schema/types/post.ts`)
   - [ ] Create file with `builder.prismaObject('Post', {...})`
   - [ ] Add `authScopes` to sensitive fields (e.g., owner-only data)
   - [ ] Export any enum types needed

4. **Define queries** (`apps/graphql/src/schema/queries/post.ts`)
   - [ ] Add list query with `t.prismaField()`
   - [ ] Add single-item query with ownership check
   - [ ] Use `skipTypeScopes: true` for public queries

5. **Define mutations** (`apps/graphql/src/schema/mutations/post.ts`)
   - [ ] Define input types with `builder.inputType()`
   - [ ] Validate with Zod schemas from `@octant/validation`
   - [ ] Use `skipTypeScopes: true` for public mutations
   - [ ] Add audit logging for sensitive operations

6. **Register in schema** (`apps/graphql/src/schema/index.ts`)
   - [ ] Import the new type file
   - [ ] Import the new query file
   - [ ] Import the new mutation file

7. **Write E2E tests** (`apps/graphql/src/post.e2e.test.ts`)
   - [ ] Test CRUD operations via GraphQL
   - [ ] Test validation error cases
   - [ ] Test authorization (owner-only access)

8. **Security review**
   - [ ] Verify field-level auth scopes on sensitive data
   - [ ] Verify IDOR prevention (ownership checks)
   - [ ] Verify no data leakage in error messages

9. **Verify**
   - [ ] Run `pnpm build && pnpm typecheck`
   - [ ] Run `./scripts/test.sh`

---

## Consequences

### Positive

- **Single source of truth**: Prisma schema drives everything (DB, types, validation)
- **Zero drift**: GraphQL types auto-generated from Prisma models
- **End-to-end type safety**: Prisma -> Pothos -> GraphQL -> Client
- **Auto-generated validation**: Zod schemas from Prisma with business rules
- **Optimized queries**: `t.prismaField()` passes query options to Prisma
- **Real database testing**: E2E tests run against actual MongoDB

### Negative

- **Generation step required**: Must run `db:push` after schema changes
- **Learning curve**: Pothos Prisma plugin API differs from basic Pothos
- **MongoDB-specific**: Schema uses MongoDB ObjectId and replica set
- **N+1 query risk**: Complex nested queries may need DataLoader

### Mitigations

- Add `db:push` to CI/CD pipeline
- Use DataLoader plugin for complex nested fetching when needed
- Document the generation workflow in this ADR

---

## Modern Standards Alignment (January 2026)

This architecture aligns with modern GraphQL best practices as of January 2026:

### Pothos Code-First Approach

Our use of Pothos with the Prisma plugin follows the [recommended code-first pattern](https://pothos-graphql.dev/) for TypeScript GraphQL servers:

- **Type safety without codegen**: Pothos leverages TypeScript generics for full type inference in resolvers without requiring code generation or experimental decorators
- **Builder pattern**: The chainable `SchemaBuilder` API with `builder.toSchema()` is the standard pattern for explicit schema construction
- **Plugin ecosystem**: The Prisma plugin integration for efficient n+1 query resolution and the Zod validation plugin for input validation are production-proven patterns
- **Domain organization**: Organizing schema files by domain (types/, queries/, mutations/) rather than by GraphQL operation type is the recommended pattern for code-first libraries

### GraphQL Yoga Production Readiness

GraphQL Yoga is the recommended production server as of 2026:

- **WHATWG Fetch API**: The `yoga.fetch()` pattern used in our E2E tests follows the standard Fetch API, enabling deployment on any JavaScript runtime (Node.js, Deno, Bun, Cloudflare Workers)
- **Envelop plugin ecosystem**: Built on Envelop, providing access to production plugins for rate limiting, caching, auth, tracing, and monitoring
- **Performance**: GraphQL Yoga demonstrates lower latency and higher request rates than Apollo Server in production benchmarks
- **Security by default**: Error masking and validation caching are enabled by default

### Production Recommendations

For production deployments, consider adding:

1. **Security**: [GraphQL Armor](https://the-guild.dev/graphql/armor) plugins for query depth limiting, field suggestions disabling, and cost analysis
2. **Caching**: [Yoga Response Cache Plugin](https://the-guild.dev/graphql/yoga-server/docs/features/response-caching) for response-level caching
3. **Monitoring**: [Sentry plugin](https://the-guild.dev/graphql/envelop/plugins/use-sentry) for error tracking
4. **Performance**: Consider [µWebSockets.js](https://github.com/uNetworking/uWebSockets.js) as an alternative HTTP server for high-throughput scenarios

### Relay Compatibility

The Pothos + Prisma stack provides excellent Relay support when needed:

- `@pothos/plugin-relay` for Node interfaces and cursor-based connections
- Compatible with both Relay and Apollo Client on the frontend
- Recommended for complex admin dashboards with pagination requirements

---

## References

- [Pothos GraphQL](https://pothos-graphql.dev/) - Code-first GraphQL schema builder
- [Pothos Prisma Plugin](https://pothos-graphql.dev/docs/plugins/prisma)
- [GraphQL Yoga Documentation](https://the-guild.dev/graphql/yoga-server)
- [GraphQL Yoga Production Guide](https://the-guild.dev/graphql/yoga-server/docs/prepare-for-production)
- [Prisma MongoDB](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [prisma-zod-generator](https://github.com/omar-dulaimi/prisma-zod-generator)
- ADR-001: Screaming Architecture (domain-first organization)
- ADR-000: Turborepo Monorepo Template (dependency flow)
