# Web App

React web application for Octant, built with Vite and TypeScript. Connects to Ethereum wallets and Safe multisig wallets for ERC-20 token interactions.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server with HMR on `$WEB_PORT` (default 3000) |
| `pnpm build` | Type-check and build for production |
| `pnpm preview` | Preview production build locally |
| `pnpm test` | Run tests with Vitest |
| `pnpm lint` | Lint source files with ESLint |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm clean` | Remove dist, .turbo, and build artifacts |

## Development (local)

The web app is part of the full local dev stack. From the monorepo root:

```bash
pnpm dev:web
```

This starts three services via turbo:

1. **`@octant/chain`** — local anvil (chain ID 31337), deploys OCT token, seeds events
2. **`@octant/subgraph`** — Graph Node indexing from local anvil
3. **`@octant/web`** — Vite dev server on `$WEB_PORT`

The app connects to local anvil via the default `anvilLocal` chain transport (`http://127.0.0.1:8545`). USDC components are hidden (USDC doesn't exist on local anvil). OCT balance, transfers, and transfer history are shown.

### Verify

```bash
curl http://localhost:$WEB_PORT   # Should return HTML (default 3000)
```

## Staging (Tenderly fork)

Staging points the web app at a Tenderly mainnet fork (chain ID 1) instead of local anvil. From the monorepo root:

```bash
# 1. Create .env.staging with your Tenderly RPC key
cp .env.staging .env.staging.local  # edit with your key

# 2. Start staging (subgraph + web only — no local anvil)
pnpm staging
```

This starts two services:

1. **`@octant/subgraph`** — Graph Node indexing from the Tenderly fork RPC
2. **`@octant/web`** — Vite dev server on `$WEB_PORT`

The app detects chain ID 1 (mainnet/fork) and shows USDC balance + approve components alongside OCT. The subgraph indexes events from the fork instead of local anvil.

### Chain-aware UI

The `WalletConnection` component conditionally renders features based on the connected chain:

| Chain | USDC (balance + approve) | OCT (balance + transfer) | Transfer History |
|-------|--------------------------|--------------------------|------------------|
| Mainnet / fork (ID 1) | Shown | Shown | Shown |
| Local anvil (ID 31337) | Hidden | Shown | Shown |

### Prerequisites

- A Tenderly mainnet fork RPC URL
- Contracts deployed on the fork (via Tenderly dashboard or scripts)
- `apps/subgraph/networks.json` with the fork's contract address and start block

## Project Structure

```
src/
  main.tsx                      # Entry point — configures subgraph URL, reads ?safe= param
  App.tsx                       # Root component
  App.test.tsx                  # Component tests
  vite-env.d.ts                 # Vite environment type definitions
  components/
    WalletConnection.tsx        # Wallet connect/disconnect, chain-aware USDC/OCT rendering
    OctBalance.tsx              # OCT token balance display
    TransferOct.tsx             # OCT token transfer form
    TransferHistory.tsx         # Recent transfers table (from subgraph)
public/
  manifest.json                 # Safe App manifest (for iframe embedding)
  logo.svg                      # Safe App icon
```

## Wallet Modes

The app supports three wallet connection modes. **The UI is the same in all three** — the same components, hooks, and contract interactions work regardless of how the wallet connected. The difference is only in the connection step.

### How it works

Once connected, every wagmi hook (`useAccount`, `useReadContract`, `useWriteContract`) behaves identically no matter which mode is active. Components call `writeContract(...)` and don't know whether the transaction goes through MetaMask directly, gets routed through Safe Protocol Kit, or gets sent via postMessage to the Safe UI.

This is possible because `@octant/web3` provides an EIP-1193 provider wrapper that intercepts transaction methods and reroutes them through the appropriate backend. From wagmi's perspective, it's just a standard provider.

### Mode 1: Standard wallet (default)

```
http://localhost:3000
```

User sees injected wallet buttons ("Connect MetaMask"). Clicking connects directly to the browser wallet. Transactions are signed by the EOA.

### Mode 2: Safe multisig via URL parameter

```
http://localhost:3000?safe=0xYourSafeAddress
```

An additional "Connect Safe (Protocol Kit)" button appears alongside the injected wallet buttons. Clicking it triggers a MetaMask popup to identify the signer, then initializes Safe Protocol Kit. The signer must be an owner of the Safe.

Once connected, the displayed address is the **Safe address** (not the signer). Transactions are created as Safe multisig transactions:
- If the Safe threshold is 1 and the signer's signature is sufficient, the transaction executes on-chain immediately.
- If more signatures are needed, the transaction is proposed to the Safe Transaction Service for other owners to confirm.

A green **(Safe Multisig)** badge appears next to the address.

### Mode 3: Safe App iframe

```
app.safe.global → Apps → Custom App → http://localhost:3000
```

No buttons are shown — the app auto-connects silently via the Safe Apps SDK. The Safe UI handles transaction confirmation through its own dialog. The Vite dev server includes CORS headers (`safeAppCors()` plugin) required for Chrome's Private Network Access policy to allow the iframe to reach localhost.

### What this means for development

**You don't write mode-specific UI code.** All three modes flow through wagmi's standard hooks. If you add a new contract interaction, it works in all modes automatically. The only mode-aware code is:

- `main.tsx` — reads `?safe=` from the URL (5 lines)
- `WalletConnection.tsx` — shows the "(Safe Multisig)" badge when connected via Protocol Kit (3 lines)

Everything else — balance reads, contract writes, form components — is mode-agnostic.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_MAINNET_RPC_URL` | RPC endpoint for mainnet chain reads | Public endpoint (rate-limited) |
| `VITE_SUBGRAPH_URL` | Subgraph GraphQL endpoint | `http://localhost:8000/subgraphs/name/octant-token` |

All values are set in `.env` (dev) or `.env.staging` (staging) at the monorepo root.

### How `VITE_` env vars work

Browser JavaScript cannot access `process.env` — that's a Node.js API. Vite solves this with **build-time string replacement**: during `vite build` (or on-the-fly in dev mode), Vite scans source code for `import.meta.env.VITE_*` references and replaces them with the actual values from `process.env`.

```ts
// Source code (what you write):
const rpcUrl = import.meta.env['VITE_MAINNET_RPC_URL'];

// Built output (what ships to the browser):
const rpcUrl = "http://127.0.0.1:8545";
```

**Key rules:**

- **Only `VITE_` prefixed vars are exposed.** This is a security boundary — it prevents secrets like `JWT_SECRET` or `DATABASE_URL` from leaking into the browser bundle.
- **It's build-time, not runtime.** Changing a `VITE_` var requires rebuilding the app. In dev mode, Vite's HMR picks up changes on restart.
- **`vite-env.d.ts` is required for TypeScript.** The file `src/vite-env.d.ts` contains `/// <reference types="vite/client" />` which tells `tsc` that `import.meta.env` exists. Without it, TypeScript errors with "Property 'env' does not exist on type 'ImportMeta'".

**Two contexts in a Vite project:**

| Context | Runs in | Access pattern | Example file |
|---------|---------|----------------|-------------|
| Server config | Node.js | `process.env.WEB_PORT` | `vite.config.ts` |
| App source | Browser | `import.meta.env['VITE_*']` | `src/main.tsx` |

`vite.config.ts` runs in Node.js at startup, so it can read any env var (ports, non-secret config). Source files under `src/` run in the browser, so they can only access `VITE_`-prefixed vars via `import.meta.env`.

## Workspace Dependencies

- `@octant/web3` — Shared web3 infrastructure (wagmi config, chain definitions, contract ABIs, Safe connectors)
- `@octant/subgraph-client` — Subgraph query client and React hooks

```tsx
import { useAutoConnect, USDC_ADDRESS, erc20Abi } from '@octant/web3';
import { useRecentTransfers, setSubgraphUrl } from '@octant/subgraph-client';
```

## Testing

Tests run with Vitest using jsdom for DOM simulation.

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
```

Test files follow the pattern `src/**/*.test.{ts,tsx}`.
