# 3. Rendering and hosting

Status: Accepted

## Context

A blog needs to be cheap to host, fast to load, and findable by search engines. The two axes are how pages render (client-side versus at build time) and how they are served (a running server versus static files).

## Decision

Build the app with Vite and serve the output as static files from an nginx container, with a single-page-app fallback so client routes resolve. Hosting is a static container: no application server to run or scale.

For search visibility, the documented upgrade path is static generation (prerendering each page to HTML at build time) so crawlers see real content and meta tags without executing JavaScript. The build stays the same shape; only the render step changes.

## Consequences

- Hosting is simple and portable. The same container runs anywhere that runs Docker.
- Load is fast: static assets behind nginx, cacheable at the edge.
- The current client-rendered setup is the weak point for SEO, which is why static generation is recorded here as the planned next step rather than left implicit.

## Alternatives considered

- **A Node server rendering on each request.** Rejected for a content site: more to run and scale than the traffic shape needs.
- **A managed platform with built-in rendering.** Reasonable, but the static container keeps hosting choices open and dependency-free.
