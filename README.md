# Octant Blog v2

Static-first Astro rebuild of the Octant blog, replacing Next.js.

---

## Why this exists

Q's threat-model direction (2026-05-16 meeting): a public blog should serve pre-rendered HTML files and nothing else. Next.js adds a server runtime and API endpoints the blog never needs, and any of those endpoints is a hackable surface. The worst that can happen to pure static HTML is that someone pushes a broken page; rolling back is `git revert`.

Astro keeps the Sanity integration, preserves React components when something genuinely benefits from a client island, and ships zero JavaScript for static pages by default. The output mode is `static`: every page is prerendered at build time, no serverless functions, no `/api/` routes. A Sanity webhook to a Vercel deploy hook triggers a fresh build whenever a post is published.

---

## Stack

- **Astro 5.x** with `output: "static"`: every page prerendered at deploy time
- **@sanity/client** direct fetch at build time: editors use Sanity Studio at sanity.io; Studio Presentation dropped to cut complexity
- **@astrojs/react**: React island support for future interactive components
- **@astrojs/sitemap** and **@astrojs/rss**: sitemap and RSS at build time
- **Substack**: newsletter subscribe lives entirely off-repo; the blog links to it, no endpoint to maintain

---

## Quick start

```bash
git clone https://github.com/gabchess/blog-v2
cd blog-v2
socket npm install   # bare npm install also works; socket adds supply-chain verification
cp .env.example .env.local
npm run dev          # http://localhost:4321
```

The defaults in `.env.example` point at the live Octant Sanity project. The site renders without any local secrets.

---

## Project structure

```
blog-v2/
├── astro.config.mjs          # Astro config: output static, Vercel adapter, integrations
├── .env.example              # Required environment variables (copy to .env.local)
├── src/
│   ├── layouts/
│   │   └── Base.astro        # Root layout: fonts, global CSS, meta tags
│   ├── lib/
│   │   ├── sanity.ts         # Sanity client initialisation
│   │   └── queries.ts        # GROQ queries for posts and site content
│   ├── pages/
│   │   ├── index.astro       # Homepage: post list
│   │   └── blog/
│   │       └── [slug].astro  # Individual post pages (prerendered via getStaticPaths)
│   └── styles/
│       └── globals.css       # Design tokens, font-face declarations, base styles
```

No `src/pages/api/` directory by design. The Substack link in `src/pages/blog/[slug].astro` handles newsletter subscribe with zero serverless surface.

---

## Environment variables

Copy `.env.example` to `.env.local`. All variables are public Sanity config; there are no secrets.

- `PUBLIC_SANITY_PROJECT_ID`: Sanity project ID (safe to expose, bundled into client)
- `PUBLIC_SANITY_DATASET`: Sanity dataset name, e.g. `production`
- `PUBLIC_SANITY_API_VERSION`: API version date, e.g. `2024-01-01`

`src/lib/sanity.ts` carries the same values as `?? "default"` fallbacks so the build works without any env file at all.

---

## Deployment

Connected to Vercel via the GitHub integration. Pushes to any branch trigger a preview deployment. Production: merge to `main` or run `vercel --prod` locally.

Vercel project: `octant-blog-v2`. Preview URLs surface on each push in the GitHub PR conversation; production URL lives under the project settings.

---

## Sanity webhook (manual setup, post-Tuesday)

To rebuild the static site when a post is published, configure a webhook in [manage.sanity.io](https://manage.sanity.io):

- **Filter**: `_type == "post" && !(_id in path("drafts.**"))` (published posts only, draft autosaves excluded)
- **URL**: Vercel deploy hook URL (Settings > Git in the Vercel dashboard)
- **HTTP method**: POST

Without this webhook, new posts appear after the next manual deploy. With it, a published post triggers a fresh build within seconds.

---

## Newsletter subscribe (Substack)

Each post page links to [octant.substack.com](https://octant.substack.com/) for newsletter signup. Substack hosts the subscribe surface, the list, and the delivery. Nothing in this codebase touches email infrastructure.

Rationale: any newsletter endpoint we ship is a server endpoint we have to maintain, monitor, and secure. Moving subscribe off-repo keeps this codebase purely static and removes an entire attack surface.

---

## Open questions for Q (2026-05-26 pair)

Left open for the Tuesday review session. Not questions for general contributors.

1. **React component reuse**: is React island support a hard constraint, or negotiable given Vitalik's no-React reference site as a north star?
2. **Interactivity scope**: with the subscribe form moved to Substack, is any client-side surface still needed?
3. **Vercel vs $5 VPS behind Cloudflare**: now that the site is pure static (no serverless functions, no ISR), how close do we want to get to Vitalik's rsync deployment model?

---

## Branding state

Inter and IBM Plex Mono load via Google Fonts and are working. Canela (the display typeface) requires a commercial licence file from Colophon Foundry, not yet delivered. Inter Bold substitutes for Canela in display contexts until then. Marked as TODO in `src/styles/globals.css`.

---

## Licence and acknowledgements

Copyright Octant Labs. All rights reserved. Contact the Octant Labs team for redistribution and reuse terms.
