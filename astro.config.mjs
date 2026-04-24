import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://example-tile-store.netlify.app",
  output: "static",
  server: {
    host: true,
    port: 4321
  },
  vite: {
    css: {
      devSourcemap: true
    }
  }
});
