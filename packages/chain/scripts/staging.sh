#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_DIR="$(dirname "$SCRIPT_DIR")"

# Require TENDERLY_RPC_URL
TENDERLY_RPC_URL="${TENDERLY_RPC_URL:?Set TENDERLY_RPC_URL in .env.staging}"

# Deployer = Anvil account 0 (deterministic address when nonce = 0)
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TOKEN="0x5FbDB2315678afecb367f032d93F642f64180aa3"
NETWORKS_FILE="$CHAIN_DIR/../../apps/subgraph/networks.json"

# Check if token is already deployed (idempotent — safe to re-run)
CODE=$(cast code "$TOKEN" --rpc-url "$TENDERLY_RPC_URL" 2>/dev/null)
if [ "$CODE" != "0x" ] && [ -n "$CODE" ]; then
  echo "OctantToken already deployed at $TOKEN"
  echo "Virtual TestNet state is persistent — skipping deploy and seed."

  # Still write networks.json (in case file was deleted or startBlock needs updating)
  # Use the block where the token was first deployed (read from existing file if available)
  if [ -f "$NETWORKS_FILE" ]; then
    START_BLOCK=$(python3 -c "import json; print(json.load(open('$NETWORKS_FILE'))['localhost']['OctantToken']['startBlock'])" 2>/dev/null || echo "1")
  else
    START_BLOCK=1
  fi

  cat > "$NETWORKS_FILE" <<EOF
{
  "localhost": {
    "OctantToken": {
      "address": "$TOKEN",
      "startBlock": $START_BLOCK
    }
  }
}
EOF

  echo ""
  echo "=== Staging chain ready ==="
  echo "  RPC:      $TENDERLY_RPC_URL"
  echo "  Mode:     Tenderly Virtual TestNet (mainnet fork)"
  echo "  OCT:      $TOKEN"
  echo "  Block:    $START_BLOCK"
  echo "  Deployer: $DEPLOYER"
  exit 0
fi

# --- First-time deploy ---

# Reset deployer nonce to 0 so CREATE produces the deterministic address
# (the Anvil default key has real mainnet txs, so nonce > 0 on a fresh fork)
echo "Resetting deployer nonce to 0..."
cast rpc --rpc-url "$TENDERLY_RPC_URL" tenderly_setNonce "$DEPLOYER" "0x0"

# Fund deployer with 100 ETH via Tenderly custom RPC
echo "Funding deployer ${DEPLOYER} with 100 ETH..."
cast rpc --rpc-url "$TENDERLY_RPC_URL" tenderly_setBalance "$DEPLOYER" "0x56BC75E2D63100000"

# Capture startBlock before deploy (for subgraph indexing)
START_BLOCK=$(cast block-number --rpc-url "$TENDERLY_RPC_URL")

cd "$CHAIN_DIR"

echo ""
echo "Deploying OctantToken..."
forge script script/Deploy.s.sol --rpc-url "$TENDERLY_RPC_URL" --broadcast
echo "OctantToken deployed to $TOKEN"

echo ""
echo "Seeding Transfer + Approval events..."
forge script script/Seed.s.sol --rpc-url "$TENDERLY_RPC_URL" --broadcast
echo "Seeded: 3 Transfer events, 2 Approval events"

# Write networks.json for subgraph consumption (Graph CLI native format)
cat > "$NETWORKS_FILE" <<EOF
{
  "localhost": {
    "OctantToken": {
      "address": "$TOKEN",
      "startBlock": $START_BLOCK
    }
  }
}
EOF
echo "Wrote networks.json to $NETWORKS_FILE (startBlock: $START_BLOCK)"

echo ""
echo "=== Staging chain ready ==="
echo "  RPC:      $TENDERLY_RPC_URL"
echo "  Mode:     Tenderly Virtual TestNet (mainnet fork)"
echo "  OCT:      $TOKEN"
echo "  Block:    $START_BLOCK"
echo "  Deployer: $DEPLOYER"
