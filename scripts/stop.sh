#!/bin/bash
# Full teardown — clean slate for the next 'pnpm dev'.
#
# 1. Kills native dev processes (node, anvil) by port
# 2. Stops Docker containers (subgraph infra + databases) via compose
#
# Docker Desktop itself is never touched — only containers are stopped.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Stopping everything..."

# ─── Ports ───
REST_PORT="${REST_PORT:-4000}"
GRAPHQL_PORT="${GRAPHQL_PORT:-4001}"
TRPC_PORT="${TRPC_PORT:-4002}"
WEB_PORT="${WEB_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
WIDGET_PORT="${WIDGET_PORT:-3002}"
QF_SIMULATOR_PORT="${QF_SIMULATOR_PORT:-3003}"
ANVIL_PORT="${ANVIL_PORT:-8545}"

# Kill a dev process listening on a port.
# Only kills node and anvil — never Docker's port-forwarding proxy
# (com.docker.backend), which crashes Docker Desktop if killed.
kill_dev_process() {
  local port=$1
  local label=$2
  local pids
  pids=$(lsof -i :"$port" -t -sTCP:LISTEN 2>/dev/null)
  [ -z "$pids" ] && return

  for pid in $pids; do
    local cmd
    cmd=$(ps -p "$pid" -o comm= 2>/dev/null)
    case "$cmd" in
      node|anvil)
        echo "  Stopping $label on port $port (PID $pid, $cmd)"
        kill "$pid" 2>/dev/null
        ;;
    esac
  done
}

# ─── 1. Native dev processes ───

for port in $REST_PORT $GRAPHQL_PORT $TRPC_PORT; do
  kill_dev_process "$port" "API server"
done

for port in $WEB_PORT $ADMIN_PORT $WIDGET_PORT $QF_SIMULATOR_PORT; do
  kill_dev_process "$port" "frontend"
done

kill_dev_process "$ANVIL_PORT" "anvil"

# ─── 2. Docker containers (via compose, not kill) ───

if docker info > /dev/null 2>&1; then
  # Subgraph infra (graph-node, ipfs, graph-postgres)
  if [ -f "$ROOT_DIR/apps/subgraph/docker-compose.yml" ]; then
    docker compose -f "$ROOT_DIR/apps/subgraph/docker-compose.yml" down 2>/dev/null && \
      echo "  Stopped subgraph containers." || true
  fi

  # Databases (mongodb, postgres)
  if [ -f "$ROOT_DIR/docker-compose.yml" ]; then
    docker compose -f "$ROOT_DIR/docker-compose.yml" down 2>/dev/null && \
      echo "  Stopped database containers." || true
  fi
else
  echo "  Docker not running — skipping container cleanup."
fi

echo "Done. Clean slate."
