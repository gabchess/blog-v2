# CLAUDE.md

Project-specific guidance for Claude Code when working with this codebase.

## Project Overview

This is a Turborepo monorepo — full-stack dapp with smart contracts, on-chain indexing, backend APIs, and React frontends.

**Frontend Apps:**
- **Web App** (`apps/web`) - React 19 + Vite + wagmi - `$WEB_PORT` (default 3000)
- **Admin Dashboard** (`apps/admin`) - React 19 + Vite - `$ADMIN_PORT` (default 3001)
- **Widget** (`apps/widget`) - REST API demo app - `$WIDGET_PORT` (default 3002)
- **QF Simulator** (`apps/qf-simulator`) - Quadratic Funding demo - `$QF_SIMULATOR_PORT` (default 3003)

**Backend APIs:**
- **REST API** (`apps/rest`) - Express + JWT auth (PostgreSQL) - `$REST_PORT` (default 4000)
- **GraphQL API** (`apps/graphql`) - Yoga + Pothos with JWT auth (MongoDB) - `$GRAPHQL_PORT` (default 4001)
- **tRPC API** (`apps/trpc`) - Type-safe RPC (MongoDB) - `$TRPC_PORT` (default 4002)

**Chain & Indexing:**
- **Chain** (`packages/chain`) - Foundry project (OctantToken ERC-20, Anvil) - `$ANVIL_PORT` (default 8545)
- **Subgraph** (`apps/subgraph`) - Graph Node + IPFS (indexes on-chain events) - `$GRAPH_NODE_HTTP_PORT` (default 8000)

**Shared Packages:**
- **Web3** (`packages/web3`) - Shared wagmi/viem config, chain definitions, contract ABIs
- **Subgraph Client** (`packages/subgraph-client`) - Type-safe subgraph query client
- **Database** (`packages/db`) - Prisma with MongoDB
- **Database Postgres** (`packages/db-postgres`) - Prisma with PostgreSQL
- **Validation** (`packages/validation`) - Shared Zod schemas

## Quick Commands

```bash
# Development modes
pnpm dev                # Start all 9 services
pnpm dev:web            # Chain + subgraph + web app only (typical frontend workflow)
pnpm staging            # Subgraph + web against Tenderly fork (.env.staging)
pnpm dev --filter @octant/rest --filter @octant/widget  # Specific apps

# Chain & subgraph
pnpm chain:dev          # Start Anvil + deploy contracts
pnpm chain:seed         # Seed an address with tokens
pnpm subgraph:dev       # Start Graph Node + deploy subgraph
pnpm subgraph:up        # Start subgraph Docker containers only
pnpm subgraph:down      # Stop subgraph Docker containers

# Database operations
pnpm db:up:all          # Start all databases
pnpm db:push            # Push MongoDB schema
pnpm db:push:pg         # Push PostgreSQL schema
pnpm db:studio          # Open Prisma Studio GUI
pnpm db:reset           # Reset database (deletes all data)

# Stop services
pnpm stop               # Stop dev servers + Docker containers (Docker Desktop safe)

# Testing
pnpm test               # Unit tests
pnpm test:db            # E2E tests with database

# Build and checks
pnpm build
pnpm typecheck
pnpm lint
```

## Dev Workflow: Spin Up and Down

### Port Assignments

All ports are configurable via environment variables in `.env` (see `.env.example` for docs).

| App | Env Var | Default | Database |
|-----|---------|---------|----------|
| REST API | `REST_PORT` | 4000 | PostgreSQL |
| GraphQL API | `GRAPHQL_PORT` | 4001 | MongoDB |
| tRPC API | `TRPC_PORT` | 4002 | MongoDB |
| Web | `WEB_PORT` | 3000 | - |
| Admin | `ADMIN_PORT` | 3001 | - |
| Widget | `WIDGET_PORT` | 3002 | - |
| QF Simulator | `QF_SIMULATOR_PORT` | 3003 | - |

**Infrastructure:**

| Service | Env Var | Default |
|---------|---------|---------|
| MongoDB | `MONGODB_PORT` | 27017 |
| PostgreSQL | `POSTGRES_PORT` | 5432 |
| Anvil | `ANVIL_PORT` | 8545 |
| Graph Node HTTP | `GRAPH_NODE_HTTP_PORT` | 8000 |
| Graph Node WS | `GRAPH_NODE_WS_PORT` | 8001 |
| Graph Node Admin | `GRAPH_NODE_ADMIN_PORT` | 8020 |
| Graph Node Status | `GRAPH_NODE_STATUS_PORT` | 8030 |
| IPFS | `GRAPH_IPFS_PORT` | 5001 |
| Graph PostgreSQL | `GRAPH_POSTGRES_PORT` | 5433 |

### Starting Services

**Option 1: Turbo with filters (recommended)**
```bash
# Start specific apps - turbo handles dependencies automatically
pnpm dev --filter @octant/rest --filter @octant/widget

# Start all services
pnpm dev
```

**Option 2: Turbowatch (graceful shutdown)**
```bash
# Starts all services with proper signal handling
pnpm dev:watch

# Ctrl+C to stop - sends SIGTERM to all child processes
```

### Stopping Services

```bash
# Stop all dev servers + Docker containers (Docker Desktop safe)
pnpm stop
```

### Database Setup

```bash
# REST API requires PostgreSQL
docker compose up -d postgres
pnpm db:push:pg

# GraphQL/tRPC require MongoDB
docker compose up -d mongodb
pnpm db:push
```

### Common Issues and Fixes

**Port already in use (EADDRINUSE)**

Root cause: Zombie `tsx watch` processes from previous sessions that weren't terminated properly. This happens when:
- Dev server crashes without cleanup
- Terminal closed without stopping servers
- Background processes left running

Fix:
```bash
# Stop all dev servers + Docker containers
pnpm stop

# If pnpm stop doesn't resolve it, kill zombie processes:
pkill -f "octant.*tsx"
pkill -f "octant.*vite"
```

> **Never** use `lsof -ti :PORT | xargs kill` — it kills Docker Desktop's port-forwarding proxy and crashes Docker.

**Environment variables not found**

Root cause: Turbo doesn't auto-load `.env` files. The project uses a centralized two-file model:

- `.env` — self-contained dev config (all ports, databases, RPC, auth)
- `.env.staging` — self-contained staging config (all ports, databases, Tenderly RPC, subgraph)

No app-specific env files. All ports, URLs, and connection strings are defined in root `.env` and consumed via `process.env` throughout. All turbo commands are prefixed with `dotenv --` in package.json scripts. If you run turbo directly, prefix with:
```bash
dotenv -- turbo dev --filter @octant/rest
```

**Database connection errors**

Ensure Docker is running and databases are started:
```bash
# Check Docker status
docker ps

# Start required databases
pnpm db:up:all

# Push schemas
pnpm db:push && pnpm db:push:pg
```

### Verification Workflow

After starting services, verify they're running (ports from `.env`):
```bash
# Check ports are listening
lsof -i :$REST_PORT   # REST (default 4000)
lsof -i :$WIDGET_PORT # Widget (default 3002)

# Health check
curl http://localhost:$REST_PORT/health
curl http://localhost:$WIDGET_PORT  # Should return HTML
```

## Architecture Notes

### Authentication Flow

1. **Signup/Login** returns `accessToken` (JWT, 15min) + `refreshToken` (UUID, 7 days)
2. **Access tokens** are stateless JWTs verified on each request
3. **Refresh tokens** are stored as SHA-256 hashes with token family tracking
4. **Token rotation** on refresh - old token invalidated, new token issued
5. **Reuse detection** - if old token is reused, entire family is revoked

### Key Files for Auth

- `apps/rest/src/routes/auth.ts` - REST auth endpoints
- `apps/rest/src/config/auth.ts` - REST auth configuration
- `apps/graphql/src/config/auth.ts` - GraphQL auth configuration
- `apps/graphql/src/schema/mutations/auth.ts` - GraphQL auth mutations
- `packages/db/prisma/schema.prisma` - MongoDB: User, Session, LoginAttempt models
- `packages/db-postgres/prisma/schema.prisma` - PostgreSQL: User, Session, LoginAttempt models
- `packages/validation/src/index.ts` - Zod schemas for auth input

### Database Schema

```
User
├── id, email, name, passwordHash
├── createdAt, updatedAt
└── sessions[] (one-to-many)

Session
├── id, userId, tokenHash (SHA-256)
├── tokenFamily (for reuse detection)
├── previousTokenHash (tracks rotated tokens)
├── expiresAt, createdAt, lastUsedAt
└── ipAddress, userAgent

LoginAttempt
├── id, email, ipAddress
├── success (boolean)
└── createdAt (indexed for rate limiting)
```

## Code Style

- TypeScript with strict mode
- ESLint 9 flat config
- Functional style preferred (avoid classes)
- Zod for runtime validation
- Pothos for type-safe GraphQL schema

## Testing Strategy

- **Unit tests**: `*.test.ts` - Test pure functions, schemas
- **E2E tests**: `*.e2e.test.ts` - Test full request/response with database
- E2E tests use separate `octant_test` database (set via `DATABASE_URL` in vitest config)

### Running E2E Tests

E2E tests are **self-contained** - they start their own server instance. No need for `pnpm dev`.

```bash
# Run REST E2E tests (starts its own server on port 14000)
pnpm --filter @octant/rest test:e2e

# Run GraphQL E2E tests (uses in-process Yoga server)
pnpm --filter @octant/graphql test:e2e

# Run tRPC E2E tests (starts its own server on port 14002)
pnpm --filter @octant/trpc test:e2e
```

### Test Architecture (Industry Best Practice)

Tests create their own server instances in `beforeAll`:

```typescript
// Pattern used by REST, tRPC tests
beforeAll(async () => {
  const app = createApp();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => resolve());
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await prisma.$disconnect();
});
```

**Benefits:**
- No false positives (server and tests share same database)
- No false negatives (tests don't depend on external state)
- Complete test isolation
- No `pnpm dev` required

## Common Tasks

### Adding a New GraphQL Mutation

1. Create/update schema in `apps/graphql/src/schema/mutations/`
2. Add Zod validation schema in `packages/validation/src/index.ts`
3. Export from `apps/graphql/src/schema/index.ts`
4. Add tests in `apps/graphql/src/graphql.e2e.test.ts`

### Adding a New REST Endpoint

1. Create a new Express router in `apps/rest/src/routes/<name>.ts`
2. Mount it in `apps/rest/src/app.ts` via `app.use('/<path>', myRouter)`
3. Validate input with Zod schemas from `@octant/validation`

### Modifying Database Schema

1. Edit `packages/db/prisma/schema.prisma`
2. Run `pnpm db:push` to sync schema
3. Run `pnpm db:generate` to regenerate client
4. Run `pnpm build` to rebuild dependent packages

## Security Checklist

When modifying auth code, verify:
- [ ] Passwords hashed with bcrypt (12 rounds)
- [ ] Tokens hashed before database storage
- [ ] Rate limiting on auth endpoints
- [ ] No sensitive data in JWT payload
- [ ] Error messages don't leak user existence
- [ ] GraphQL introspection disabled in production

## Skills

Use the Skill tool to invoke skills. Skills provide specialized automation for common tasks.

### Browser Testing with agent-browser

Use for E2E testing, form filling, screenshots, and UI verification.

```
/agent-browser
```

**Core workflow:**
```bash
agent-browser open http://localhost:3002    # Navigate to page
agent-browser snapshot -i                   # Get interactive elements with @refs
agent-browser click @e1                     # Click element by ref
agent-browser fill @e2 "text"               # Fill input by ref
agent-browser get text @e1                  # Read element text
agent-browser screenshot path.png           # Capture screenshot
agent-browser close                         # Close browser
```

**When to use:**
- Verifying auth flows (signup → login → logout)
- Testing form submissions
- Checking UI state after interactions
- Capturing screenshots for documentation

### Visual Review Workflow (IMPORTANT)

When doing UI/UX review or after implementing frontend changes:

1. **Capture screenshots** at each major step of the user flow
2. **View each screenshot** using the Read tool to inspect visually
3. **Identify visual issues:**
   - Inconsistent spacing/alignment
   - Mismatched colors or styling
   - Poor form layouts (horizontal when should be vertical)
   - Missing feedback states (loading, error, success)
   - Accessibility issues (contrast, focus states)
4. **Fix issues** one by one, re-testing with agent-browser after each fix
5. **Use frontend-design skill** for complex redesigns: `/frontend-design:frontend-design`

**Common visual issues to check:**
- Form inputs: consistent dark theme styling, proper autocomplete attributes
- Buttons: consistent primary/secondary styling, hover states
- Headers: proper spacing between elements, clear hierarchy
- Lists: show all relevant data (e.g., project descriptions not just names)
- Loading states: spinners or indicators for async operations
- Error states: clear error messages, dismissible errors

**Flexbox/CSS consistency checks (CRITICAL):**
- All form fields should be the same width (check for global `max-width` overrides)
- Use `max-width: none` and `flex: 1 1 auto` to override restrictive base styles
- Use `align-items: stretch` for full-width children in flex containers
- Check that `width: 100%` is actually working (global styles may override)
- Verify each field visually - don't assume CSS is correct, test with screenshot
- When fixing CSS: always re-capture screenshot to verify the fix worked

**Screenshot review pattern:**
```bash
# After each UI change, verify visually:
agent-browser screenshot screenshots/step-name.png
# Then use Read tool to view and inspect the screenshot
# Compare field widths, alignments, colors visually
# If anything looks off, investigate the CSS cascade
```

**CSS debugging checklist:**
1. Check for global styles that might override (grep for `max-width`, `width`)
2. Use browser DevTools via agent-browser if needed
3. Add more specific selectors or `max-width: none` to override
4. Always verify fix with new screenshot before committing

### UI Code Review with web-design-guidelines

Use when implementing or reviewing frontend React components.

```
/web-design-guidelines <file-or-pattern>
```

**When to use:**
- After implementing new React components
- Reviewing UI accessibility
- Checking design best practices
- Auditing existing frontend code

**Example:**
```
/web-design-guidelines apps/widget/src/features/auth/LoginForm.tsx
```

### React Performance with vercel-react-best-practices

Use when writing or optimizing React/Next.js code.

**When to use:**
- Writing new React components
- Implementing data fetching
- Reviewing code for performance issues
- Optimizing bundle size

**Key rules to remember:**
- `async-parallel` - Use Promise.all() for independent operations
- `bundle-barrel-imports` - Import directly, avoid barrel files
- `bundle-dynamic-imports` - Use next/dynamic for heavy components
- `rerender-memo` - Memoize expensive computations

### Frontend Implementation Workflow

When implementing frontend features, follow this workflow:

1. **Implement** - Write the React component
2. **Type check** - `pnpm typecheck --filter @octant/<app>`
3. **Review** - `/web-design-guidelines <component-file>`
4. **Test** - `/agent-browser` to verify UI behavior
5. **Visual Review** - Capture and inspect screenshots for visual inconsistencies:
   - Take screenshot at each step
   - View screenshot with Read tool
   - Check for spacing, alignment, color consistency
   - Fix any visual issues before proceeding
6. **Iterate** - After each fix, re-test with agent-browser to verify
7. **Commit** - After all visual and functional checks pass
