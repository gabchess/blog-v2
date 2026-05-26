# ADR-502: Local Development Bootstrap

## Status
Accepted

## Context

The full Octant stack spans multiple layers: smart contracts (Foundry), on-chain indexing (Graph Protocol), backend APIs (REST/GraphQL/tRPC), and frontend dapps (React/Vite). Developers need a clear, repeatable way to bring up the stack for local development and understand how the pieces connect.

This ADR documents the boot sequence, inter-service dependencies, and how to verify each layer.

## Decision

### Layer Architecture

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
  packages/chain            — Foundry (OctantToken ERC-20)
  Anvil (:8545)             — Local Ethereum node

Layer 0: Data Stores
  PostgreSQL (:5432)        — REST API data
  MongoDB (:27017)          — GraphQL + tRPC data
  Graph PostgreSQL (:5433)  — Graph Node internal store
```

### Boot Sequence

#### Quick Start (web3 frontend only)

For frontend development against local Anvil (no backend APIs):

```bash
# 1. Install dependencies
pnpm install

# 2. Start chain + subgraph + web app
pnpm dev:web
```

This single command boots Anvil, deploys contracts, starts Graph Node + IPFS, deploys the subgraph, and runs the web app. Open `http://localhost:3000`. Connect MetaMask to `localhost:8545` (Chain ID 31337).

#### Full Stack

```bash
# 1. Start databases
pnpm db:up:all           # PostgreSQL + MongoDB via Docker

# 2. Push schemas
pnpm db:push             # MongoDB (Prisma)
pnpm db:push:pg          # PostgreSQL (Prisma)

# 3. Start everything
pnpm dev                 # All apps via Turborepo (includes chain + subgraph)
```

#### Staging (Tenderly fork)

```bash
# 1. Set your Tenderly key in .env.staging
# 2. Start databases (if using backend APIs)
pnpm db:up:all

# 3. Start subgraph + web against Tenderly fork
pnpm staging
```

This loads `.env.staging`, points Graph Node at Tenderly's mainnet fork RPC, and starts only the subgraph + web app. No local Anvil is needed.

### Port Map

| Service | Port | Protocol |
|---------|------|----------|
| Anvil | 8545 | JSON-RPC |
| Web App | 3000 | HTTP |
| Admin Dashboard | 3001 | HTTP |
| Widget | 3002 | HTTP |
| QF Simulator | 3003 | HTTP |
| REST API | 4000 | HTTP |
| GraphQL API | 4001 | HTTP |
| tRPC API | 4002 | HTTP |
| PostgreSQL | 5432 | TCP |
| MongoDB | 27017 | TCP |
| Graph Node (queries) | 8000 | HTTP |
| Graph Node (WebSocket) | 8001 | WebSocket |
| Graph Node (admin) | 8020 | HTTP |
| Graph Node (status) | 8030 | HTTP |
| IPFS | 5001 | HTTP |
| Graph PostgreSQL | 5433 | TCP |

All ports are configurable via env vars in `.env`. See `.env.example` for documentation.

### Environment Variables

All env vars live in the root `.env` (or `.env.staging` for staging mode). No per-app env files.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MongoDB connection string |
| `POSTGRES_URL` | PostgreSQL connection string |
| `VITE_MAINNET_RPC_URL` | RPC endpoint for mainnet chain reads (defaults to local Anvil) |
| `VITE_SUBGRAPH_URL` | Subgraph GraphQL endpoint |
| `GRAPH_ETHEREUM_RPC` | Graph Node's Ethereum RPC connection |
| `FORK_RPC_URL` | Tenderly fork URL for mainnet fork testing |

See ADR-504 for the full env var management strategy and the two-file model.

### Connecting the Dapp to a Safe

**Mode 1: Safe App iframe (production flow)**
```bash
# Start with CORS headers for Safe iframe embedding
pnpm dev --filter @octant/web

# In Safe UI:
# 1. Go to app.safe.global
# 2. Apps --> Custom App --> http://localhost:3000
# 3. App auto-connects via Safe Apps SDK
```

The `safeAppCors()` Vite plugin adds `Access-Control-Allow-Private-Network: true` headers required by Chrome's Private Network Access policy for the iframe to reach localhost.

**Mode 2: Standalone Safe via URL parameter**
```bash
pnpm dev --filter @octant/web

# Open with Safe address parameter:
# http://localhost:3000?safe=0xYOUR_SAFE_ADDRESS
#
# Click "Connect Safe (Protocol Kit)" --> MetaMask popup
# Signer must be an owner of the Safe
```

**Mode 3: Standard EOA wallet**
```bash
pnpm dev --filter @octant/web

# Open http://localhost:3000 (no ?safe= param)
# Click "Connect MetaMask Wallet"
```

### Verification Checklist

After boot, verify each layer:

```bash
# Layer 0: Data stores
docker ps                               # PostgreSQL + MongoDB running
curl http://localhost:8545 -X POST \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'  # Anvil

# Layer 1: Contracts
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "name()(string)" --rpc-url http://127.0.0.1:8545      # "OctantToken"

# Layer 3: APIs
curl http://localhost:4000/health        # REST API

# Layer 4: Frontend
curl -s http://localhost:3000 | head -5  # HTML response
curl http://localhost:3000/manifest.json # Safe App manifest (200 OK)
```

### Stopping Everything

```bash
pnpm stop
```

This runs `scripts/stop.sh`, which:

1. Kills `node` and `anvil` processes by port (allowlist-based — Docker Desktop is never touched)
2. Stops subgraph Docker containers (`docker compose down` on `apps/subgraph/docker-compose.yml`)
3. Stops database Docker containers (`docker compose down` on root `docker-compose.yml`)

See ADR-504 for why the stop script uses an allowlist instead of `lsof | xargs kill`.

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE` on any port | Zombie process from previous session | `pnpm stop` |
| "Safe SDK timeout" in console | Not running inside Safe iframe | Expected behavior; `useAutoConnect` handles this |
| "Signer is not an owner" | MetaMask account is not a Safe owner | Switch MetaMask to an owner account |
| "No injected wallet found" | MetaMask not installed | Install MetaMask browser extension |
| Env vars not loaded by Turbo | Turbo doesn't auto-load `.env` | Scripts use `dotenv --` prefix (already configured) |

## Consequences

### Positive
- Clear layer-by-layer boot order eliminates guesswork
- `pnpm dev:web` gives frontend devs a single-command workflow
- `pnpm staging` enables testing against real mainnet data via Tenderly
- `pnpm stop` safely tears down everything without crashing Docker Desktop
- Frontend can develop against Anvil without backend APIs
- Verification checklist catches broken layers early
- All three Safe modes documented with exact commands

### Negative
- Full stack requires Docker, Foundry, and Node.js toolchains
- Subgraph layer adds significant infrastructure complexity (Graph Node + IPFS + separate PostgreSQL)

## References

- ADR-000: Turborepo Monorepo Template (workspace structure)
- ADR-500: Web3 Package Architecture (chain config, contracts)
- ADR-501: Safe Dual-Mode Integration (connector details)
- ADR-504: Env Var and Service Management (two-file model, stop script)
- [Foundry Book](https://book.getfoundry.sh/)
- [The Graph: Local Development](https://thegraph.com/docs/en/developing/creating-a-subgraph/)
