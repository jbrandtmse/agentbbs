// Unit tests for static serving + web-dist path resolution (Story 9.3, Task 4).
//
// Exercises the runtime dist-path resolution (env override + monorepo-root walk-up), the
// SPA fallback to index.html, path-traversal rejection, MIME typing, and the
// graceful "web not built" hint — against real temp-dir fixtures (no mocks).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStaticServer,
  resolveWebDist,
  WEB_DIST_ENV,
} from './static-assets.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-static-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveWebDist', () => {
  it('honors the AGENTBBS_WEB_DIST override verbatim', () => {
    const resolved = resolveWebDist({ [WEB_DIST_ENV]: dir });
    expect(resolved).toBe(dir);
  });

  it('walks up to the pnpm-workspace.yaml root and targets apps/web/dist', () => {
    // Build a fake monorepo: <root>/pnpm-workspace.yaml + a nested start dir.
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n');
    const nested = join(dir, 'packages', 'cli', 'dist', 'host');
    mkdirSync(nested, { recursive: true });
    const resolved = resolveWebDist({}, nested);
    expect(resolved).toBe(join(dir, 'apps', 'web', 'dist'));
  });
});

describe('createStaticServer', () => {
  it('serves a real file with the right MIME and SPA-falls-back to index.html', () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const server = createStaticServer(dir);

    const js = server.serve('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.contentType).toContain('text/javascript');
    expect(js.body?.toString('utf8')).toBe('console.log(1)');

    // `/` → index.html.
    expect(server.serve('/').body?.toString('utf8')).toContain('<title>app');
    // An unknown client route → SPA fallback to index.html (status 200).
    const route = server.serve('/rooms/calling-interface');
    expect(route.status).toBe(200);
    expect(route.body?.toString('utf8')).toContain('<title>app');
  });

  it('rejects path traversal outside the dist root', () => {
    writeFileSync(join(dir, 'index.html'), 'x');
    const server = createStaticServer(dir);
    const res = server.serve('/../../etc/passwd');
    // Either contained to a 404 or SPA-fallback'd, but NEVER reads outside root.
    expect(res.body?.toString('utf8') ?? '').not.toContain('root:');
  });

  it('returns a clear build hint when the web client is not built', () => {
    // Empty dir — no index.html.
    const server = createStaticServer(dir);
    const res = server.serve('/');
    expect(res.status).toBe(404);
    expect(res.body?.toString('utf8')).toContain('not built');
  });
});
