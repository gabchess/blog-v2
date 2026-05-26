# ADR-500: Web3 Package Architecture

## Status
Accepted

## Context

The Octant frontend needs a shared web3 layer that:

1. Provides wallet connection for React apps across the monorepo
2. Supports multiple connection modes (EOA wallets, Safe multisig iframe, Safe multisig standalone)
3. Encapsulates chain definitions, contract ABIs, and provider configuration
4. Exposes typed hooks and config to consuming apps without tight coupling

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Inline wagmi config per app | Simple, no shared code | Duplication, config drift between apps |
| **Shared `@octant/web3` package** | Single source of truth, typed exports | Must coordinate peer deps across apps |
| RainbowKit / Web3Modal wrapper | Rich UI out of the box | Opinionated UI, harder to customize Safe flows |
| Ethers.js directly | Familiar API | No React integration, manual state management |

## Decision

We create `packages/web3` (`@octant/web3`) as the shared web3 infrastructure package for all frontend apps.

### Package Structure

```
packages/web3/src/
  index.ts              # Barrel exports
  config.ts             # Wagmi config factory (createAppConfig)
  provider.tsx          # <Web3Provider> React component
  chains.ts             # Chain definitions (anvilLocal, mainnet)
  contracts.ts          # Contract addresses + ABIs (OctantToken, USDC)
  hooks/
    index.ts
    useAutoConnect.ts   # Safe iframe auto-detection
  safe/
    index.ts            # Safe module barrel
    connector.ts        # Custom wagmi connector for Protocol Kit
    initProtocolKit.ts  # Async Safe init + owner validation
    safeProvider.ts     # EIP-1193 provider wrapping Protocol Kit
```

### Key Design Choices

**1. Factory function over static config**

`createAppConfig(options)` returns a fresh wagmi `Config` rather than exporting a static singleton. This allows apps to pass runtime parameters (RPC URL, Safe address) that differ per environment or URL context.

```typescript
export interface AppConfigOptions {
  mainnetRpcUrl?: string;
  safeAddress?: Address;
}
```

A default `config` export is still available for apps that need no customization.

**2. Peer dependencies for wagmi/viem/react-query**

wagmi, viem, and @tanstack/react-query are peer dependencies, not direct dependencies. This ensures the consuming app controls the exact version and avoids duplicate React context issues that occur with multiple wagmi instances.

**3. Connector ordering**

```typescript
connectors: [
  safe({ allowedDomains: [/app\.safe\.global$/] }),
  ...(safeAddress ? [safeProtocolKit({ safeAddress })] : []),
  injected(),
]
```

The `safe()` connector is always first because `useAutoConnect` probes it to detect iframe context. The Protocol Kit connector is conditionally included based on URL params. `injected()` is always last as the fallback.

**4. `reconnectOnMount={false}`**

Wagmi's auto-reconnect is disabled because `useAutoConnect` handles Safe connector detection manually. Enabling both would race and potentially double-connect.

### Dependency Graph

```
packages/web3
  peerDeps: wagmi, viem, @tanstack/react-query, react, react-dom
  deps:     @safe-global/protocol-kit, @safe-global/api-kit,
            @safe-global/safe-apps-provider, @safe-global/safe-apps-sdk
       |
       v
apps/web (consumes via workspace:*)
apps/admin (consumes via workspace:*)
```

### Supported Chains

| Chain | ID | RPC | Usage |
|-------|----|-----|-------|
| Anvil Local | 31337 | `http://127.0.0.1:8545` | Local Foundry development |
| Ethereum Mainnet | 1 | Public or `VITE_MAINNET_RPC_URL` | Production / mainnet fork |

### Contract Registry

| Name | Address | Network |
|------|---------|---------|
| OctantToken | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Anvil (nonce-0 deploy) |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Ethereum Mainnet |

Both share the standard ERC-20 ABI (`erc20Abi`).

## Consequences

### Positive
- Single source of truth for chain config, contract addresses, and ABIs
- Type-safe exports: consuming apps get full TypeScript inference
- Composable: apps can extend config via `createAppConfig()` options
- Safe support is opt-in: no overhead if unused

### Negative
- Peer dependency coordination: version bumps to wagmi/viem must be synchronized across all apps
- Contract addresses are hardcoded constants; a registry pattern may be needed if addresses differ per deployment

## References

- [Wagmi Documentation](https://wagmi.sh)
- [Viem Documentation](https://viem.sh)
- ADR-000: Turborepo Monorepo Template (package structure conventions)
