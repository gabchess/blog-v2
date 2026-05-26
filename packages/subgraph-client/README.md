# @octant/subgraph-client

TypeScript client and React hooks for querying the Octant subgraph. Provides typed query functions and TanStack Query hooks with automatic polling.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to dist/ |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests with Vitest |
| `pnpm lint` | Lint source files with ESLint |
| `pnpm clean` | Remove dist, .turbo, and build artifacts |

## Development (local)

No setup needed. The default subgraph URL is `http://localhost:8000/subgraphs/name/octant-token`, which matches the local Graph Node started by `pnpm dev:web`.

```tsx
import { useRecentTransfers } from '@octant/subgraph-client';

function TransferList() {
  const { data, isLoading } = useRecentTransfers(10);
  // data.transfers available when loaded
}
```

## Staging (Tenderly fork)

In staging, the subgraph URL is the same (local Graph Node) but it indexes from the Tenderly fork. The consuming app configures the URL from env vars before rendering:

```tsx
// apps/web/src/main.tsx
import { setSubgraphUrl } from '@octant/subgraph-client';

const url = import.meta.env['VITE_SUBGRAPH_URL'];
if (url) setSubgraphUrl(url);
```

This must be called before any React component renders (i.e., at module scope in the entry point).

## API

### `createSubgraphClient(url?)`

Create an independent client instance. The returned client closes over the URL at creation time.

```ts
import { createSubgraphClient } from '@octant/subgraph-client';

const client = createSubgraphClient('http://localhost:8000/subgraphs/name/my-subgraph');
const data = await client.query<MyData>('{ transfers(first: 5) { id } }', { first: 5 });
```

Without a URL argument, uses the default (`http://localhost:8000/subgraphs/name/octant-token`).

### `setSubgraphUrl(url)`

Override the default URL used by `getDefaultClient()` and all hooks/query functions. Invalidates the cached default client so the next call creates a fresh one with the new URL.

```ts
import { setSubgraphUrl } from '@octant/subgraph-client';
setSubgraphUrl('http://staging:8000/subgraphs/name/octant-token');
```

### `getDefaultClient()`

Returns the lazily-created default client. Subsequent calls return the same cached instance until `setSubgraphUrl()` is called.

### Query Functions

| Function | Returns | Default `first` |
|----------|---------|-----------------|
| `getRecentTransfers(first?)` | `Promise<TransfersData>` | 10 |
| `getRecentApprovals(first?)` | `Promise<ApprovalsData>` | 10 |

Both use `getDefaultClient()` internally.

### React Hooks

Require `@tanstack/react-query` `QueryClientProvider` in the component tree (provided by `@octant/web3` `Web3Provider`).

| Hook | Returns | Polling |
|------|---------|---------|
| `useRecentTransfers(first?)` | `UseQueryResult<TransfersData>` | Every 5s |
| `useRecentApprovals(first?)` | `UseQueryResult<ApprovalsData>` | Every 5s |
| `useInvalidateTransfers()` | `() => void` | Manual invalidation |
| `useInvalidateApprovals()` | `() => void` | Manual invalidation |

### Query Keys

```ts
import { subgraphKeys } from '@octant/subgraph-client';

subgraphKeys.all                // ['subgraph']
subgraphKeys.transfers(10)      // ['subgraph', 'transfers', 10]
subgraphKeys.approvals(5)       // ['subgraph', 'approvals', 5]
```

## Architecture

The default client is managed by an IIFE closure that encapsulates the mutable URL and cached client instance together. `setSubgraphUrl()` and `getDefaultClient()` are bound methods from this closure — no module-level mutable variables.

```
setSubgraphUrl(url)  →  closure { url, cached }  →  getDefaultClient()
                              ↓
                     createSubgraphClient(url)
                              ↓
                     { query(gql, vars) → fetch(url, ...) }
```

## Testing

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
```

Tests mock `fetch` globally and verify client creation, URL closure behavior, error handling, and the `setSubgraphUrl`/`getDefaultClient` lifecycle.
