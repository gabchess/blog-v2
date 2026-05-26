# Octant Monorepo

Full-stack dapp monorepo: smart contracts (Foundry), on-chain indexing (The Graph), backend APIs (REST/GraphQL/tRPC), and React frontends — all wired together with Turborepo.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22+ | Runtime |
| pnpm | 9+ | Package manager |
| Docker | Latest | Databases, Graph Node, IPFS |
| Foundry | Latest | Smart contract toolchain (anvil, forge, cast) |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd octant
pnpm install

# 2. Copy environment file
cp .env.example .env

# 3. Start databases
pnpm db:up:all

# 4. Push schemas
pnpm db:push && pnpm db:push:pg

# 5. Start development
pnpm dev
```

## Development Modes

### Full Stack (`pnpm dev`)

Starts all 9 services via Turborepo:

| Service | Port | Stack |
|---------|------|-------|
| Web App | 3000 | React + Vite + wagmi |
| Admin Dashboard | 3001 | React + Vite |
| Widget | 3002 | React + Vite |
| QF Simulator | 3003 | React + Vite |
| REST API | 4000 | Express + PostgreSQL |
| GraphQL API | 4001 | Yoga + Pothos + MongoDB |
| tRPC API | 4002 | tRPC + MongoDB |
| Anvil (chain) | 8545 | Local Ethereum node |
| Subgraph | 8000 | Graph Node + IPFS |

### Web3 Stack (`pnpm dev:web`)

The typical frontend dev workflow — starts only the chain, subgraph, and web app:

```bash
pnpm dev:web
# Equivalent to: dotenv -- turbo dev --filter @octant/chain --filter @octant/subgraph --filter @octant/web
```

This boots Anvil, deploys contracts, starts Graph Node + IPFS, deploys the subgraph, and runs the web app. No backend APIs.

### Staging (`pnpm staging`)

Indexes a live Tenderly mainnet fork instead of local Anvil:

```bash
pnpm staging
# Equivalent to: dotenv -e .env.staging -- turbo dev --filter @octant/subgraph --filter @octant/web
```

- Loads `.env.staging` (not `.env`)
- `VITE_MAINNET_RPC_URL` points to Tenderly
- `GRAPH_ETHEREUM_RPC` points Graph Node at Tenderly
- No Anvil — chain data comes from the fork
- Subgraph + web app only

Edit `.env.staging` to set your Tenderly key before running.

### Filtered Dev (pick your stack)

```bash
# REST stack only
pnpm dev --filter @octant/rest --filter @octant/widget

# GraphQL stack only
pnpm dev --filter @octant/graphql --filter @octant/admin

# tRPC stack only
pnpm dev --filter @octant/trpc --filter @octant/web
```

## Stopping Services

```bash
pnpm stop
```

This runs `scripts/stop.sh`, which:

1. **Kills node and anvil processes by port** — uses an allowlist (`node`, `anvil`) so Docker Desktop's port-forwarding proxy (`com.docker.backend`) is never touched
2. **Stops Docker containers** — runs `docker compose down` for subgraph infrastructure and database containers
3. **Leaves Docker Desktop running** — only containers are stopped, never the Docker daemon

The ports checked are read from env vars (with defaults): `REST_PORT`, `GRAPHQL_PORT`, `TRPC_PORT`, `WEB_PORT`, `ADMIN_PORT`, `WIDGET_PORT`, `QF_SIMULATOR_PORT`, `ANVIL_PORT`.

## Architecture

### Layer Diagram

```
Layer 4: Frontend Apps (React + Vite)
  apps/web (:3000)          — Wallet UI, ERC-20 interactions
  apps/admin (:3001)        — Admin dashboard
  apps/widget (:3002)       — REST API demo
  apps/qf-simulator (:3003) — Quadratic Funding simulator

Layer 3: Backend APIs
  apps/rest (:4000)         — Express + JWT (PostgreSQL)
  apps/graphql (:4001)      — Yoga + Pothos + JWT (MongoDB)
  apps/trpc (:4002)         — tRPC + JWT (MongoDB)

Layer 2: Indexing
  apps/subgraph             — Graph Node + IPFS (indexes Layer 1 events)

Layer 1: Chain
  packages/chain            — Foundry (OctantToken ERC-20, deploy scripts)
  Anvil (:8545)             — Local Ethereum node

Layer 0: Data Stores
  PostgreSQL (:5432)        — REST API data
  MongoDB (:27017)          — GraphQL + tRPC data
  Graph PostgreSQL (:5433)  — Graph Node internal store
```

### Apps

| App | Port | Stack | Database | Description |
|-----|------|-------|----------|-------------|
| `apps/web` | 3000 | React + Vite + wagmi | — | Wallet UI, ERC-20 interactions |
| `apps/admin` | 3001 | React + Vite | — | GraphQL admin dashboard |
| `apps/widget` | 3002 | React + Vite | — | REST API demo frontend |
| `apps/qf-simulator` | 3003 | React + Vite | — | Quadratic Funding simulator |
| `apps/rest` | 4000 | Express + OpenAPI | PostgreSQL | REST API with JWT auth |
| `apps/graphql` | 4001 | Yoga + Pothos | MongoDB | GraphQL API with JWT auth |
| `apps/trpc` | 4002 | tRPC | MongoDB | Type-safe RPC with JWT auth |
| `apps/subgraph` | 8000 | Graph Protocol | Graph PostgreSQL | On-chain event indexing |

### Packages

| Package | Purpose |
|---------|---------|
| `packages/chain` | Foundry project — OctantToken ERC-20, deploy scripts, Anvil dev server |
| `packages/web3` | Shared wagmi/viem config, chain definitions, contract ABIs |
| `packages/subgraph-client` | Type-safe subgraph query client (codegen from schema) |
| `packages/db` | Prisma + MongoDB (User, Session, LoginAttempt) |
| `packages/db-postgres` | Prisma + PostgreSQL (User, Session, LoginAttempt) |
| `packages/validation` | Shared Zod schemas for auth input |

## Project Structure

```
.
├── apps/
│   ├── web/              # React + wagmi wallet UI — port 3000
│   ├── admin/            # GraphQL admin dashboard — port 3001
│   ├── widget/           # REST API demo frontend — port 3002
│   ├── qf-simulator/     # Quadratic Funding simulator — port 3003
│   ├── rest/             # REST API (Express, PostgreSQL) — port 4000
│   ├── graphql/          # GraphQL API (Yoga, MongoDB) — port 4001
│   ├── trpc/             # tRPC API (MongoDB) — port 4002
│   └── subgraph/         # Graph Protocol subgraph — port 8000
├── packages/
│   ├── chain/            # Foundry project (contracts, deploy scripts)
│   ├── web3/             # Shared wagmi/viem config, ABIs
│   ├── subgraph-client/  # Type-safe subgraph query client
│   ├── db/               # Prisma + MongoDB
│   ├── db-postgres/      # Prisma + PostgreSQL
│   └── validation/       # Shared Zod schemas
├── scripts/
│   ├── init.sh           # Full environment setup
│   ├── stop.sh           # Stop dev servers + Docker containers
│   └── nuke.sh           # Complete cleanup
├── docker-compose.yml    # MongoDB + PostgreSQL
└── turbo.json            # Turborepo task config
```

## Building a New App

### New Backend API (like REST/GraphQL/tRPC)

1. Copy the closest template app: `cp -r apps/rest apps/my-api`
2. Update `apps/my-api/package.json` — change `name` to `@octant/my-api`
3. Add a port env var to `.env.example`, `.env`, and `.env.staging`:
   ```
   MY_API_PORT=4003
   ```
4. Add the port to `turbo.json` → `tasks.dev.env` array:
   ```json
   "env": ["...", "MY_API_PORT"]
   ```
5. Add the port to `scripts/stop.sh`:
   ```bash
   MY_API_PORT="${MY_API_PORT:-4003}"
   # ... and add to the kill loop
   ```
6. If a frontend needs to proxy to it, add a Vite proxy entry in the consuming app's `vite.config.ts`

### New Frontend App (like web/admin/widget)

1. Copy the closest template app: `cp -r apps/widget apps/my-app`
2. Update `apps/my-app/package.json` — change `name` to `@octant/my-app`
3. Update `apps/my-app/vite.config.ts` — change the port env var
4. Add a port env var to `.env.example`, `.env`, and `.env.staging`:
   ```
   MY_APP_PORT=3004
   ```
5. Add the port to `turbo.json` → `tasks.dev.env` array
6. Add the port to `scripts/stop.sh`

### New Shared Package (like web3/subgraph-client)

1. Create `packages/my-pkg/` with `package.json` and `tsconfig.json`
2. Set `name` to `@octant/my-pkg` in `package.json`
3. Add `"@octant/my-pkg": "workspace:*"` as a dependency in consuming apps
4. If it needs a build step, add a `build` script and ensure `turbo.json` picks it up via the existing `build` task config

## Environment Variables

The project uses a **two-file model** — each file is self-contained:

| File | Purpose | Loaded by |
|------|---------|-----------|
| `.env` | Local development | `dotenv -- turbo dev` |
| `.env.staging` | Staging (Tenderly fork) | `dotenv -e .env.staging -- turbo dev` |

No per-app env files. All vars live in the root `.env` (or `.env.staging`) and are injected into all processes by `dotenv-cli` before Turbo runs.

See `.env.example` for the full reference with documentation. Categories:

| Category | Examples |
|----------|---------|
| Databases | `DATABASE_URL`, `POSTGRES_URL` |
| Infrastructure ports | `MONGODB_PORT`, `POSTGRES_PORT`, `ANVIL_PORT` |
| Graph Node ports | `GRAPH_NODE_HTTP_PORT`, `GRAPH_NODE_WS_PORT`, `GRAPH_NODE_ADMIN_PORT`, `GRAPH_NODE_STATUS_PORT`, `GRAPH_IPFS_PORT`, `GRAPH_POSTGRES_PORT` |
| Backend API ports | `REST_PORT`, `GRAPHQL_PORT`, `TRPC_PORT` |
| Frontend ports | `WEB_PORT`, `ADMIN_PORT`, `WIDGET_PORT`, `QF_SIMULATOR_PORT` |
| Auth | `ENV`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `CORS_ORIGINS` |
| Frontend URLs (VITE_) | `VITE_MAINNET_RPC_URL`, `VITE_SUBGRAPH_URL`, `VITE_GRAPHQL_URL` |
| Subgraph | `GRAPH_ETHEREUM_RPC` |

The `env` arrays in `turbo.json` control **cache key computation**, not variable visibility — all env vars are available to all tasks regardless.

## Available Scripts

### Development

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm dev:web` | Start chain + subgraph + web app only |
| `pnpm staging` | Start subgraph + web against Tenderly fork |
| `pnpm dev --filter @octant/<app>` | Start specific app(s) |
| `pnpm dev:watch` | Dev with graceful shutdown (turbowatch) |
| `pnpm stop` | Stop all dev servers + Docker containers |

### Chain & Subgraph

| Script | Description |
|--------|-------------|
| `pnpm chain:dev` | Start Anvil + deploy contracts |
| `pnpm chain:seed` | Seed an address with tokens |
| `pnpm subgraph:dev` | Start Graph Node + deploy subgraph |
| `pnpm subgraph:up` | Start subgraph Docker containers only |
| `pnpm subgraph:down` | Stop subgraph Docker containers |

### Building

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm clean` | Remove build outputs |
| `pnpm clean:all` | Remove build outputs + node_modules |

### Database

| Script | Description |
|--------|-------------|
| `pnpm db:up` | Start MongoDB |
| `pnpm db:up:pg` | Start PostgreSQL |
| `pnpm db:up:all` | Start all databases |
| `pnpm db:down` | Stop databases |
| `pnpm db:reset` | Reset MongoDB (deletes data) |
| `pnpm db:reset:pg` | Reset PostgreSQL (deletes data) |
| `pnpm db:push` | Push MongoDB schema |
| `pnpm db:push:pg` | Push PostgreSQL schema |
| `pnpm db:generate` | Generate Prisma client (MongoDB) |
| `pnpm db:generate:pg` | Generate Prisma client (PostgreSQL) |
| `pnpm db:studio` | Open Prisma Studio (MongoDB) |
| `pnpm db:studio:pg` | Open Prisma Studio (PostgreSQL) |

### Testing

| Script | Description |
|--------|-------------|
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm test:db` | E2E tests with DB setup |
| `pnpm test:all` | All tests |

## Running Tests

Tests are **self-contained** — they start their own server instances. No need for `pnpm dev`.

```bash
# Run all unit tests
pnpm test

# Run E2E tests (requires databases running)
pnpm db:up:all
pnpm db:push && pnpm db:push:pg

pnpm --filter @octant/rest test:e2e
pnpm --filter @octant/graphql test:e2e
pnpm --filter @octant/trpc test:e2e
```

## Authentication

All backend APIs implement the same auth flow:

### Security Features

- **JWT Access Tokens**: 15-minute expiry, HS256
- **Refresh Token Rotation**: New token on each refresh
- **Token Reuse Detection**: Entire family revoked if old token reused
- **Rate Limiting**: 5 login attempts per 15 min per email
- **Account Lockout**: 10 failed attempts locks for 15 minutes
- **Password Policy**: 12-64 characters

### REST API Examples

```bash
# Sign up
curl -X POST http://localhost:4000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","password":"securePassword123!"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securePassword123!"}'

# Get current user
curl http://localhost:4000/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

### GraphQL Examples

```graphql
# Sign up
mutation {
  signup(input: {
    email: "test@example.com"
    name: "Test User"
    password: "securePassword123!"
  }) {
    accessToken
    user { id email name }
  }
}

# Login
mutation {
  login(input: {
    email: "test@example.com"
    password: "securePassword123!"
  }) {
    accessToken
    user { id email name }
  }
}

# Get current user (add header: Authorization: Bearer <accessToken>)
query {
  me { id email name createdAt }
}
```

## How Turborepo Works

### Configuration (`turbo.json`)

```json
{
  "globalDependencies": [".env", ".env.staging"],
  "globalEnv": ["DATABASE_URL", "POSTGRES_URL", "JWT_SECRET", "..."],
  "tasks": {
    "build": {
      "dependsOn": ["^build", "db:generate"],
      "outputs": ["dist/**"],
      "inputs": ["src/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false,
      "dependsOn": ["^build", "^db:generate"]
    }
  }
}
```

### Key Concepts

| Concept | Syntax | Meaning |
|---------|--------|---------|
| Topological dependency | `^build` | Run in dependencies first |
| Same-package dependency | `db:generate` | Run in same package first |
| Persistent task | `persistent: true` | Long-running (doesn't block) |
| No caching | `cache: false` | Always execute |
| Package-specific task | `@octant/rest#build` | Override for specific package |

### Environment Variables in Turbo

Turbo doesn't auto-load `.env` files. This project uses `dotenv-cli`:

```json
{
  "scripts": {
    "dev": "dotenv -- turbo dev",
    "staging": "dotenv -e .env.staging -- turbo dev ..."
  }
}
```

`dotenv-cli` injects vars into `process.env` before Turbo runs. Turbo inherits all vars and passes them to every child process. The `env` arrays in `turbo.json` only control cache key computation — they don't filter variable visibility.

### Filtering

```bash
# Single package
pnpm dev --filter @octant/rest

# Multiple packages
pnpm dev --filter @octant/rest --filter @octant/widget

# All packages matching pattern
pnpm build --filter "@octant/*"

# Package and its dependencies
pnpm build --filter @octant/rest...
```

## Troubleshooting

### "Cannot connect to database"

```bash
# Check Docker is running
docker ps

# Start databases
pnpm db:up:all

# Check logs
docker compose logs postgres
docker compose logs mongodb
```

### "Port already in use" (EADDRINUSE)

```bash
# Stop all dev servers and Docker containers
pnpm stop
```

If `pnpm stop` doesn't resolve it, check for zombie processes:

```bash
pkill -f "octant.*tsx"
pkill -f "octant.*vite"
```

> **Note:** Never use `lsof -ti :PORT | xargs kill` — this kills *any* process on that port, including Docker Desktop's port-forwarding proxy (`com.docker.backend`), which crashes Docker Desktop.

### "Environment variable not found"

The project uses `dotenv-cli` to load `.env` before Turbo runs. All `package.json` scripts are prefixed with `dotenv --`. If running Turbo directly:

```bash
dotenv -- turbo dev --filter @octant/rest
```

### "Prisma client not generated"

```bash
pnpm db:generate     # MongoDB
pnpm db:generate:pg  # PostgreSQL
pnpm build
```

## Tech Stack

- **Runtime**: Node.js 22+
- **Package Manager**: pnpm 9+
- **Build System**: Turborepo
- **Smart Contracts**: Foundry (Solidity)
- **Indexing**: The Graph Protocol
- **Databases**: PostgreSQL (REST), MongoDB (GraphQL/tRPC)
- **ORM**: Prisma
- **Web3**: wagmi + viem
- **APIs**: Express + OpenAPI, GraphQL Yoga + Pothos, tRPC
- **Frontend**: React 19 + Vite
- **Validation**: Zod
- **Testing**: Vitest

## License

Private - All rights reserved.
