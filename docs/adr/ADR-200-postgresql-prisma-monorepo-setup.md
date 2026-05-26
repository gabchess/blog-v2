# ADR-200: PostgreSQL + Prisma Monorepo Setup

## Status

Proposed

## Context

The REST API implementation requires a PostgreSQL database to demonstrate SQL patterns alongside the existing MongoDB setup for GraphQL/tRPC. This creates a multi-database monorepo scenario that requires careful configuration to avoid common pitfalls.

Key questions:
1. How to structure a second Prisma package in the monorepo?
2. How to configure custom output paths to avoid client conflicts?
3. How to set up PostgreSQL Docker for local development?
4. How to configure Turborepo task dependencies?

## Research Findings

### Web Sources

- **Centralized database package is consensus** — All sources recommend `packages/db-*` structure rather than embedding Prisma in apps. This prevents duplication and ensures type consistency across the monorepo. ([Prisma Docs](https://www.prisma.io/docs/guides/turborepo), [DEV Community](https://dev.to/wasimadildev/setting-up-prisma-postgresql-in-a-monorepo-turborepo-pnpm-nodejs-30ah))

- **Custom output directory is critical** — Generating to `node_modules` causes conflicts in monorepos. Custom paths like `../generated/prisma` are recommended and will become required in Prisma 7.x. ([Prisma Client Generation](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client))

- **Task dependencies must be explicit** — `db:generate` must run before `dev` and `build`. Without this, new developers see errors immediately. ([Trigger.dev Prisma Guide](https://trigger.dev/docs/guides/example-projects/turborepo-monorepo-prisma))

### Expert Opinions (Twitter/X)

- **@jaredpalmer (Turborepo creator)**: Acknowledged that Prisma + Turborepo + pnpm has been "painful" historically, contributing to improved documentation.

- **Prisma Team**: Actively fixing pnpm isolation issues (PR #28735). Prisma 7.0.0 had TS2742 errors in pnpm monorepos now resolved.

- **Community consensus**: Multiple Prisma clients in one monorepo work with separate packages and custom output paths.

### Production Examples (GitHub)

- **[vercel/turborepo examples/with-prisma](https://github.com/vercel/turborepo/blob/main/examples/with-prisma)**: Official reference with `@repo/database` package, custom output to `../src/generated`.

- **[belgattitude/nextjs-monorepo-example](https://github.com/belgattitude/nextjs-monorepo-example)**: Production-ready setup with `packages/db-main-prisma/`, PostgreSQL + Docker support, Supabase integration.

- **Pattern observed**: All use wrapper exports (`src/index.ts`) that re-export client instance and types.

### Official Guidance

- **Prisma 7.x requirement**: `output` field in generator block will become required. Strongly recommend adding now.

- **Multiple databases**: Create separate schema files in separate directories, each with custom `output` path and distinct `DATABASE_URL` env var.

- **PostgreSQL Docker**: Must provide `POSTGRES_PASSWORD`, use `pg_isready` for health checks, pin version tag (avoid `latest`), use persistent volumes.

- **Singleton pattern**: Global memoization prevents multiple client instances and connection pool exhaustion.

## Decision

### 1. Package Structure

Create `packages/db-postgres/` mirroring `packages/db/` structure:

```
packages/db-postgres/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── client.ts      # Singleton PrismaClient
│   └── index.ts       # Public exports
├── generated/         # Custom output (gitignored)
├── package.json
└── tsconfig.json
```

### 2. Custom Output Directory

Configure Prisma to generate outside `node_modules`:

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../generated/prisma"
  binaryTargets = ["native", "debian-openssl-3.0.x", "linux-arm64-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}
```

### 3. Singleton Client Pattern

```typescript
// packages/db-postgres/src/client.ts
import { PrismaClient } from '../generated/prisma/index.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;
```

### 4. Docker Configuration

```yaml
postgres:
  image: postgres:16  # Pin version
  ports:
    - "5432:5432"
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: octant
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 5
```

### 5. Turborepo Task Configuration

```json
"@octant/db-postgres#db:generate": {
  "outputs": ["generated/**"],
  "cache": false
},
"@octant/db-postgres#db:push": {
  "cache": false
}
```

### 6. Environment Variables

Use distinct env var name to avoid conflicts:

```bash
# MongoDB (existing)
DATABASE_URL="mongodb://..."

# PostgreSQL (new)
POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/octant"
```

## Consequences

### Positive

- **Clear separation**: MongoDB for GraphQL/tRPC, PostgreSQL for REST. Template adopters pick ONE API style with its matching database.
- **No conflicts**: Custom output paths prevent Prisma client overwrites.
- **Type safety**: Each package exports its own types; consuming apps import from the appropriate `@octant/db-*` package.
- **Educational value**: Demonstrates both SQL and NoSQL patterns in one template.

### Negative

- **Two schemas to maintain**: Changes to User/Session models must be made in both schemas.
- **Increased complexity**: Two database containers, two Prisma packages, two connection strings.
- **Learning curve**: Developers must understand which database goes with which API style.

### Trade-offs

We accept the maintenance overhead of two schemas because:
1. Template adopters will delete the unused API style and its database package
2. Having both patterns serves the educational purpose of the template
3. Demonstrating PostgreSQL is valuable for REST API adopters who often prefer SQL databases

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Single MongoDB for all | Less educational value; REST adopters often prefer SQL |
| PostgreSQL multi-schema | Unnecessary complexity; we want separate packages |
| Shared sessions across APIs | Template adopters pick ONE API style; shared sessions adds confusion |
| Generate to node_modules | Conflicts in monorepos; deprecated pattern |

## References

- [Prisma Turborepo Guide](https://www.prisma.io/docs/guides/turborepo)
- [Prisma pnpm Workspaces Guide](https://www.prisma.io/docs/guides/use-prisma-in-pnpm-workspaces)
- [Prisma Multiple Databases Guide](https://www.prisma.io/docs/guides/multiple-databases)
- [Prisma Client Generation Docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client)
- [PostgreSQL Docker Official Image](https://github.com/docker-library/docs/blob/master/postgres/README.md)
- [Vercel Turborepo with-prisma example](https://github.com/vercel/turborepo/blob/main/examples/with-prisma)
- [belgattitude/nextjs-monorepo-example](https://github.com/belgattitude/nextjs-monorepo-example)
- [Prisma Discussion #19444: Multiple packages in monorepo](https://github.com/prisma/prisma/discussions/19444)
- [Turborepo Discussion #3493: Multiple Prisma clients](https://github.com/vercel/turborepo/discussions/3493)
