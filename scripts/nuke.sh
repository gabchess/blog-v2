#!/bin/bash
set -euo pipefail

if [[ "${1:-}" != "--force" ]]; then
  echo "WARNING: This will delete ALL data including:"
  echo "  - Docker volumes (database data)"
  echo "  - Node modules"
  echo "  - Build artifacts"
  echo ""
  echo "Use --force to confirm."
  exit 1
fi

echo "Stopping dev servers..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

echo "Stopping Docker and removing volumes..."
docker compose down -v

echo "Removing build artifacts..."
rm -rf node_modules .turbo
rm -rf apps/*/dist apps/*/node_modules apps/*/.turbo
rm -rf packages/*/dist packages/*/node_modules packages/*/.turbo

echo "Nuked everything. Run 'pnpm install' to start fresh."
