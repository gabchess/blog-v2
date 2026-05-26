#!/bin/bash
set -euo pipefail

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

# Copy .env.example to .env if .env doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

# Load environment variables
set -a
source .env
set +a

# Read ports from env (with defaults)
WEB_PORT="${WEB_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
REST_PORT="${REST_PORT:-4000}"
GRAPHQL_PORT="${GRAPHQL_PORT:-4001}"
MONGODB_PORT="${MONGODB_PORT:-27017}"

# Check port availability
check_port() {
  ! lsof -i ":$1" > /dev/null 2>&1
}

echo "Checking port availability..."
for port in $WEB_PORT $ADMIN_PORT $REST_PORT $GRAPHQL_PORT $MONGODB_PORT; do
  if ! check_port $port; then
    echo "Port $port in use"
    if [ "$FORCE" = false ]; then
      echo "Use --force to continue anyway"
      exit 1
    fi
  fi
done

# Start infrastructure
echo "Starting Docker services..."
docker compose up -d

# Wait for MongoDB
echo "Waiting for MongoDB..."
until docker compose exec -T mongodb mongosh --eval 'db.runCommand("ping")' > /dev/null 2>&1; do
  sleep 1
done
echo "MongoDB ready"

# Install and build
echo "Installing dependencies..."
pnpm install

echo "Building packages..."
pnpm build

# Push database schema
echo "Pushing database schema..."
pnpm --filter @octant/db db:push

# Start dev servers
echo "Starting dev servers..."
pnpm dev
