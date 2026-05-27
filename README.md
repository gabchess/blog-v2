# Octant Blog

Vite + React 19 blog. Prismic for content, Docker + Nginx + GCP for deploy.

## Prerequisites

- Node.js 22+ (pinned via `.nvmrc`)
- pnpm 9+
- Docker (deploy target; optional for local)

## Quick start

```bash
pnpm install
pnpm --filter @octant/web dev
```

## Repo structure

```
apps/web              Vite + React 19 frontend (the blog)
packages/ui           @workspace/ui shadcn component library
packages/validation   Zod schemas for content validation
docker/               nginx.conf for the GCP deploy
```

## Commands

```bash
pnpm dev                              # turbo dev all apps
pnpm build                            # turbo build
pnpm typecheck                        # type-check all packages
pnpm lint                             # lint all packages
pnpm test                             # unit tests
```

Deploy: `Dockerfile.nginx` + `docker/nginx.conf` (static + SPA fallback).
