import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://octant-blog-v2.vercel.app",
  // Pure static output per Q's threat-model direction (2026-05-16):
  // no serverless functions, no API endpoints, just prerendered HTML.
  // Sanity webhook triggers a full rebuild on content publish.
  output: "static",
  adapter: vercel(),
  integrations: [
    react(),
    sitemap(),
  ],
});
