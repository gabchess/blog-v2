# ADR-204: REST API Architecture

## Status
Proposed

## Context

While GraphQL (ADR-004) serves complex relational queries and tRPC (ADR-104) provides maximum type safety for internal services, certain use cases benefit from REST's simplicity and broad compatibility:

1. **External APIs**: Third-party integrations where clients may not use TypeScript
2. **Simple CRUD Operations**: Straightforward operations without GraphQL's overhead
3. **Mobile/Native Apps**: Standard HTTP clients without special libraries
4. **Broad Compatibility**: Any HTTP client can consume REST endpoints
5. **OpenAPI Documentation**: Industry-standard API documentation for external consumers

We needed an approach that:
- Uses PostgreSQL as the database (demonstrating SQL patterns alongside MongoDB)
- Shares validation schemas with GraphQL/tRPC (`@octant/validation`)
- Provides auto-generated OpenAPI documentation via swagger-jsdoc
- Follows Express best practices with Express 5.x

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| TypeScript | >= 5.7.2 | Strict mode required (`"strict": true`) |
| Node.js | >= 18.0.0 | LTS recommended |
| Express | >= 5.1.0 | Uses Express 5 with improved async error handling |
| PostgreSQL | >= 16 | Via Docker Compose |

---

## Decision

We use **Express 5** with **PostgreSQL** and **swagger-jsdoc** for OpenAPI generation. The REST app (`apps/rest`) uses a separate database package (`packages/db-postgres`) while sharing validation schemas with GraphQL/tRPC.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  packages/db-postgres/prisma/schema.prisma                          │
│  SINGLE SOURCE OF TRUTH for REST API types                          │
│  └── Defines: User, Session, LoginAttempt                           │
└─────────────────────────────────────────────────────────────────────┘
                │
                │ pnpm db:push (prisma generate)
                │
                ├─────────────────────────────────────────────────────┐
                ▼                                                     ▼
┌───────────────────────────────────┐    ┌────────────────────────────────────────┐
│  packages/db-postgres/generated   │    │  packages/validation                   │
│  ├── Prisma Client (PostgreSQL)   │    │  ├── SignupInputSchema                 │
│  └── TypeScript types             │    │  ├── LoginInputSchema                  │
└───────────────────────────────────┘    │  └── Shared Zod schemas                │
                │                        └────────────────────────────────────────┘
                │                                          │
                ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/rest                                                          │
│  ├── src/index.ts          # Express server + middleware            │
│  ├── src/routes/           # Route handlers by domain               │
│  │   └── auth.ts           # Auth endpoints (signup, login, etc.)   │
│  ├── src/middleware/       # CSRF, rate limiting                    │
│  ├── src/config/auth.ts    # Auth configuration                     │
│  ├── src/openapi.ts        # OpenAPI/Swagger setup                  │
│  └── src/utils/            # Logger, audit utilities                │
└─────────────────────────────────────────────────────────────────────┘
                │
                │ HTTP + JSON
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OpenAPI Documentation (/api-docs)                                  │
│  ├── Interactive Swagger UI                                         │
│  ├── OpenAPI 3.1 JSON spec (/openapi.json)                          │
│  └── Client SDK generation (via openapi-generator)                  │
└─────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend Apps (admin, web, mobile)                                 │
│  ├── Standard fetch/axios calls                                     │
│  ├── Generated TypeScript client (optional)                         │
│  └── React components                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Why REST Alongside GraphQL/tRPC?

| Aspect | GraphQL (Yoga + Pothos) | tRPC | REST (Express) |
|--------|------------------------|------|----------------|
| **Database** | MongoDB | MongoDB | PostgreSQL |
| **Type source** | Codegen from SDL | TypeScript import | OpenAPI spec |
| **Schema definition** | Pothos type builders | TypeScript types | JSDoc annotations |
| **Client setup** | URQL + generated types | Import AppRouter | fetch + OpenAPI types |
| **Best for** | Complex relational queries | Internal services | External APIs, mobile |
| **Documentation** | GraphQL Playground | None built-in | Swagger UI |

All apps share:
- Same Zod validation schemas (`@octant/validation`)
- Same authentication patterns (JWT + refresh tokens, see ADR-005/105/205)
- Same security patterns (CSRF, rate limiting, audit logging)

**Database separation:**
- REST uses PostgreSQL (`packages/db-postgres`) - demonstrates SQL patterns
- GraphQL/tRPC use MongoDB (`packages/db`) - demonstrates NoSQL patterns
- Template adopters choose ONE API style with its matching database

---

## Development Workflow

### Step 1: Define/Update Prisma Schema

The PostgreSQL Prisma schema is the source of truth for REST:

```prisma
// packages/db-postgres/prisma/schema.prisma

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  name         String
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
}

model Session {
  id                String   @id @default(uuid())
  userId            String
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
```

### Step 2: Regenerate Types

```bash
pnpm --filter @octant/db-postgres db:push
```

This command:
1. Syncs schema to PostgreSQL
2. Regenerates Prisma client types in `packages/db-postgres/generated/`

### Step 3: Create REST Route

```typescript
// apps/rest/src/routes/user.ts

import { Router, type Request, type Response } from 'express';
import { prisma } from '@octant/db-postgres';
import { UpdateUserInputSchema } from '@octant/validation';

const router = Router();

router.get('/:id', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json(user);
});

export { router as userRouter };
```

### Step 4: Add OpenAPI JSDoc Comments

```typescript
/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.get('/:id', async (req: Request, res: Response) => {
  // ... implementation
});
```

### Step 5: Add Zod Validation

```typescript
import { UpdateUserInputSchema } from '@octant/validation';

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = UpdateUserInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  const { name } = parsed.data;
  // ... update user
});
```

### Step 6: Write E2E Tests

```typescript
// apps/rest/src/rest.e2e.test.ts

describe('GET /users/:id', () => {
  it('returns user when found', async () => {
    const user = await createTestUser('get-user');

    const { data, status } = await restRequest(`/users/${user.id}`, {
      accessToken,
    });

    expect(status).toBe(200);
    expect(data?.email).toBe(user.email);

    // VERIFY: Database state matches response
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(dbUser).not.toBeNull();
  });

  it('returns 404 for non-existent user', async () => {
    const { status } = await restRequest('/users/non-existent-id', {
      accessToken,
    });

    expect(status).toBe(404);
  });
});
```

### Step 7: Update Frontend

```typescript
// apps/admin/src/api/users.ts

export async function getUser(id: string, accessToken: string) {
  const response = await fetch(`http://localhost:4000/users/${id}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }

  return response.json();
}
```

---

## Project Structure

```
apps/rest/
├── package.json                    # Express 5 + dependencies
├── tsconfig.json                   # TypeScript config
├── vitest.config.ts                # Unit test config
├── vitest.e2e.config.ts            # E2E test config
└── src/
    ├── index.ts                    # Express server entry
    ├── openapi.ts                  # Swagger/OpenAPI setup
    ├── config/
    │   └── auth.ts                 # JWT, rate limit config
    ├── middleware/
    │   ├── csrf.ts                 # Double-submit cookie CSRF
    │   └── rateLimiter.ts          # express-rate-limit
    ├── routes/
    │   └── auth.ts                 # Auth endpoints
    ├── utils/
    │   ├── logger.ts               # Pino logger
    │   └── audit.ts                # Audit event logging
    └── rest.e2e.test.ts            # E2E tests

packages/db-postgres/
├── package.json                    # Prisma + PostgreSQL
├── prisma/
│   └── schema.prisma               # PostgreSQL schema
├── generated/
│   └── prisma/                     # Generated Prisma client
└── src/
    ├── client.ts                   # Singleton client
    └── index.ts                    # Public exports
```

---

## Checklist: Adding a New Entity

When adding a new entity (e.g., `Product`) to the REST API:

- [ ] **1. Update Prisma schema** in `packages/db-postgres/prisma/schema.prisma`
- [ ] **2. Regenerate types** with `pnpm --filter @octant/db-postgres db:push`
- [ ] **3. Add Zod schema** in `packages/validation/src/index.ts` (if not auto-generated)
- [ ] **4. Create route file** in `apps/rest/src/routes/product.ts`
- [ ] **5. Add OpenAPI annotations** with `@openapi` JSDoc comments
- [ ] **6. Mount router** in `apps/rest/src/index.ts`: `app.use('/products', productRouter)`
- [ ] **7. Write E2E tests** in `apps/rest/src/rest.e2e.test.ts`
- [ ] **8. Verify OpenAPI** at `http://localhost:4000/api-docs`
- [ ] **9. Update frontend** to consume new endpoints

---

## Consequences

### Positive

1. **Broad Compatibility**: Any HTTP client can consume the API
2. **Industry Standard Docs**: OpenAPI/Swagger is widely understood
3. **SQL Patterns**: Demonstrates PostgreSQL with proper relational models
4. **Familiar Framework**: Express is well-known to most developers
5. **Client SDK Generation**: OpenAPI spec enables automatic client generation

### Negative

1. **Two Database Schemas**: PostgreSQL for REST, MongoDB for GraphQL/tRPC
2. **No Automatic Types**: Client types require OpenAPI codegen (not automatic like tRPC)
3. **Verbose Routing**: Each endpoint requires explicit JSDoc annotations
4. **Less Field Selection**: REST returns full objects; no GraphQL-style field picking

### Trade-offs

| Decision | Trade-off |
|----------|-----------|
| Separate PostgreSQL | More maintenance vs. demonstrating SQL patterns |
| Express over Fastify | Slower but more ecosystem support |
| swagger-jsdoc over OpenAPI-first | Inline docs vs. schema-first approach |
| Full OpenAPI spec | More verbose but better external documentation |

---

## Modern Standards Alignment

| Standard | Implementation |
|----------|---------------|
| **HTTP Methods** | GET, POST for auth; standard RESTful verbs |
| **Status Codes** | 200, 201, 400, 401, 404, 409, 429, 500 |
| **Content-Type** | `application/json` |
| **OpenAPI** | Version 3.1.0 |
| **Security** | JWT Bearer tokens, CSRF cookies |
| **Documentation** | Swagger UI at `/api-docs` |

---

## References

- [Express.js Documentation](https://expressjs.com/)
- [swagger-jsdoc](https://github.com/Surnet/swagger-jsdoc)
- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0)
- [Prisma with PostgreSQL](https://www.prisma.io/docs/concepts/database-connectors/postgresql)
- Internal: ADR-003 (Prisma MongoDB), ADR-004 (GraphQL), ADR-104 (tRPC)
- Internal: ADR-005, ADR-105, ADR-205 (Authentication/CSRF)
- Internal: ADR-200 (PostgreSQL + Prisma Monorepo Setup)
