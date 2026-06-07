// VSIX packaging-readiness guard for the VS Code extension (Story 11.5, AC3 + reconciliation #1).
//
// AC3 requires the extension to package as a valid `.vsix` via `vsce package`. `vsce` rejects a
// scoped npm-style `name` and a `catalog:` version string for `@types/vscode`, and forbids combining
// a `.vscodeignore` with a `files` property — all three were hit empirically during dev and fixed.
// This test pins the resulting marketplace-valid config so a regression (a reintroduced scoped name,
// a `files` field, a removed `.vscodeignore` entry, a dropped `package:vsix` script) FAILS the gate
// rather than silently breaking `vsce package`.
//
// The ACTUAL `.vsix` production (`vsce package`) is heavy + environment-coupled (it shells out to
// vsce, reads node_modules) and is the lead's per-story smoke step — verified by the dev: a valid
// 1.88 MB `.vsix` was produced (9 files: dist/extension.cjs + webview assets + manifest + README,
// NO src/tests/maps), and the bundled `extension.cjs` contains `require("node:sqlite")` with ZERO
// live `require("better-sqlite3")` and no `*.node` (reconciliation #1 — the node:sqlite design needs
// no native prebuild). This test is the deterministic config half of that proof.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// This test file is at `apps/vscode-extension/src/`; one level up is the extension package root.
const EXT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface ExtManifest {
  name?: string;
  version?: string;
  publisher?: string;
  displayName?: string;
  description?: string;
  categories?: string[];
  engines?: { vscode?: string };
  main?: string;
  files?: string[];
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readExtManifest(): ExtManifest {
  return JSON.parse(
    readFileSync(join(EXT_ROOT, 'package.json'), 'utf8'),
  ) as ExtManifest;
}

describe('VSIX packaging readiness (AC3)', () => {
  const m = readExtManifest();

  it('the extension name is UNSCOPED (vsce rejects @scope/ names)', () => {
    expect(m.name).toBeDefined();
    expect(m.name).not.toMatch(/^@/); // no `@agentbbs/...` scope
    expect(m.name).toBe('agentbbs-vscode-extension');
  });

  it('the manifest carries the marketplace-required fields', () => {
    expect(m.version).toBe('0.1.0');
    expect(m.publisher).toBe('agentbbs');
    expect(m.engines?.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
    expect(m.main).toBe('./dist/extension.cjs');
    expect(m.displayName).toBeTruthy();
    expect(m.description).toBeTruthy();
    expect(Array.isArray(m.categories)).toBe(true);
    expect((m.categories ?? []).length).toBeGreaterThan(0);
  });

  it('@types/vscode is a real semver range (NOT a `catalog:` string vsce cannot parse)', () => {
    // vsce reads the raw devDependency string and parses it as semver; `catalog:` fails with
    // "Failed to parse semver of @types/vscode" (verified empirically during dev).
    const typesVscode = m.devDependencies?.['@types/vscode'];
    expect(typesVscode).toBeDefined();
    expect(typesVscode).not.toContain('catalog:');
    expect(typesVscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
  });

  it('has NO `files` property (vsce forbids combining `files` with a `.vscodeignore`)', () => {
    expect(m.files).toBeUndefined();
  });

  it('has a `package:vsix` script that invokes `vsce package`', () => {
    const script = m.scripts?.['package:vsix'];
    expect(script).toBeDefined();
    expect(script).toContain('vsce package');
  });

  it('declares @vscode/vsce as a dev dependency', () => {
    expect(m.devDependencies?.['@vscode/vsce']).toBeDefined();
  });

  it('ships a `.vscodeignore` that excludes src/tests/maps/host-tests from the .vsix', () => {
    const ignorePath = join(EXT_ROOT, '.vscodeignore');
    expect(existsSync(ignorePath)).toBe(true);
    const ignore = readFileSync(ignorePath, 'utf8');
    // The deny-list must drop source, the in-host harness, source maps, and tests.
    expect(ignore).toMatch(/^src\/\*\*/m);
    expect(ignore).toMatch(/^host-tests\/\*\*/m);
    expect(ignore).toContain('*.map');
    expect(ignore).toContain('esbuild.js');
  });

  it('ships a non-template README.md (vsce fails on the default yeoman README line)', () => {
    const readmePath = join(EXT_ROOT, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const readme = readFileSync(readmePath, 'utf8');
    expect(readme).not.toContain('This is the README for your extension');
    expect(readme).toContain('AgentBBS');
  });
});
