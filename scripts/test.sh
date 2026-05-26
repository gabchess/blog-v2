#!/bin/bash
set -euo pipefail

# Load environment variables
# Uses canonical port 27017 - replica set is initialized via healthcheck
export MONGODB_PORT="${MONGODB_PORT:-27017}"
export DATABASE_URL="mongodb://localhost:${MONGODB_PORT}/octant_test?replicaSet=rs0"

# Run tests in staging mode for production-like security settings
# Staging has reasonable rate limits (20 login, 10 signup) while still being testable
export ENV=staging

echo "=== Starting Test Infrastructure ==="
docker compose up -d mongodb --wait

# Healthcheck handles replica set initialization, just verify it's ready
echo "Waiting for MongoDB replica set..."
until docker compose exec -T mongodb mongosh --quiet --eval "rs.status().ok" 2>/dev/null | grep -q 1; do
  echo "  Waiting for replica set..."
  sleep 2
done
echo "MongoDB ready"

echo "Pushing database schema..."
pnpm --filter @octant/db db:push

echo ""
echo "=== Running E2E Tests ==="
pnpm turbo test:e2e

echo ""
echo "=== All Tests Complete ==="
