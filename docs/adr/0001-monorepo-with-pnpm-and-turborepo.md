# 1. Monorepo with pnpm workspaces and Turborepo

Status: Accepted

## Context

The blog is more than a single app. It has a frontend plus shared code (a component library, and room for more shared packages). Keeping these in separate repositories means version drift, copy-paste, and a slow feedback loop when a shared change needs to land across packages.

## Decision

Use a single repository with pnpm workspaces for dependency linking and Turborepo for task orchestration. Shared packages live under `packages/`, applications under `apps/`. Workspace dependencies use the `workspace:*` protocol so local packages resolve to source, not a published version.

## Consequences

- One install, one lockfile, one place to run `build`, `typecheck`, and `lint` across everything.
- Turborepo caches task output and builds packages in parallel, so unchanged packages are skipped.
- A change to the component library is picked up by the app immediately, with no publish step.
- The tradeoff is a slightly heavier root setup (workspace config, shared TypeScript base) in exchange for that consistency.

## Alternatives considered

- **Separate repositories per package.** Rejected: version drift and a slow cross-package change loop.
- **A single flat app with no shared packages.** Rejected: the component library is worth isolating so its public surface stays deliberate.
