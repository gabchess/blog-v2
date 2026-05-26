# ADR-505: Nginx for Frontend Static File Hosting

## Status
Accepted

## Context

Frontend applications in the monorepo (Web, Admin, Widget, QF Simulator) are built into static JS/CSS/HTML bundles by Vite. These files must be served to end users in production and staging environments.

The previous approach used Node.js — a Node process running a simple HTTP server (e.g. `serve`, `express.static`) would read and forward the static assets. This introduces unnecessary overhead:

1. **Image size.** A `node:slim` base image weighs ~180–200 MB. For an app that only serves static files, this is wasted. `nginx:trixie` weighs ~50–60 MB — roughly three times smaller.

2. **Performance.** Nginx is a purpose-built, event-driven HTTP server written in C, optimised for serving static files at high concurrency. Running a Node.js process for the same task adds a JS runtime, garbage collector, and thread pool for no benefit.

3. **No Node.js needed at runtime.** After `pnpm turbo build`, the output is fully static — no SSR, no API routes, no Node.js logic to execute. Node.js is only needed during the build stage.

## Decision

All frontend applications producing static output are served by **Nginx**, not Node.js.

Each frontend app's production container uses the **official `nginx` image** (currently `nginx:${NGINX_VERSION}-trixie`) as the final stage, with a custom configuration file (`docker/nginx.conf`) versioned in the repository.

The build follows a **multi-stage Dockerfile** (`Dockerfile.nginx`):

```
Stage 1: base        — node:slim + pnpm (shared build tooling)
Stage 2: pruner      — turbo prune @octant/<APP> --docker
Stage 3: builder     — pnpm fetch + install + pnpm turbo build
Stage 4: production  — nginx:trixie, copies dist/, no Node.js
```

Node.js is used exclusively in stages 1–3. The final image contains only Nginx and the built static files.

The custom `docker/nginx.conf`:
- Serves files from `/app` (the `WORKDIR` of the production stage)
- SPA routing: `try_files $uri /index.html` for client-side navigation
- Long-lived cache headers (`expires 1y`) for hashed assets under `/assets`, `/fonts`, `/images`, `/favicon`
- Health check endpoint at `/healthcheck` (returns `200 healthy`)
- Metrics endpoint at `:8080/stub_status` (for scraping by monitoring agents)
- All temp paths redirected to `/tmp` so the container runs as the unprivileged `nginx` user
- Default entrypoint scripts cleared (`/docker-entrypoint.d/*`) — the config is self-contained

## Alternatives Considered

### Node.js with `serve` or `express.static`
- **Pros:** uniform ecosystem, no Nginx knowledge required
- **Cons:** image ~3–4× larger; running a JS process just to read files from disk; higher memory footprint; extra failure surface
- **Why rejected:** Node.js provides zero value at runtime for fully static output; all the overhead is pure waste

### Caddy
- **Pros:** automatic HTTPS, clean config format, small image
- **Cons:** less widespread adoption, fewer operational resources, non-standard dependency for this use case
- **Why rejected:** Nginx is the de facto standard for static file serving; the team has existing familiarity; the official image is well-maintained and ubiquitous

### CDN / object storage (S3 + CloudFront)
- **Pros:** no server to operate, global edge, very low cost
- **Cons:** additional infrastructure dependencies; more complex setup for non-production environments (staging, review apps); CORS and security headers managed on the CDN side
- **Why rejected:** out of scope for current containerisation strategy; a CDN can be placed in front of Nginx without any change to the container

## Consequences

### Positive
- Final image size drops from ~180 MB to ~55 MB (~70% reduction).
- Faster image pull on deploy, shorter container start time.
- Better static file throughput at high concurrency.
- `docker/nginx.conf` is versioned alongside application code — auditable and reviewable in PRs.
- Multi-stage build ensures Node.js artefacts (`node_modules`, pnpm store, build cache) never reach the production image.
- `NPM_REGISTRY_TOKEN` and `SENTRY_AUTH_TOKEN` are mounted as Docker secrets in the builder stage only — they are never baked into the production image.

### Negative
- Developers need basic familiarity with Nginx configuration.
- Local dev still uses Vite dev server (Node.js) — a deliberate difference between `dev` and `prod` at the serving layer.
- SPA fallback (`try_files`) must be explicitly configured; easy to omit when bootstrapping a new app from this template.

### Risks
- **Stale `index.html` after deploy** if cache headers are misconfigured. Mitigation: `index.html` is served with `expires 0`; only hashed asset paths get long-lived cache headers.
- **Config drift between apps** if each app copies `nginx.conf` and diverges. Mitigation: a single `docker/nginx.conf` is shared across all frontend apps via `COPY docker/nginx.conf /etc/nginx/nginx.conf` in `Dockerfile.nginx`.

## References

- `Dockerfile.nginx` — multi-stage build implementing this decision
- `docker/nginx.conf` — shared Nginx configuration
- ADR-504: Environment Variable and Service Management
- [nginx on Docker Hub](https://hub.docker.com/_/nginx)
