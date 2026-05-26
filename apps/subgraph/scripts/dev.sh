#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBGRAPH_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SUBGRAPH_DIR"

SUBGRAPH_NAME="octant-token"
ANVIL_PORT="${ANVIL_PORT:-8545}"
GRAPH_NODE_ADMIN_PORT="${GRAPH_NODE_ADMIN_PORT:-8020}"
GRAPH_NODE_HTTP_PORT="${GRAPH_NODE_HTTP_PORT:-8000}"
GRAPH_IPFS_PORT="${GRAPH_IPFS_PORT:-5001}"

GRAPH_NODE_ADMIN_URL="http://localhost:${GRAPH_NODE_ADMIN_PORT}"
GRAPH_NODE_GRAPHQL_URL="http://localhost:${GRAPH_NODE_HTTP_PORT}"
GRAPH_IPFS_URL="http://localhost:${GRAPH_IPFS_PORT}"
ANVIL_URL="http://localhost:${ANVIL_PORT}"
SUBGRAPH_VERSION="v0.0.1"

# Cleanup on exit: stop containers but preserve volumes for debugging
cleanup() {
  echo ""
  echo "Stopping Graph Node infrastructure..."
  docker compose down || true
}
trap cleanup EXIT

# --- Pre-flight ---
if ! docker info > /dev/null 2>&1; then
  echo "WARNING: Docker is not running. Skipping subgraph dev."
  echo "Start Docker and run 'pnpm subgraph:dev' separately."
  exit 0
fi

# --- Wait for anvil (skip in staging — no local chain) ---
if [ -z "${GRAPH_ETHEREUM_RPC:-}" ]; then
  echo "Waiting for anvil on port ${ANVIL_PORT}..."
  RETRIES=30
  until curl -sf "$ANVIL_URL" -X POST -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "ERROR: Anvil not available on port ${ANVIL_PORT} after 60s."
      echo "Ensure chain is running: pnpm chain:dev"
      exit 1
    fi
    sleep 2
  done
  echo "Anvil is ready."
else
  echo "GRAPH_ETHEREUM_RPC is set — skipping anvil wait (staging mode)."
fi

# --- Start Graph Node (clean slate) ---
echo "Starting Graph Node infrastructure..."
docker compose down -v || true
docker compose up -d

# --- Wait for Graph Node ---
echo "Waiting for Graph Node..."
RETRIES=30
until curl -sf "$GRAPH_NODE_GRAPHQL_URL" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "ERROR: Graph Node did not start within 60s."
    echo "Check logs: docker compose logs graph-node"
    exit 1
  fi
  sleep 2
done
echo "Graph Node is ready."

# --- Build + deploy subgraph ---
echo "Building subgraph..."
npx graph codegen
npx graph build --network localhost

echo "Creating subgraph '$SUBGRAPH_NAME'..."
npx graph create --node "$GRAPH_NODE_ADMIN_URL" "$SUBGRAPH_NAME" 2>&1 | grep -v "already exists" || true

echo "Deploying subgraph '$SUBGRAPH_NAME'..."
npx graph deploy --node "$GRAPH_NODE_ADMIN_URL" --ipfs "$GRAPH_IPFS_URL" \
  --version-label "$SUBGRAPH_VERSION" "$SUBGRAPH_NAME"

echo ""
echo "Subgraph deployed successfully!"
echo "  GraphQL endpoint: ${GRAPH_NODE_GRAPHQL_URL}/subgraphs/name/$SUBGRAPH_NAME"
echo ""
echo "Subgraph running. Ctrl+C to stop..."

# Keep alive so turbo treats this as persistent (macOS sleep lacks 'infinity')
# Docker containers stay up; cleanup trap handles shutdown
tail -f /dev/null
