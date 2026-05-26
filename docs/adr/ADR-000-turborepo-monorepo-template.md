# ADR-000: Turborepo Monorepo Template

## Status
Accepted

## Context

We need a reproducible monorepo structure for TypeScript projects that:

1. Supports multiple apps sharing domain logic
2. Provides fast incremental builds with caching
3. Enforces clear dependency boundaries
4. Works well with Docker-based development
5. Scales from small projects to larger teams

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Nx | Feature-rich, good caching | Heavy, opinionated structure |
| Lerna | Mature, well-documented | Slower builds, less caching |
| Rush | Enterprise-ready | Complex setup, steep learning curve |
| **Turborepo + pnpm** | Fast, simple, excellent caching | Fewer built-in generators |
| Yarn Workspaces alone | Simple | No task orchestration or caching |

## Decision

We adopt **Turborepo with pnpm workspaces** as our monorepo foundation.

### Key Patterns

1. **Package Structure**:
   - `packages/` - Shared libraries (framework-agnostic)
     - `@octant/db` - Prisma database client and schema
     - `@octant/validation` - Zod schemas for validation
   - `apps/` - Deployable applications (framework-specific)
     - `@octant/api` - REST API server (Express/Node)
     - `@octant/graphql` - GraphQL API server (Yoga/Pothos)
     - `@octant/web` - Web frontend (React/Vite)
     - `@octant/admin` - Admin dashboard (React/Vite/urql)

2. **Dependency Flow**:
   ```
   packages/validation (zod, zero internal deps)
       ↓
   packages/db (prisma, zero internal deps)
       ↓
   apps/* (depend on packages via workspace:*)
   ```

   Note: `@octant/db` and `@octant/validation` are leaf packages with no inter-package dependencies. Apps depend on both packages as needed.

3. **TypeScript Configuration**:
   - `tsconfig.base.json` - Shared compiler options (ES2022, NodeNext, strict mode)
   - `tsconfig.json` - Root project references (currently references legacy paths)
   - Per-package configs extend base and declare references
   - Uses `composite`, `declaration`, `declarationMap`, and `incremental` for optimal builds

4. **Task Semantics** (turbo.json):
   - `dependsOn: ["^build"]` - Build dependencies first (topological)
   - `outputs: ["dist/**"]` - Define cacheable artifacts
   - `cache: false` - For tests, dev, clean (non-deterministic or stateful)
   - `persistent: true` - For dev servers (long-running)
   - `env: ["DATABASE_URL"]` - Environment variable tracking for cache invalidation

5. **Test File Naming**:
   - `*.test.ts` - Unit tests (excluded from e2e runs)
   - `*.integration.test.ts` - Integration tests
   - `*.e2e.test.ts` - End-to-end tests (separate vitest config)

6. **Workspace Protocol**:
   - Internal dependencies use `workspace:*` for local linking
   - All packages use `@octant/` namespace prefix to avoid npm conflicts

## Consequences

### Positive
- Fast builds via Turborepo caching (local and remote capable)
- Clear boundaries via workspace protocol (`workspace:*`)
- Parallel execution of independent tasks
- Simple mental model: packages = shared, apps = deployed
- Docker support via docker-compose.yml for database services

### Negative
- More initial setup than single-package
- Team must understand workspaces
- Less scaffolding than Nx
- TypeScript project references require maintenance when adding packages

## Usage

```bash
# Install
pnpm install

# Build all
pnpm build

# Dev mode
pnpm dev

# Tests (unit)
pnpm test

# Tests (e2e with database)
pnpm test:e2e

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Clean build artifacts
pnpm clean

# Clean everything (including node_modules)
pnpm clean:all

# Database operations
pnpm db:up      # Start MongoDB
pnpm db:down    # Stop MongoDB
pnpm db:reset   # Reset database
```

## Modern Standards Alignment (2026)

This section compares our implementation against current industry best practices.

### Workspace Configuration

| Practice | Our Implementation | Industry Standard | Status |
|----------|-------------------|-------------------|--------|
| Workspace protocol | `workspace:*` | `workspace:*` or `workspace:^` | Aligned |
| Package namespacing | `@octant/*` prefix | Namespace prefix recommended | Aligned |
| pnpm-workspace.yaml | `packages/*`, `apps/*` | Standard two-tier structure | Aligned |
| Catalog protocol | Not implemented | Centralized version management | Consider |

**Recommendation**: Consider adopting pnpm's catalog protocol for centralized dependency version management across packages.

### Task Orchestration

| Practice | Our Implementation | Industry Standard | Status |
|----------|-------------------|-------------------|--------|
| Topological builds | `dependsOn: ["^build"]` | `^` prefix for topological | Aligned |
| Cache outputs | `outputs: ["dist/**"]` | Explicit output declarations | Aligned |
| Non-cached tasks | Tests, dev, clean | Tests often uncached | Aligned |
| Persistent tasks | `persistent: true` for dev | Required for watch mode | Aligned |
| Environment tracking | `env: ["DATABASE_URL"]` | Track env vars for cache keys | Aligned |
| Filter syntax | Not demonstrated | `--filter='...[origin/main]'` | Available |

**Recommendation**: Document CI usage of `--filter` and `--affected` flags for optimized pipeline runs.

### Caching Strategy

| Practice | Our Implementation | Industry Standard | Status |
|----------|-------------------|-------------------|--------|
| Local caching | Default (enabled) | Always enabled | Aligned |
| Remote caching | Not configured | Vercel Remote Cache or self-hosted | Consider |
| Artifact signing | Not configured | TURBO_REMOTE_CACHE_SIGNATURE_KEY | Consider |
| Output declarations | `dist/**` | Explicit outputs required | Aligned |

**Recommendation**: For team collaboration and CI optimization, configure remote caching via Vercel or a self-hosted solution. Consider artifact signing for security.

### Package Organization

| Practice | Our Implementation | Industry Standard | Status |
|----------|-------------------|-------------------|--------|
| apps/packages split | Yes | Recommended standard | Aligned |
| Private apps | `"private": true` | Apps should be private | Aligned |
| Publishable packages | Not yet | packages/ can be published | Aligned |
| Shared tooling configs | eslint.config.js at root | Root-level shared configs | Aligned |
| Package exports | `exports` field with types | Modern resolution | Aligned |

### TypeScript Configuration

| Practice | Our Implementation | Industry Standard | Status |
|----------|-------------------|-------------------|--------|
| composite | Via tsc --build | Required for project refs | Aligned |
| declaration | Yes | Required | Aligned |
| declarationMap | Yes | Recommended for editors | Aligned |
| incremental | Implicit via --build | Recommended | Aligned |
| skipLibCheck | Yes | Recommended for performance | Aligned |
| moduleResolution | NodeNext | NodeNext or Bundler | Aligned |
| Project references | Partial (root references outdated) | Should match actual packages | Needs Update |

**Issue Found**: Root `tsconfig.json` references `packages/types`, `packages/schemas`, `apps/api`, `apps/web` but actual packages are `packages/db`, `packages/validation`, and apps include `api`, `web`, `admin`, `graphql`.

### Full Feature Development Flow Support

This monorepo structure supports a complete feature development workflow:

1. **Schema Definition**: Define types in `@octant/validation` (Zod schemas)
2. **Database Layer**: Update Prisma schema in `@octant/db`, run migrations
3. **API Development**: Implement endpoints in `@octant/api` or `@octant/graphql`
4. **Frontend Integration**: Consume APIs in `@octant/web` or `@octant/admin`
5. **Testing**: Unit tests per package, e2e tests with database
6. **Build & Deploy**: `pnpm build` for all, Docker for services

The `dependsOn: ["^build"]` ensures correct build order, while `workspace:*` ensures local changes propagate immediately without publishing.

### References

- [Turborepo Documentation](https://turborepo.dev/docs)
- [Turborepo Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Turborepo Task Configuration](https://turborepo.dev/docs/reference/configuration)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [pnpm Settings](https://pnpm.io/settings)
- [TypeScript Project References in Monorepos](https://moonrepo.dev/docs/guides/javascript/typescript-project-refs)
- [Managing TypeScript Packages in Monorepos](https://nx.dev/blog/managing-ts-packages-in-monorepos)
