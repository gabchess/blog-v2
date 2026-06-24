# blog-v2

A modern blog frontend on a React and TypeScript monorepo, built around a shadcn design system and a static container deploy.

## What this is

A blog frontend organized as a small monorepo. The focus is front-end architecture: a shared design system the pages compose from, a typed build with Turborepo, and a static deploy. The design decisions behind it are written up as ADRs.

## Architecture

```
apps/
  web/            React 19 + Vite frontend (the blog)
packages/
  ui/             @workspace/ui  shadcn component library (Tailwind v4)
docker/           nginx config for a static deploy
```

Build flow:

```
content (headless CMS)
      |
      v
  Vite build  ->  static assets  ->  nginx (SPA fallback)
      |
      +-- @workspace/ui components (one design system)
```

Architecture decisions are written up in [`docs/adr`](./docs/adr).

## Engineering approach

- **Design system first.** Pages compose the shared `@workspace/ui` library instead of hand-rolling markup. Layout and hierarchy can change without touching the components or the color and type tokens, so one system can drive very different page designs.
- **Monorepo.** pnpm workspaces plus Turborepo build the packages in parallel with a shared TypeScript config.
- **Static container deploy.** The build produces static assets served by nginx with a single-page-app fallback, so hosting stays simple and portable.

## Stack

- React 19, TypeScript, Vite
- `@workspace/ui` (shadcn components, Tailwind v4)
- Headless CMS for content
- pnpm and Turborepo monorepo
- Static deploy via nginx (`Dockerfile.nginx`)

## Run locally

```bash
pnpm install
pnpm --filter @workspace/web dev    # dev server
pnpm build                          # build all packages
pnpm typecheck                      # type-check the workspace
pnpm lint                           # lint the workspace
```

## Repo notes

- `main` is the baseline app. Feature work happens on branches.
- Node 22 (pinned via `.nvmrc`). Workspace dependencies use `workspace:*`.
