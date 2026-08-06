import { defineConfig } from 'vite';

// `base` matters for GitHub Pages, which serves from /<repo>/ rather than /.
// Set GH_PAGES_BASE in the deploy workflow (M2); local dev stays at '/'.
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? '/',
  server: { host: true },
  build: { target: 'es2022' },
});
