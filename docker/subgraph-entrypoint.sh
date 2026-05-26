#!/bin/bash
#
# Generic single-shot subgraph deploy job. Runs at container start, exits 0 on success.
# Required env vars are validated up-front so a misconfigured Job fails fast.
#
# Required:
#   SUBGRAPH_NAME     — e.g. subgraph
#   SUBGRAPH_VERSION  — e.g. 1.2.3
#
# Deploy targets (at least one required):
#   GOLDSKY_TOKEN         — if set, deploys to Goldsky
#   GRAPH_NODE_ADMIN_URL  — if set, deploys to self-hosted Graph Node (e.g. http://graph-node:8020)
#   IPFS_URL              — required when GRAPH_NODE_ADMIN_URL is set (e.g. http://ipfs:5001)
#
# Optional:
#   NETWORK_NAME  — defaults to "mainnet"
#
# networks.json must exist in the working directory before the container starts.

set -euo pipefail

require() {
  local name="$1"
  local hint="$2"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is required ($hint)" >&2
    exit 1
  fi
}

require SUBGRAPH_NAME    "e.g. subgraph"
require SUBGRAPH_VERSION "e.g. 1.2.3"

NETWORK_NAME="${NETWORK_NAME:-mainnet}"

if [[ -z "${GOLDSKY_TOKEN:-}" && -z "${GRAPH_NODE_ADMIN_URL:-}" ]]; then
  echo "ERROR: at least one of GOLDSKY_TOKEN or GRAPH_NODE_ADMIN_URL must be set" >&2
  exit 1
fi

echo "Subgraph:  $SUBGRAPH_NAME"
echo "Version:   $SUBGRAPH_VERSION"
echo "Network:   $NETWORK_NAME"
echo "--------------------------------------"

# ---------------------------------------------------------------------------
# Validate networks.json
# ---------------------------------------------------------------------------
if [ ! -f "networks.json" ]; then
  echo "ERROR: networks.json not found in $(pwd)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Codegen + build
# ---------------------------------------------------------------------------
echo "→ graph codegen"
pnpm exec graph codegen

echo "→ graph build --network $NETWORK_NAME"
pnpm exec graph build --network "$NETWORK_NAME"

echo "--------------------------------------"

# ---------------------------------------------------------------------------
# Goldsky deploy
# ---------------------------------------------------------------------------
if [[ -n "${GOLDSKY_TOKEN:-}" ]]; then
  echo "→ goldsky subgraph deploy $SUBGRAPH_NAME/$SUBGRAPH_VERSION"
  goldsky_ok=true
  goldsky_out=$(pnpm exec goldsky subgraph deploy "$SUBGRAPH_NAME/$SUBGRAPH_VERSION" \
    --token "$GOLDSKY_TOKEN" 2>&1) || goldsky_ok=false
  echo "$goldsky_out"
  if [[ "$goldsky_ok" == false ]]; then
    # Goldsky identifies subgraphs by IPFS hash — if the same content was already
    # deployed under a different version, the error message includes that version.
    # Extract it and create a tag alias so both name/old and name/new are accessible.
    existing=$(echo "$goldsky_out" | sed -n 's/.*under the name \(.*\)\. Either.*/\1/p')
    if [[ -n "$existing" ]]; then
      echo "  ↳ content already deployed as $existing — creating tag $SUBGRAPH_VERSION"
      pnpm exec goldsky subgraph tag create "$existing" \
        --tag "$SUBGRAPH_VERSION" \
        --token "$GOLDSKY_TOKEN"
    else
      exit 1
    fi
  fi
  echo "✓ Goldsky deploy complete"
  echo "--------------------------------------"
fi

# ---------------------------------------------------------------------------
# Self-hosted Graph Node deploy
# ---------------------------------------------------------------------------
if [[ -n "${GRAPH_NODE_ADMIN_URL:-}" ]]; then
  require IPFS_URL "required when GRAPH_NODE_ADMIN_URL is set (e.g. http://ipfs:5001)"

  echo "Graph Node: $GRAPH_NODE_ADMIN_URL"
  echo "IPFS:       $IPFS_URL"

  echo "→ graph create $SUBGRAPH_NAME (idempotent — succeeds if already exists)"
  pnpm exec graph create --node "$GRAPH_NODE_ADMIN_URL" "$SUBGRAPH_NAME" || \
    echo "  (subgraph already exists — continuing to deploy)"

  echo "→ graph deploy $SUBGRAPH_NAME (version=$SUBGRAPH_VERSION, network=$NETWORK_NAME)"
  pnpm exec graph deploy \
    --node "$GRAPH_NODE_ADMIN_URL" \
    --ipfs "$IPFS_URL" \
    --version-label "$SUBGRAPH_VERSION" \
    --network "$NETWORK_NAME" \
    "$SUBGRAPH_NAME"

  echo "✓ Graph Node deploy complete"
  echo "--------------------------------------"
fi
