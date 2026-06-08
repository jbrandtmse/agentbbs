#!/usr/bin/env node
// Copy the built apps/web client into the cli package's own published files (Story 11.5, AC2).
//
// `agentbbs ui` serves the apps/web `dist/` static assets. In the dev monorepo the host finds
// them by a runtime walk-up to `<root>/apps/web/dist` (packages/cli/src/host/static-assets.ts).
// But when `@agentbbs/cli` is installed FROM NPM there is no monorepo and no `apps/web` — the
// assets must travel INSIDE the cli tarball. This script copies `apps/web/dist` into
// `packages/cli/web-dist/`, which is listed in the cli package `files` so `pnpm pack`/`publish`
// includes it. The resolver (`resolveWebDist`) checks this packaged location too.
//
// Run at `build` (so `pnpm run ui` and tests see the packaged layout) and at `prepack` (so the
// published tarball carries the assets). It is a best-effort, NON-FATAL copy: if `apps/web/dist`
// is absent (web not built yet), it logs and exits 0 — `build` of the cli must not hard-require a
// prior web build in every dev flow. The packaged-layout RESOLUTION is what the AC pins; this copy
// is the population step.

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/cli/scripts → packages/cli
const cliRoot = resolve(here, '..');
// packages/cli → repo root
const repoRoot = resolve(cliRoot, '..', '..');

const source = join(repoRoot, 'apps', 'web', 'dist');
const dest = join(cliRoot, 'web-dist');

if (!existsSync(source)) {
  process.stdout.write(
    `[copy-web-dist] apps/web/dist not found at ${source} — skipping ` +
      `(build apps/web first to bundle the UI into the cli tarball).\n`,
  );
  process.exit(0);
}

// Replace any stale copy so a removed web asset does not linger in the packaged dir.
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });
process.stdout.write(`[copy-web-dist] copied ${source} → ${dest}\n`);
