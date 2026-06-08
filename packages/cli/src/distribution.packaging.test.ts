// npm publish-readiness guard for the publishable package set (Story 11.5, AC1 + AC2).
//
// AC1 requires @agentbbs/core, @agentbbs/data-access, @agentbbs/mcp-server, and @agentbbs/cli to be
// npm-publish-READY: a real semver version, NOT `private`, scoped-public publish access, and correct
// `files`/`bin`/`main`/`exports`. This test pins those manifest facts to the actual package.json on
// disk so a regression (a reintroduced `private: true`, a version reset to 0.0.0, a dropped `bin`, a
// `files` that forgets the bundled web client) FAILS the gate instead of silently shipping an
// unpublishable or broken tarball.
//
// What is intentionally NOT asserted here: the `pnpm pack` tarball production + the `workspace:` /
// `catalog:` → real-version rewrite. That rewrite is pnpm's pack/publish behaviour (verified by the
// dev via `pnpm --filter <pkg> pack` — all four produced valid 0.1.0 tarballs with every
// `workspace:*` rewritten to `0.1.0` and every `catalog:` rewritten to its concrete version, no
// specifier leaking into the packed manifest; the cli tarball carried 304 web-dist assets + dist +
// bin). Spawning `pnpm pack` inside the unit suite is heavy and environment-coupled; the static
// manifest readiness below is the deterministic, repeatable half of the AC, and the pack dry-run is
// the lead's smoke step (documented in the story Dev Agent Record).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// This test file is at `packages/cli/src/`; three levels up is the repo root.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: { access?: string };
  files?: string[];
  bin?: Record<string, string>;
  main?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
}

function readManifest(relPkgDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, relPkgDir, 'package.json'), 'utf8'),
  ) as Manifest;
}

/** The four packages that AC1 requires to be npm-publish-ready. */
const PUBLISHABLE = [
  'packages/core',
  'packages/data-access',
  'packages/mcp-server',
  'packages/cli',
] as const;

describe('npm publish-readiness (AC1)', () => {
  for (const pkgDir of PUBLISHABLE) {
    describe(pkgDir, () => {
      const m = readManifest(pkgDir);

      it('has a real semver version (not the 0.0.0 placeholder)', () => {
        expect(m.version).toBeDefined();
        expect(m.version).not.toBe('0.0.0');
        // semver major.minor.patch shape.
        expect(m.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      });

      it('is publishable: not private, scoped-public access', () => {
        // `private: true` blocks `npm publish` entirely. It must be absent (or false).
        expect(m.private ?? false).toBe(false);
        // Scoped `@agentbbs/*` names default to RESTRICTED on the registry; publishConfig
        // makes the first publish public without a manual `--access public`.
        expect(m.publishConfig?.access).toBe('public');
      });

      it('ships only the built dist (+ declared extras), main, and exports', () => {
        expect(m.files).toBeDefined();
        expect(m.files).toContain('dist');
        expect(m.main).toBe('./dist/index.js');
        expect(m.exports).toBeDefined();
      });
    });
  }

  it('mcp-server exposes the agentbbs-mcp-server bin → dist/main.js (AC1/AC5)', () => {
    const m = readManifest('packages/mcp-server');
    expect(m.bin?.['agentbbs-mcp-server']).toBe('./dist/main.js');
  });

  it('cli exposes the agentbbs bin → dist/index.js (AC1/AC5)', () => {
    const m = readManifest('packages/cli');
    expect(m.bin?.['agentbbs']).toBe('./dist/index.js');
  });

  it('cli ships the bundled web client (web-dist) so an npm-installed `agentbbs ui` serves the UI (AC2)', () => {
    const m = readManifest('packages/cli');
    // The packaged web client must be in `files`, else the published tarball omits the UI and
    // `agentbbs ui` 404s on every asset when installed from npm (the AC2 gap).
    expect(m.files).toContain('web-dist');
  });

  it('the in-repo source deps use workspace:/catalog: specifiers (pnpm rewrites them at pack time)', () => {
    // The agent contract (Rule 13) is unaffected by packaging; these are the cross-package links
    // pnpm rewrites to concrete versions when packing/publishing. Asserting the SOURCE form here
    // documents that the rewrite is what makes the packed manifest leak-free (verified by the dev's
    // pack dry-run). A source dep accidentally pinned to a literal stale version would show here.
    const mcp = readManifest('packages/mcp-server');
    expect(mcp.dependencies?.['@agentbbs/core']).toBe('workspace:*');
    expect(mcp.dependencies?.['@agentbbs/data-access']).toBe('workspace:*');
    const da = readManifest('packages/data-access');
    expect(da.dependencies?.['@agentbbs/core']).toBe('workspace:*');
    expect(da.dependencies?.['better-sqlite3']).toBe('catalog:');
  });
});
