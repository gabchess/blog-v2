# @octant/chain

Foundry project for the OctantToken (ERC-20) smart contract. Runs a local anvil node, deploys the contract, and seeds events for development.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start anvil, deploy OctantToken, seed events |
| `pnpm build` | Compile contracts with `forge build` |
| `pnpm seed` | Run seed script against running anvil |
| `pnpm seed:address` | Seed a specific address (see `scripts/seed-address.sh`) |
| `pnpm clean` | Remove out/, cache/, and broadcast/ |

## Development (local)

The chain package is typically started as part of the full dev stack:

```bash
# From monorepo root — starts chain + subgraph + web
pnpm dev:web
```

Or run it standalone:

```bash
pnpm chain:dev
```

### What `dev.sh` does

1. Starts anvil on port 8545 (chain ID 31337)
2. Deploys OctantToken to `0x5FbDB2315678afecb367f032d93F642f64180aa3` (deterministic nonce-0 address)
3. Seeds 3 Transfer events and 2 Approval events
4. Writes `apps/subgraph/networks.json` with the contract address and start block
5. Keeps anvil running until Ctrl+C

### Verify

```bash
# Check anvil is running
cast chain-id --rpc-url http://localhost:8545   # Should return 31337

# Check contract is deployed
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 "name()" --rpc-url http://localhost:8545
```

### Accounts

Anvil uses the standard deterministic accounts. The deployer is account 0:

| Role | Address |
|------|---------|
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |

## Staging

**This package is not used in staging.** Staging connects directly to a Tenderly mainnet fork (chain ID 1) where the user deploys contracts via the Tenderly dashboard or scripts.

The `pnpm staging` command at the monorepo root starts only `@octant/subgraph` and `@octant/web` — no local anvil.

### Deploying to a Tenderly fork

If you need to deploy OctantToken on the fork:

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.gateway.tenderly.co/YOUR_KEY \
  --broadcast
```

Then update `apps/subgraph/networks.json` with the deployed address and start block from the fork.

## Project Structure

```
packages/chain/
  src/              # Solidity contracts
  script/           # Forge deploy and seed scripts
    Deploy.s.sol    # Deploys OctantToken
    Seed.s.sol      # Seeds Transfer + Approval events
  scripts/
    dev.sh          # Dev startup script (anvil + deploy + seed)
    seed-address.sh # Seed a specific address with tokens
  foundry.toml      # Foundry configuration
```

## Dependencies

- [Foundry](https://book.getfoundry.sh/) — `forge`, `anvil`, `cast`
