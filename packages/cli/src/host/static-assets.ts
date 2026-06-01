// Static serving of the built apps/web client (Story 9.3, Task 2).
//
// The host serves apps/web's BUILT static assets by RUNTIME PATH RESOLUTION — NOT a
// workspace import (project-context.md / story Dev Notes → Host package home). This
// keeps the NFR2 module boundary clean: cli depends on @agentbbs/core +
// @agentbbs/data-access only; apps/web is a pure client whose `dist/` the host locates
// at runtime. There is NO cli→apps/web (or apps/web→cli) package dependency.
//
// DIST PATH RESOLUTION (documented):
//   1. `AGENTBBS_WEB_DIST` env override → use it verbatim (deploy/test escape hatch).
//   2. Otherwise, walk up from this module's directory to the monorepo root (the dir
//      with `pnpm-workspace.yaml`) and use `<root>/apps/web/dist`.
// The built host runs from `packages/cli/dist/host/static-assets.js`, so the walk-up
// finds the same workspace root the dev tree has. If the web build is missing, the host
// still serves the JSON API + SSE; a GET for a client asset returns a clear 404 telling
// the operator to build apps/web first (rather than a confusing blank page).
//
// SPA FALLBACK: any non-`/api/` GET that does not resolve to a real file under the dist
// root falls back to `index.html` (client-side routing). A path-traversal attempt
// (`..`) outside the dist root is rejected (404) — defense even though the operator
// owns this host.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The env var that overrides web-dist discovery with a verbatim path. */
export const WEB_DIST_ENV = 'AGENTBBS_WEB_DIST';

/** A resolved static asset to serve, or a not-found signal. */
export interface StaticResult {
  status: number;
  /** The file bytes (omitted on 404). */
  body?: Buffer;
  /** The Content-Type header (omitted on 404). */
  contentType?: string;
}

/** Minimal extension→MIME map (the apps/web build emits this small set). */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/**
 * Resolve the apps/web `dist/` directory by runtime path resolution (see header).
 * Pure resolution — does NOT assert the directory exists (the caller handles a
 * missing build gracefully).
 *
 * @param env The environment to read the override from (injectable for tests).
 * @param fromDir The directory to begin the monorepo-root walk-up from (injectable
 *   for tests). Defaults to this module's directory.
 * @returns The absolute path the host will serve client assets from.
 */
export function resolveWebDist(
  env: Record<string, string | undefined> = process.env,
  fromDir?: string,
): string {
  const override = env[WEB_DIST_ENV];
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }
  const start = fromDir ?? dirname(fileURLToPath(import.meta.url));
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return join(current, 'apps', 'web', 'dist');
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root — no workspace marker found
    current = parent;
  }
  // Fallback: assume the conventional layout relative to the start dir's likely root.
  return join(resolve(start), 'apps', 'web', 'dist');
}

/** Create a static-asset server bound to a resolved dist root (with SPA fallback). */
export function createStaticServer(distRoot: string): {
  /**
   * Serve the asset at `path` (the request pathname). A real file under `distRoot`
   * is returned with its MIME type; otherwise the SPA `index.html` is returned
   * (client routing). If even `index.html` is absent (web not built), a 404 with a
   * build hint is returned. A traversal outside `distRoot` is a 404.
   */
  serve(path: string): StaticResult;
} {
  const root = resolve(distRoot);

  function readIfFile(absPath: string): StaticResult | null {
    try {
      if (existsSync(absPath) && statSync(absPath).isFile()) {
        return {
          status: 200,
          body: readFileSync(absPath),
          contentType: mimeFor(absPath),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  return {
    serve(path: string): StaticResult {
      // Normalize + contain to the dist root (reject traversal).
      const relative = path === '/' ? '/index.html' : path;
      const candidate = resolve(root, `.${normalize(relative)}`);
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        return { status: 404 };
      }

      const direct = readIfFile(candidate);
      if (direct !== null) return direct;

      // SPA fallback → index.html (client-side routing).
      const indexPath = join(root, 'index.html');
      const index = readIfFile(indexPath);
      if (index !== null) return index;

      // Web build absent — serve a clear hint rather than a blank page.
      return {
        status: 404,
        body: Buffer.from(
          'AgentBBS web client not built. Run `pnpm --filter @agentbbs/web build` (or `pnpm run ui`) first.\n',
          'utf8',
        ),
        contentType: 'text/plain; charset=utf-8',
      };
    },
  };
}
