# ADR-504: Environment Variable and Service Management

## Status
Accepted

## Context

As the monorepo grew from 3 backend APIs to include chain (Foundry/Anvil), subgraph (Graph Node), and web3 packages, several pain points emerged:

1. **Scattered env files.** Early development used per-app `.env` files (`apps/web/.env.local`, `packages/db/.env`, etc.). This made it hard to know which file to edit, caused inconsistencies between apps, and broke Turbo's cache invalidation since `globalDependencies` couldn't track per-app env files.

2. **Turbo doesn't load `.env` files.** Turbo passes env vars from the parent shell to child processes but never reads `.env` files itself. Without `dotenv-cli`, env vars were missing at runtime.

3. **`lsof | xargs kill` crashes Docker Desktop.** The original stop script used `lsof -ti :PORT | xargs kill` to kill processes by port. This kills *any* process listening on that port, including Docker Desktop's port-forwarding proxy (`com.docker.backend`). Killing that process crashes Docker Desktop entirely, requiring a restart.

4. **No staging workflow.** Frontend devs needed to test against live mainnet data (via Tenderly fork) but had no way to swap RPC endpoints without manually editing `.env`.

## Decision

### Two-File Model

All env vars live in exactly one of two root files:

| File | Purpose | Loaded by |
|------|---------|-----------|
| `.env` | Local development (Anvil, local databases) | `dotenv -- turbo dev` |
| `.env.staging` | Staging (Tenderly fork, same local databases) | `dotenv -e .env.staging -- turbo dev` |

Each file is **self-contained** — no cascading, no composition, no per-app overrides. A developer copies `.env.example` to `.env` once and never needs app-specific env files.

### How dotenv-cli + Turbo Works

```
pnpm dev
  → dotenv -- turbo dev           # dotenv-cli reads .env, injects into process.env
    → turbo inherits process.env  # passes all vars to every child task
      → tsx watch src/index.ts    # app reads process.env.REST_PORT, etc.

pnpm staging
  → dotenv -e .env.staging -- turbo dev --filter ...
    → same mechanism, different file
```

The `env` arrays in `turbo.json` tasks control **cache key computation only** — they tell Turbo which env vars should invalidate the build cache. They do NOT filter which vars are visible to child processes. All vars from `dotenv-cli` are available to all tasks.

### Allowlist-Based Stop Script

`scripts/stop.sh` kills dev processes safely:

```bash
# For each port, find listening PIDs, but only kill if the process is node or anvil
kill_dev_process() {
  local port=$1
  local pids=$(lsof -i :"$port" -t -sTCP:LISTEN 2>/dev/null)
  for pid in $pids; do
    local cmd=$(ps -p "$pid" -o comm= 2>/dev/null)
    case "$cmd" in
      node|anvil)  # allowlist — never kills com.docker.backend
        kill "$pid" 2>/dev/null ;;
    esac
  done
}
```

After killing native processes, the script runs `docker compose down` for:
1. `apps/subgraph/docker-compose.yml` (Graph Node, IPFS, Graph PostgreSQL)
2. Root `docker-compose.yml` (MongoDB, PostgreSQL)

Docker Desktop itself is never touched.

### turbo.json env Arrays

The `env` arrays serve two purposes:
1. **Cache invalidation** — if `REST_PORT` changes, Turbo re-runs the `dev` task instead of serving a stale cache hit (though `dev` has `cache: false`, so this is defensive)
2. **Documentation** — the arrays act as a manifest of which env vars each task cares about

They are NOT access control. A task with `env: ["REST_PORT"]` can still read `DATABASE_URL` — it just won't affect cache keys for that task.

## How to Extend

### Adding a New Env Var

1. **Document it** in `.env.example` with a comment explaining purpose, consumers, and defaults
2. **Add the value** to `.env` (and `.env.staging` if the staging value differs)
3. **If cache-relevant**, add to the appropriate `turbo.json` task's `env` array
4. **If global**, add to `turbo.json` → `globalEnv` array

### Adding a New Service (app or package)

1. **Add a port env var** to `.env.example`, `.env`, and `.env.staging`
2. **Add the port** to `turbo.json` → `tasks.dev.env` array (or create a package-specific task override like `@octant/chain#dev`)
3. **Add the port** to `scripts/stop.sh`:
   - Define the variable with a default: `MY_PORT="${MY_PORT:-XXXX}"`
   - Add it to the appropriate kill loop
4. **If the process name isn't `node` or `anvil`**, add it to the `case` allowlist in `kill_dev_process()`

### Adding a New Docker Service

1. **If it's subgraph-related**, add to `apps/subgraph/docker-compose.yml` — the stop script already runs `docker compose down` on that file
2. **If it's a new database**, add to root `docker-compose.yml` — the stop script already runs `docker compose down` on that file
3. **If it's a new category** (neither subgraph nor database), add a new `docker compose -f ... down` block to `scripts/stop.sh`
4. **Expose host ports** via env vars in `.env.example` so they're configurable

## Consequences

### Positive
- Single env file per mode — no hunting through per-app files
- `dotenv-cli` is a thin, well-understood shim with no magic
- Stop script can't crash Docker Desktop (allowlist prevents it)
- Adding a new service follows a clear 4-step checklist
- `.env.example` serves as the canonical env var reference

### Negative
- Every service's vars are visible to every other service (no isolation)
- Two files (`.env` + `.env.staging`) must be kept in sync for shared vars like ports
- `.env.example` is the only documentation — if it gets stale, developers are lost

## References

- ADR-502: Local Development Bootstrap (boot sequence, verification)
- [dotenv-cli](https://github.com/entropitor/dotenv-cli)
- [Turborepo Environment Variables](https://turbo.build/repo/docs/crafting-your-repository/using-environment-variables)
