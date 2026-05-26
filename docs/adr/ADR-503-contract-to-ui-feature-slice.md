# ADR-503: Contract-to-UI Feature Slice

## Status
Accepted

## Context

Adding a new smart contract interaction to the Octant dapp touches multiple layers: Solidity contract, Foundry deployment, the shared `@octant/web3` package, optionally the `@octant/subgraph-client` package for indexed event data, and React components in `apps/web`. This ADR documents the end-to-end recipe so that each new contract follows a consistent pattern.

The walkthrough uses a concrete example: adding a hypothetical `OctantStaking` contract with `stake(uint256)` (write), `unstake(uint256)` (write), `stakedBalance(address)` (read), and `totalStaked()` (read).

## Decision

### Step 1: Write the Solidity contract

Create the contract in `packages/chain/src/`.

```solidity
// packages/chain/src/OctantStaking.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin-contracts/token/ERC20/IERC20.sol";

contract OctantStaking {
    IERC20 public immutable token;
    mapping(address => uint256) public stakedBalance;
    uint256 public totalStaked;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function stake(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
    }

    function unstake(uint256 amount) external {
        require(stakedBalance[msg.sender] >= amount, "Insufficient stake");
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        token.transfer(msg.sender, amount);
    }
}
```

Build it:

```bash
cd packages/chain && forge build
```

### Step 2: Add a deploy script

Create or extend a Foundry script in `packages/chain/script/`.

```solidity
// packages/chain/script/DeployStaking.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OctantStaking.sol";

contract DeployStakingScript is Script {
    uint256 constant ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        address octantToken = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
        vm.startBroadcast(ANVIL_PRIVATE_KEY);
        new OctantStaking(octantToken);
        vm.stopBroadcast();
    }
}
```

Deploy to local Anvil:

```bash
forge script script/DeployStaking.s.sol --broadcast --rpc-url http://127.0.0.1:8545
```

Note the deployed address from the output. For a deterministic Anvil deploy, the address depends on the deployer nonce. If the OctantToken was deployed first (nonce 0), the staking contract deploys at nonce 1 producing a predictable address.

### Step 3: Register the address and ABI in `@octant/web3`

Add the contract address and ABI to `packages/web3/src/contracts.ts`. The ABI is a `const` assertion array — this is what gives wagmi full type inference for function names, argument types, and return types.

```typescript
// packages/web3/src/contracts.ts

// ... existing exports ...

export const STAKING_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as const;

export const stakingAbi = [
  {
    type: 'function',
    name: 'stake',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unstake',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stakedBalance',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalStaked',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
```

Key details:
- **`as const`** on the ABI array is mandatory. Without it, wagmi loses type narrowing and `functionName` becomes `string` instead of `'stake' | 'unstake' | ...`.
- **Address uses `as const`** so it narrows to the literal hex type rather than `string`.
- **Deterministic addresses** are fine for local Anvil. For multi-network deployments, consider a mapping keyed by chain ID.

### Step 4: Export from the package barrel

Add the new exports to `packages/web3/src/index.ts`:

```typescript
export {
  OCTANT_TOKEN_ADDRESS, octantTokenAbi,
  USDC_ADDRESS, erc20Abi,
  STAKING_ADDRESS, stakingAbi,       // <-- new
} from './contracts.js';
```

Rebuild the package:

```bash
pnpm --filter @octant/web3 build
```

### Step 5: Build the UI component with wagmi hooks

Create a component in the web app. wagmi provides two hooks that cover most needs:

- **`useReadContract`** — calls a `view`/`pure` function, returns data reactively
- **`useWriteContract`** — sends a transaction for a `nonpayable`/`payable` function

#### Read example: show staked balance

```tsx
// apps/web/src/components/StakedBalance.tsx
import { useReadContract } from 'wagmi';
import { STAKING_ADDRESS, stakingAbi } from '@octant/web3';

export function StakedBalance({ address }: { address: `0x${string}` }) {
  const { data, isLoading, error } = useReadContract({
    address: STAKING_ADDRESS,
    abi: stakingAbi,
    functionName: 'stakedBalance',
    args: [address],
  });

  if (isLoading) return <p>Loading staked balance...</p>;
  if (error) return <p>Error: {error.message}</p>;
  if (data == null) return null;

  return <p>Staked: {(data as bigint).toString()} wei</p>;
}
```

What wagmi gives you from the `as const` ABI:
- `functionName` autocompletes to `'stake' | 'unstake' | 'stakedBalance' | 'totalStaked'`
- `args` is typed as `[address]` when `functionName` is `'stakedBalance'`
- `data` is typed as the return type (here, `bigint` for `uint256`)

#### Read example: no args

```tsx
const { data: totalStaked } = useReadContract({
  address: STAKING_ADDRESS,
  abi: stakingAbi,
  functionName: 'totalStaked',
  // no args needed — wagmi knows this function takes no inputs
});
```

#### Write example: stake tokens

```tsx
// apps/web/src/components/StakeForm.tsx
import { useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { STAKING_ADDRESS, stakingAbi } from '@octant/web3';

export function StakeForm() {
  const [amount, setAmount] = useState('');
  const { writeContract, data: txHash, isPending, error } = useWriteContract();

  const handleStake = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    writeContract({
      address: STAKING_ADDRESS,
      abi: stakingAbi,
      functionName: 'stake',
      args: [parseEther(amount)],
    });
  };

  // Optional: wait for confirmation
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  return (
    <div>
      <input
        type="number"
        placeholder="Amount (OCT)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button onClick={handleStake} disabled={isPending}>
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Stake'}
      </button>
      {isSuccess && <p>Staked successfully!</p>}
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

Key patterns:
- **`writeContract`** triggers the wallet popup. It returns the tx hash immediately after the user signs.
- **`useWaitForTransactionReceipt`** watches for on-chain confirmation. Pass it the `txHash` from `writeContract`.
- **`parseEther`** from viem converts a human-readable string like `"1.5"` to `1500000000000000000n`. Use `parseUnits(amount, 6)` for USDC (6 decimals).
- **This works identically across all wallet modes** — EOA, Safe Protocol Kit, or Safe iframe. The component doesn't know which is active.

#### Write with prior approval

For contracts that call `transferFrom` (like staking), the user must first `approve` the staking contract to spend their tokens. This is a two-transaction flow:

```tsx
// 1. Approve the staking contract to spend OCT
writeContract({
  address: OCTANT_TOKEN_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [STAKING_ADDRESS, parseEther(amount)],
});

// 2. After approval confirms, stake
writeContract({
  address: STAKING_ADDRESS,
  abi: stakingAbi,
  functionName: 'stake',
  args: [parseEther(amount)],
});
```

In practice, use two separate `useWriteContract` hooks or a state machine to sequence approve-then-stake.

### Step 6: Add subgraph reads with `@octant/subgraph-client` (when applicable)

If the contract emits events that the subgraph indexes (e.g. `Transfer`, `Approval`, `Staked`), use `@octant/subgraph-client` to display historical/aggregated data. This supplements wagmi's on-chain reads with indexed event data that is impractical to query directly from the RPC.

#### When to use subgraph reads vs wagmi reads

| Data type | Use | Package |
|-----------|-----|---------|
| Current state (balances, allowances) | `useReadContract` | `@octant/web3` via wagmi |
| Historical events (transfer history, past stakes) | `useRecentTransfers` etc. | `@octant/subgraph-client` |
| Aggregations (total volume, unique users) | Custom subgraph query | `@octant/subgraph-client` |

#### Adding a new subgraph query

1. **Define types** in `packages/subgraph-client/src/types.ts`:

```typescript
export interface Staked {
  id: string;
  user: string;
  amount: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
}

export interface StakedData {
  stakeds: Staked[];
}
```

Types mirror the subgraph's GraphQL wire format: `BigInt` as strings, `Bytes` as hex strings. Do not use Solidity types (`bigint`, `Address`) here — conversion happens in the UI layer.

2. **Add query + fetcher** in `packages/subgraph-client/src/queries.ts`:

```typescript
export const RECENT_STAKES_QUERY = `
  query RecentStakes($first: Int!) {
    stakeds(first: $first, orderBy: blockTimestamp, orderDirection: desc) {
      id user amount blockNumber blockTimestamp transactionHash
    }
  }
`;

export function getRecentStakes(first: number = 10): Promise<StakedData> {
  return subgraphClient.query<StakedData>(RECENT_STAKES_QUERY, { first });
}
```

3. **Add react-query hook** in `packages/subgraph-client/src/hooks.ts`:

```typescript
export function useRecentStakes(first: number = 10) {
  return useQuery<StakedData>({
    queryKey: subgraphKeys.stakes(first),  // add to subgraphKeys factory
    queryFn: () => getRecentStakes(first),
    refetchInterval: 5_000,
  });
}
```

4. **Export from barrel** in `packages/subgraph-client/src/index.ts`.

5. **Use in UI** — the hook shares the same `QueryClient` provided by `Web3Provider`, so no extra providers are needed:

```tsx
// apps/web/src/components/StakeHistory.tsx
import { formatEther } from 'viem';
import { useRecentStakes } from '@octant/subgraph-client';

export function StakeHistory() {
  const { data, isLoading, error } = useRecentStakes(20);
  // render table...
}
```

#### Closing the write-index-read loop

After a write transaction confirms, invalidate the subgraph cache so the UI picks up the newly indexed event:

```tsx
import { useInvalidateTransfers } from '@octant/subgraph-client';

// Inside a component that writes to the contract:
const invalidate = useInvalidateTransfers();

const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
useEffect(() => {
  if (isSuccess) invalidate();
}, [isSuccess, invalidate]);
```

This gives the user immediate feedback: the write confirms via wagmi, then within ~5s the subgraph indexes the event and the history table updates via react-query polling + cache invalidation.

### Step 7: Verify

```bash
# Build all packages
pnpm --filter @octant/web3 build
pnpm --filter @octant/subgraph-client build   # if subgraph reads added
pnpm --filter @octant/web build
pnpm typecheck

# Run tests
pnpm --filter @octant/subgraph-client test    # if subgraph reads added

# Run dev server
pnpm dev --filter @octant/web

# Test in browser
# 1. Connect wallet
# 2. Verify read data appears (staked balance, total staked)
# 3. Submit a write tx, verify wallet popup + confirmation
# 4. Verify subgraph history table updates after confirmation (if applicable)
```

## Summary: files touched per feature

| Layer | File | What you add |
|-------|------|--------------|
| Solidity | `packages/chain/src/NewContract.sol` | Contract source |
| Deploy | `packages/chain/script/DeployNew.s.sol` | Foundry deploy script |
| Registry | `packages/web3/src/contracts.ts` | Address constant + ABI (`as const`) |
| Barrel | `packages/web3/src/index.ts` | Export the new address + ABI |
| UI (writes + reads) | `apps/web/src/components/NewFeature.tsx` | `useReadContract` / `useWriteContract` with the ABI |
| Subgraph types | `packages/subgraph-client/src/types.ts` | Event entity interfaces (if indexed) |
| Subgraph queries | `packages/subgraph-client/src/queries.ts` | GraphQL query string + typed fetcher |
| Subgraph hooks | `packages/subgraph-client/src/hooks.ts` | `useRecentX` hook + query key entry |
| Subgraph barrel | `packages/subgraph-client/src/index.ts` | Export new types, queries, hooks |
| UI (history) | `apps/web/src/components/NewHistory.tsx` | Subgraph hook + table rendering |

The minimum slice is 5 files (Steps 1-5) for on-chain reads/writes only. Add 4-5 more files when the feature also needs indexed event history from the subgraph (Step 6).

## Consequences

### Positive
- Type-safe end-to-end: Solidity ABI types flow through to React component props via `as const`
- wagmi hooks handle caching, loading states, error states, and re-fetching automatically
- Same component code works for EOA, Safe iframe, and Safe Protocol Kit — no branching
- Adding a new contract doesn't require changes to config, provider, or connectors
- Subgraph reads share the same `QueryClient` as wagmi — no additional providers
- Write-index-read loop closes automatically via cache invalidation + polling

### Negative
- ABIs are hand-written JSON in `contracts.ts` rather than auto-generated from Foundry artifacts. For large ABIs, consider a build step that reads `out/*.json` and generates the TypeScript.
- Deterministic Anvil addresses assume a fixed deploy order. A config-per-chain approach is needed for multi-network support.
- Subgraph reads have inherent indexing latency (1-5s on local Anvil). UI must handle the gap between transaction confirmation and subgraph availability.

### Alternatives not chosen

| Approach | Why not |
|----------|---------|
| Auto-generate ABI from Foundry `out/` JSON | Adds a build step and codegen dependency; hand-written is fine for small ABIs |
| `wagmi codegen` CLI | Generates typed hooks per contract; useful at scale but overkill for a few contracts |
| ethers.js `Contract` class | No React integration, manual state management, less type safety than wagmi+viem |
| Direct viem `readContract`/`writeContract` | Works but loses wagmi's caching, loading states, and React Query integration |
| GraphQL codegen for subgraph | Adds codegen dependency; raw query strings with typed fetchers are sufficient for simple schemas |
| Direct `fetch` in components | Loses caching, polling, loading states; react-query provides these for free |
| Separate `QueryClientProvider` for subgraph | Unnecessary — `Web3Provider` already wraps with `QueryClientProvider` that both wagmi and subgraph hooks share |

## References

- [wagmi useReadContract](https://wagmi.sh/react/api/hooks/useReadContract)
- [wagmi useWriteContract](https://wagmi.sh/react/api/hooks/useWriteContract)
- [wagmi useWaitForTransactionReceipt](https://wagmi.sh/react/api/hooks/useWaitForTransactionReceipt)
- [viem parseEther / parseUnits](https://viem.sh/docs/utilities/parseEther)
- [Foundry Book: Deploying](https://book.getfoundry.sh/forge/deploying)
- [TanStack React Query](https://tanstack.com/query/latest)
- ADR-500: Web3 Package Architecture
- ADR-501: Safe Dual-Mode Integration
