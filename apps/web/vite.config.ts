// Vite build config for @agentbbs/web (Story 9.3).
//
// The on-demand web control room client. Vite 8 + @vitejs/plugin-react 6 (React 19.2
// automatic JSX runtime). `vite build` emits a static `dist/` (index.html + hashed
// asset bundles) which the cli host serves by runtime path resolution (NOT a workspace
// import — apps/web is a pure client). Verified against the installed Vite 8 config API
// (Research-First): the minimal `defineConfig({ plugins: [react()] })` shape is unchanged
// from Vite 5/6; default `build.outDir` is `dist`; Node 24 is in range.
//
// `base: './'` makes the emitted asset URLs RELATIVE so the bundle is location-agnostic
// (the host serves it at `/`, but relative paths survive any mount point + the SPA
// fallback). The client speaks ONLY the host's JSON API + SSE (same origin) — it never
// imports @agentbbs/core / @agentbbs/data-access and never speaks MCP or SQL (NFR2).

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Fail the build loudly if an asset is unexpectedly large (sanity, not a product
    // constraint) — keeps the operator-served bundle lean.
    chunkSizeWarningLimit: 1000,
  },
});
