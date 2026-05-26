# ADR-003: Prisma and MongoDB Infrastructure Setup

## Status
Accepted

## Context

We need a database layer that works for both REST and GraphQL APIs with:

1. **Shared types and validation** - Domain types should be defined once and used everywhere
2. **Type safety** - Full TypeScript support from database to frontend
3. **Developer experience** - Easy local development with minimal setup
4. **Testing support** - E2E tests should run against a real database, not mocks

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Raw MongoDB driver | Full control, no abstraction | Manual typing, no schema validation |
| Mongoose | Mature, good TypeScript | Schemas defined separately from types |
| Drizzle | Lightweight, SQL-like | Better suited for SQL databases |
| **Prisma** | Schema-first, type generation, excellent DX | Requires replica set for MongoDB |
| TypeORM | Decorator-based | Heavy, complex configuration |

## Decision

We adopt **Prisma with MongoDB** as the single source of truth for database schema and type generation.

### Architecture Overview

```
packages/db/                    # Database package
├── prisma/
│   └── schema.prisma          # Single source of truth
├── src/
│   └── index.ts               # Re-exports PrismaClient
└── package.json

packages/validation/            # Validation package (Prisma-free)
├── src/
│   ├── generated/             # Auto-generated Zod schemas
│   └── index.ts               # Re-exports schemas
└── package.json               # Only depends on Zod
```

### Three Generators in schema.prisma

The Prisma schema configures three generators that produce different artifacts:

```prisma
generator client {
  provider = "prisma-client-js"
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
```

| Generator | Purpose | Output |
|-----------|---------|--------|
| `prisma-client-js` | Prisma client for database operations | `node_modules/.prisma/client` |
| `prisma-zod-generator` | Zod validation schemas | `packages/validation/src/generated/` |
| `prisma-pothos-types` | Types for `@pothos/plugin-prisma` | `node_modules/.prisma/pothos-types` |

### Zod Generator Configuration

The generator uses a JSON config file (`prisma/zod-generator.config.json`):

```json
{
  "$schema": "../../../node_modules/prisma-zod-generator/lib/config/schema.json",
  "useMultipleFiles": true,
  "pureModels": true,
  "pureModelsLean": true,
  "variants": {
    "pure": { "enabled": true },
    "input": { "enabled": true },
    "result": { "enabled": false }
  }
}
```

**Key settings:**
- `useMultipleFiles: true` - Generates separate files per schema type
- `pureModels: true` - Generates standalone model schemas
- `variants.pure/input` - Generates both pure model and input schemas

### Version Requirements

> **CRITICAL**: Use `prisma-zod-generator@1.31.8` with Prisma 6.x. Version 2.x requires Prisma 7, which does not yet support MongoDB.

```json
{
  "devDependencies": {
    "prisma": "^6.19.2",
    "prisma-zod-generator": "1.31.8"
  }
}
```

The generator outputs files without `.js` extensions, requiring `moduleResolution: "Bundler"` in the validation package's tsconfig. See [ADR-005](./ADR-001-typescript-module-resolution.md) for details.

### Validation Package Design

The `@octant/validation` package re-exports Zod schemas **without any Prisma dependency**.

```json
{
  "name": "@octant/validation",
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

The package exports both generated and hand-written schemas:

```typescript
// packages/validation/src/index.ts

// Re-export generated Zod schemas (Prisma-free)
import { z } from 'zod';

// Pure model schemas (complete model validation)
export * from './generated/schemas/variants/pure/index';
export type { UserPureType } from './generated/schemas/variants/pure/User.pure';
export type { SessionPureType } from './generated/schemas/variants/pure/Session.pure';

// Input schemas (input validation)
export * from './generated/schemas/variants/input/index';
export type { UserInputType } from './generated/schemas/variants/input/User.input';
export type { SessionInputType } from './generated/schemas/variants/input/Session.input';

// === Hand-written auth schemas with business rules ===

const BLOCKED_PASSWORDS = new Set(['password1234', 'password12345', ...]);

export const SignupInputSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(100),
  password: z.string()
    .min(12, 'Password must be at least 12 characters')  // NIST SP 800-63B-4
    .max(64)
    .refine((pwd) => !BLOCKED_PASSWORDS.has(pwd.toLowerCase()),
      'This password is too common'),
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignupInput = z.infer<typeof SignupInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
```

**Key design decisions:**
- **Generated schemas** for model types (UserPureType, SessionInputType)
- **Hand-written schemas** for auth inputs with business rules (password requirements)
- Only export `variants/` (Prisma-free generated schemas)
- TypeScript `include` in tsconfig limits compilation to exported files only

This is critical because:
- Frontend apps can import validation schemas
- No Node.js-specific Prisma code leaks to the browser
- Validation logic is fully portable
- Business rules (password strength, blocked passwords) are enforced at the edge

## MongoDB Setup

### Docker Compose Configuration

MongoDB runs via Docker with a replica set (required by Prisma for transactions):

```yaml
services:
  mongodb:
    image: mongo:7
    ports:
      - "${MONGODB_PORT:-27018}:27017"
    command: --replSet rs0 --bind_ip_all
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: mongosh --eval 'db.runCommand("ping").ok' --quiet
      interval: 5s
      timeout: 5s
      retries: 10

  mongo-init:
    image: mongo:7
    depends_on:
      mongodb:
        condition: service_healthy
    entrypoint:
      - bash
      - -c
      - |
        mongosh mongodb:27017 --eval '
          try { rs.status(); } catch(e) { rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]}); }
          while (!rs.isMaster().ismaster) { sleep(100); }
          print("Replica set ready");
        '

volumes:
  mongodb_data:
```

### Why Replica Set?

Prisma with MongoDB requires a replica set for:
- Transaction support (`$transaction`)
- Change streams (real-time subscriptions)
- Proper rollback semantics

The `mongo-init` service handles replica set initialization automatically.

### Port Configuration

Default port is `27018` (not `27017`) to avoid conflicts with local MongoDB installations:

```bash
# .env.example
MONGODB_PORT=27018
DATABASE_URL="mongodb://localhost:${MONGODB_PORT}/octant?replicaSet=rs0"
```

## Testing Infrastructure

### Test Script (`scripts/test.sh`)

```bash
#!/bin/bash
set -euo pipefail

# Load environment variables
export MONGODB_PORT="${MONGODB_PORT:-27018}"
export DATABASE_URL="mongodb://localhost:${MONGODB_PORT}/octant_test?replicaSet=rs0"

echo "=== Starting Test Infrastructure ==="
docker compose up -d mongodb --wait

echo "Initializing replica set..."
docker compose run --rm mongo-init
echo "MongoDB ready"

echo "Pushing database schema..."
pnpm --filter @octant/db db:push

echo ""
echo "=== Running E2E Tests ==="
pnpm turbo test:e2e

echo ""
echo "=== All Tests Complete ==="
```

### Turbo Configuration

The `test:e2e` task is configured to receive the `DATABASE_URL` environment variable:

```json
{
  "tasks": {
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "env": ["DATABASE_URL"]
    }
  }
}
```

### Testing Philosophy

- **E2E tests use real database** - No mocking, tests verify actual database behavior
- **Separate test database** - Uses `octant_test` instead of `octant`
- **Fresh schema on each run** - `db:push` ensures schema is current

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm db:up` | Start MongoDB in Docker |
| `pnpm db:down` | Stop MongoDB |
| `pnpm db:reset` | Wipe all data and restart |
| `pnpm --filter @octant/db db:push` | Push schema and regenerate all types |
| `pnpm --filter @octant/db db:generate` | Just regenerate types (no schema push) |
| `pnpm --filter @octant/db db:studio` | Open Prisma Studio GUI |
| `./scripts/test.sh` | Run E2E tests with real MongoDB |

### Workflow: Adding a New Model

1. Edit `packages/db/prisma/schema.prisma`
2. Run `pnpm --filter @octant/db db:push` to:
   - Push schema changes to MongoDB
   - Regenerate Prisma client
   - Regenerate Zod schemas in `packages/validation`
   - Regenerate Pothos types
3. Import the new Zod schema from `@octant/validation`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_PORT` | `27018` | Host port for MongoDB container |
| `DATABASE_URL` | See below | Full MongoDB connection string |

### DATABASE_URL Format

```
mongodb://localhost:${MONGODB_PORT}/<database>?replicaSet=rs0
```

- Development: `octant`
- Testing: `octant_test`

## Consequences

### Positive

- **Single source of truth** - Schema defines types, validation, and database structure
- **Type safety end-to-end** - Changes propagate automatically through generation
- **Frontend-safe validation** - `@octant/validation` has no Prisma dependency
- **Real database testing** - E2E tests catch actual database issues
- **Pothos integration** - GraphQL types derive from Prisma models automatically

### Negative

- **Replica set complexity** - Local MongoDB needs replica set configuration
- **Generation step required** - Must run `db:push` or `db:generate` after schema changes
- **Docker dependency** - Local development requires Docker for MongoDB

### Trade-offs

- We accept Docker dependency for reproducible MongoDB configuration
- We accept the generation step for automatic type propagation
- We prioritize type safety over simplicity

## Modern Standards Alignment

*Last reviewed: 2026-01*

### Current Best Practices Alignment

| Practice | Status | Notes |
|----------|--------|-------|
| Single source of truth (schema.prisma) | Aligned | Schema defines types, validation, and database structure |
| Type generation pipeline | Aligned | Three generators produce complementary artifacts |
| Frontend-safe validation | Aligned | `@octant/validation` has zero Prisma dependency |
| Replica set for development | Aligned | Single-node replica set is recommended for local development |
| Singleton pattern for PrismaClient | Aligned | `packages/db/src/client.ts` uses global pattern to prevent multiple instances |
| Turborepo integration | Aligned | DATABASE_URL passthrough configured in turbo.json |

### Generator Ecosystem Status (2026)

The `prisma-zod-generator` by Omar Dulaimi is the **recommended choice** for new projects:

- Actively maintained with regular updates
- The original `zod-prisma-types` maintainer officially recommends it as the successor
- Supports Prisma 6.x and Zod 3.x/4.x
- Offers multiple generation modes (Minimal, Full, Custom)

### Serverless Deployment Considerations

For serverless/edge deployments, consider these enhancements:

1. **Connection Pooling**: Use [Prisma Accelerate](https://www.prisma.io/docs/accelerate) for managed connection pooling with HTTP-based connections and global caching

2. **Engine-less Mode** (Prisma v6.16+): Reduce bundle size by using `engineType = "client"` in the generator block:
   ```prisma
   generator client {
     provider   = "prisma-client-js"
     engineType = "client"  // Removes Rust binaries, uses native JS driver
   }
   ```

3. **Connection Limit**: For serverless functions, configure `connection_limit=1` to prevent database connection exhaustion

### MongoDB Replica Set Best Practices
- Single-node replica set sufficient for local development
- Health checks ensure MongoDB is ready before initialization
- Idempotent replica set initialization (checks `rs.status()` before `rs.initiate()`)

For production multi-node deployments, consider:
- Minimum 3 nodes for high availability
- Separate physical servers for each replica
- Authentication and TLS configuration

### Full-Stack Feature Development Efficiency

This architecture supports efficient full-stack development through:

1. **Single Edit Point**: Modify `schema.prisma` once, regenerate all types
2. **Zero Manual Sync**: Zod schemas update automatically with schema changes
3. **Type Propagation**: Changes flow from database to frontend validation
4. **GraphQL Integration**: Pothos types derive from Prisma models automatically
5. **Real Database Testing**: E2E tests catch actual behavior, not mock assumptions

### References

- [Prisma Best Practices](https://www.prisma.io/docs/tags/best-practices)
- [Prisma + Next.js Guide](https://www.prisma.io/docs/orm/more/help-and-troubleshooting/nextjs-help)
- [MongoDB Replica Set with Docker](https://medium.com/workleap/the-only-local-mongodb-replica-set-with-docker-compose-guide-youll-ever-need-2f0b74dd8384)
- [prisma-zod-generator GitHub](https://github.com/omar-dulaimi/prisma-zod-generator)
- [Prisma Connection Pooling](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)
