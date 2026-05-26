# @octant/web3

Shared web3 infrastructure for the Octant frontend. Provides wagmi configuration, chain definitions, contract ABIs, Safe wallet connectors, and the React provider.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to dist/ |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Lint source files with ESLint |
| `pnpm clean` | Remove dist, .turbo, and build artifacts |

## Development (local)

No setup needed. The default configuration connects to local anvil on `http://127.0.0.1:8545` (chain ID 31337).

```tsx
import { Web3Provider } from '@octant/web3';

// Default: connects to local anvil
<Web3Provider>
  <App />
</Web3Provider>
```

The provider creates a wagmi config with two chains:

| Chain | ID | Transport | When used |
|-------|----|-----------|-----------|
| Anvil Local | 31337 | `http://127.0.0.1:8545` | Local dev (`pnpm dev:web`) |
| Ethereum Mainnet | 1 | `VITE_MAINNET_RPC_URL` or public endpoint | Staging (`pnpm staging`) |

## Staging (Tenderly fork)

Pass the Tenderly RPC URL via `mainnetRpcUrl` prop:

```tsx
<Web3Provider mainnetRpcUrl={import.meta.env['VITE_MAINNET_RPC_URL']}>
  <App />
</Web3Provider>
```

When `mainnetRpcUrl` is set, the mainnet transport uses a fallback strategy: Tenderly RPC first, public endpoint as backup. MetaMask connects to the Tenderly fork (which reports chain ID 1), and wagmi routes reads through the configured transport.

## Exports

### Provider

```tsx
import { Web3Provider } from '@octant/web3';
```

Wraps children in `WagmiProvider` + `QueryClientProvider`. Props:

| Prop | Type | Purpose |
|------|------|---------|
| `mainnetRpcUrl` | `string?` | Override mainnet RPC (for staging) |
| `safeAddress` | `Address?` | Enable Safe Protocol Kit connector |

### Chain Definitions

```ts
import { anvilLocal } from '@octant/web3';

anvilLocal.id        // 31337
anvilLocal.name      // 'Anvil Local'
```

### Contract Addresses

```ts
import { OCTANT_TOKEN_ADDRESS, USDC_ADDRESS, octantTokenAbi, erc20Abi } from '@octant/web3';
```

| Constant | Address | Network |
|----------|---------|---------|
| `OCTANT_TOKEN_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Anvil local (deterministic nonce-0 deploy) |
| `USDC_ADDRESS` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Ethereum mainnet |

`octantTokenAbi` and `erc20Abi` are the same standard ERC-20 ABI.

### Hooks

```ts
import { useAutoConnect } from '@octant/web3';
```

`useAutoConnect()` — handles Safe SDK auto-connection in iframe mode.

### Safe Connectors

```ts
import { safeProtocolKit, SafeInitError } from '@octant/web3';
```

Safe Protocol Kit connector for wagmi. Activated when `?safe=0x...` is in the URL.

## Project Structure

```
src/
  index.ts          # Public exports
  config.ts         # wagmi createConfig (chains, connectors, transports)
  chains.ts         # anvilLocal chain definition
  contracts.ts      # Contract addresses and ABIs
  provider.tsx      # Web3Provider (WagmiProvider + QueryClientProvider)
  hooks/            # useAutoConnect
  safe/             # Safe Protocol Kit connector and EIP-1193 adapter
```

## Peer Dependencies

- `wagmi` ^2.14.0
- `viem` ^2.21.0
- `@tanstack/react-query` ^5.62.0
- `react` ^18.0.0
