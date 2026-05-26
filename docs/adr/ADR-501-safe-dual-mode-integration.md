# ADR-501: Safe Dual-Mode Integration (Iframe + Protocol Kit)

## Status
Accepted

## Context

Octant interacts with Safe multisig wallets in two distinct deployment contexts:

1. **Safe App iframe** -- The dapp is loaded inside `app.safe.global` as a Safe App. The Safe UI handles transaction confirmation via postMessage.
2. **Standalone browser** -- The dapp runs at its own URL. A user provides a Safe address via URL parameter (`?safe=0xABC...`), and MetaMask (or another injected wallet) signs Safe transactions directly.

Both modes must coexist in the same build. The app detects context at startup and activates the correct connector.

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Safe Apps SDK only (iframe) | Simple, well-documented | Only works inside Safe UI |
| Protocol Kit only (standalone) | Full control, works anywhere | No iframe postMessage support |
| **Both: Safe SDK + Protocol Kit** | All contexts covered | More code, two code paths |
| Gnosis Safe Proxy Kit | Simpler API | Deprecated in favor of Protocol Kit |
| Custom postMessage bridge | No SDK dependency | Fragile, must track Safe protocol changes |

## Decision

We implement dual-mode Safe support using wagmi connectors as the abstraction boundary.

### Detection Priority

```
1. Inside Safe iframe?  -->  auto-connect via wagmi safe() connector
2. ?safe=0x... in URL?  -->  show "Connect Safe (Protocol Kit)" button
3. Neither?             -->  show standard injected wallet buttons
```

### Mode 1: Safe App Iframe

**Components:**
- wagmi's built-in `safe()` connector from `wagmi/connectors`
- `@safe-global/safe-apps-sdk` + `@safe-global/safe-apps-provider`
- `useAutoConnect` hook (probes `safe` connector's `getProvider()`)
- CORS headers via `safeAppCors()` Vite plugin
- `/manifest.json` Safe App manifest

**Flow:**
```
app.safe.global embeds localhost:3000 in iframe
--> useAutoConnect finds safe() connector, calls getProvider()
--> SafeAppsProvider returned (SDK connected via postMessage)
--> auto-connect: accounts = [safeAddress], no popup
--> eth_sendTransaction --> postMessage to parent Safe UI
--> Safe UI shows multisig confirmation dialog
```

**Security:** `allowedDomains: [/app\.safe\.global$/]` restricts which iframe hosts can trigger the Safe SDK connection.

### Mode 2: Standalone Protocol Kit

**Components (new):**
- Custom `safeProtocolKit()` wagmi connector (`packages/web3/src/safe/connector.ts`)
- `@safe-global/protocol-kit` for transaction creation, signing, execution
- `@safe-global/api-kit` for proposing transactions to the Safe Transaction Service
- `createSafeProvider()` EIP-1193 wrapper (`packages/web3/src/safe/safeProvider.ts`)
- `initProtocolKit()` async init + validation (`packages/web3/src/safe/initProtocolKit.ts`)

**Flow:**
```
User opens localhost:3000?safe=0xSAFE
--> createAppConfig includes safeProtocolKit({ safeAddress: 0xSAFE })
--> "Connect Safe (Protocol Kit)" button appears
--> Click --> MetaMask popup (eth_requestAccounts)
--> initProtocolKit: Safe.init(), validate signer is owner
--> createSafeProvider wraps injected provider
--> useAccount().address = 0xSAFE (Safe address, not signer)
--> eth_sendTransaction intercepted:
    1. protocolKit.createTransaction()
    2. protocolKit.signTransaction()
    3. threshold met? --> executeTransaction() --> on-chain tx hash
       threshold NOT met? --> apiKit.proposeTransaction() --> safeTxHash
```

### Custom EIP-1193 Provider

The `createSafeProvider()` wraps the injected provider (MetaMask) to make wagmi's standard hooks work transparently with Safe:

| RPC Method | Behavior |
|------------|----------|
| `eth_accounts` | Returns `[safeAddress]` (not signer address) |
| `eth_requestAccounts` | Returns `[safeAddress]` |
| `eth_sendTransaction` | Intercept --> Protocol Kit create, sign, execute/propose |
| Everything else | Passthrough to injected provider |

This means `useWriteContract`, `useReadContract`, and all standard wagmi hooks work without modification. The Safe address appears as the connected account.

### Connector Lifecycle

```typescript
setup()            // Throws if in iframe (defer to safe() connector)
connect()          // MetaMask popup --> Protocol Kit init --> SafeProvider
disconnect()       // Clear cached provider and chain ID
onAccountsChanged  // Emit disconnect (new signer may not be Safe owner)
onChainChanged     // Update cached chain ID
```

### Error Handling

`SafeInitError` provides typed error codes:

| Code | Meaning | Recovery |
|------|---------|----------|
| `NO_ACCOUNTS` | Injected wallet has no accounts | User must unlock MetaMask |
| `NOT_OWNER` | Connected signer is not a Safe owner | User must switch account |
| `INIT_FAILED` | Protocol Kit initialization failed | Check Safe address, network |

### Mode 3: Standard EOA (No Safe)

When neither iframe nor `?safe=` is present, the `injected()` connector provides standard MetaMask/browser wallet support. No Safe code is loaded or activated.

## Consequences

### Positive
- One app build serves all three contexts (iframe, standalone Safe, EOA)
- wagmi's hook API works identically in all modes; consuming code is mode-agnostic
- Protocol Kit connector is tree-shakeable when `safeAddress` is not provided
- Typed errors (`SafeInitError`) enable clear user-facing messages

### Negative
- Bundle size increases (~2.5 MB uncompressed from Protocol Kit) when Safe mode is active
- Protocol Kit requires Safe Transaction Service availability for proposal flow
- Two distinct Safe code paths (SDK vs Protocol Kit) must be maintained

### Security Considerations
- `safe()` connector restricted to `app.safe.global` domain via `allowedDomains`
- `safeProtocolKit` connector blocks in iframes via `setup()` to prevent ambiguity
- Safe address from URL is validated as a 40-char hex address before use
- Signer ownership is verified against `protocolKit.getOwners()` during init

## References

- [Safe Apps SDK](https://docs.safe.global/sdk/overview)
- [Safe Protocol Kit](https://docs.safe.global/sdk/protocol-kit)
- [Safe API Kit](https://docs.safe.global/sdk/api-kit)
- [wagmi createConnector](https://wagmi.sh/core/api/createConnector)
- [Chrome Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight/) (CORS for iframe)
