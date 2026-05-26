#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAIN_DIR="$(dirname "$SCRIPT_DIR")"
ANVIL_PORT="${ANVIL_PORT:-8545}"
RPC_URL="http://localhost:$ANVIL_PORT"
ANVIL_PID=""

# Cleanup: kill anvil on exit
cleanup() {
  if [ -n "$ANVIL_PID" ]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
  # Belt-and-suspenders: kill anything still on the port
  lsof -ti :$ANVIL_PORT 2>/dev/null | xargs kill 2>/dev/null || true
}
trap cleanup EXIT

# Check for existing anvil on port
if lsof -ti :$ANVIL_PORT >/dev/null 2>&1; then
  echo "Error: port $ANVIL_PORT already in use. Run 'pnpm stop' or kill the process."
  exit 1
fi

echo "Starting anvil on port $ANVIL_PORT (chain ID 31337)..."
anvil --port "$ANVIL_PORT" &
ANVIL_PID=$!

# Wait for anvil to be ready
echo "Waiting for anvil to be ready..."
for i in $(seq 1 30); do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    echo "Anvil ready (PID: $ANVIL_PID)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: anvil failed to start within 30 seconds"
    exit 1
  fi
  sleep 0.5
done

# Deploy & seed
cd "$CHAIN_DIR"

echo ""
echo "Deploying OctantToken..."
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast
echo "OctantToken deployed to 0x5FbDB2315678afecb367f032d93F642f64180aa3"

echo ""
echo "Seeding Transfer + Approval events..."
forge script script/Seed.s.sol --rpc-url "$RPC_URL" --broadcast
echo "Seeded: 3 Transfer events, 2 Approval events"

# Write networks.json for subgraph consumption (Graph CLI native format)
NETWORKS_FILE="$CHAIN_DIR/../../apps/subgraph/networks.json"
cat > "$NETWORKS_FILE" <<EOF
{
  "localhost": {
    "OctantToken": {
      "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "startBlock": 1
    }
  }
}
EOF
echo "Wrote networks.json to $NETWORKS_FILE"

# Report
echo ""
echo "=== Chain ready ==="
echo "  RPC:      $RPC_URL"
echo "  Mode:     Local (chain ID 31337)"
echo "  OCT:      0x5FbDB2315678afecb367f032d93F642f64180aa3"
echo "  Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo ""
echo "Anvil running (Ctrl+C to stop)..."
wait "$ANVIL_PID"
