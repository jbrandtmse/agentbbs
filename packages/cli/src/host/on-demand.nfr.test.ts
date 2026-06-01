// NFR4 (on-demand / daemonless) + NFR2 (module boundary) structural guard (Story 9.3,
// Task 4).
//
// NFR4: the web host is ON-DEMAND — it starts ONLY when the operator runs `agentbbs ui`
// and stops when that process is killed. Nothing about an agent's MCP usage starts it.
// We prove this STRUCTURALLY: no source file in @agentbbs/core, @agentbbs/data-access, or
// @agentbbs/mcp-server imports the cli host (or the cli package at all) — so no agent
// code path can transitively reach `startHost`. The only entry to the host is the cli
// `ui` subcommand. (A behavioral counterpart is implicit: `createHost`/`startHost` are
// pure factory functions — importing the host module does not bind a port; only an
// explicit `startHost(...)` call does, which only `ui.ts` makes.)
//
// NFR2: the host is a THIN client — it imports @agentbbs/core + @agentbbs/data-access
// only; it carries no board logic. The web client (apps/web) imports @agentbbs/ui-shared
// only and speaks the JSON API (never core/data-access/SQL). The cli host source must NOT
// import a client/app package barrel.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..'); // packages/cli/src/host → repo root

/** Recursively collect *.ts(x) source files (excluding tests) under a directory. */
function sourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        walk(abs);
      } else if (
        (abs.endsWith('.ts') || abs.endsWith('.tsx')) &&
        !abs.endsWith('.test.ts') &&
        !abs.endsWith('.test.tsx')
      ) {
        out.push(abs);
      }
    }
  };
  walk(rootDir);
  return out;
}

describe('NFR4 — the host is on-demand (no agent path auto-starts it)', () => {
  const agentPackages = ['core', 'data-access', 'mcp-server'];

  for (const pkg of agentPackages) {
    it(`@agentbbs/${pkg} imports neither the cli host nor @agentbbs/cli`, () => {
      const srcDir = join(repoRoot, 'packages', pkg, 'src');
      for (const file of sourceFiles(srcDir)) {
        const text = readFileSync(file, 'utf8');
        // No import of the cli package (and therefore none of its host/ui modules).
        expect(text).not.toMatch(/from\s+['"]@agentbbs\/cli['"]/);
        // Belt-and-braces: no relative reach into a host/ui module name either.
        expect(text).not.toMatch(
          /from\s+['"][^'"]*\/(?:host\/server|ui)\.js['"]/,
        );
      }
    });
  }
});

describe('NFR2 — the host is a thin client; the web client speaks only the JSON API', () => {
  it('cli host source imports only @agentbbs/core + @agentbbs/data-access (no client/app barrels)', () => {
    const hostDir = join(repoRoot, 'packages', 'cli', 'src', 'host');
    const forbidden = [
      '@agentbbs/mcp-server',
      '@agentbbs/ui-shared',
      '@agentbbs/web',
      '@agentbbs/vscode-extension',
    ];
    for (const file of sourceFiles(hostDir)) {
      const text = readFileSync(file, 'utf8');
      for (const pkg of forbidden) {
        expect(text).not.toContain(`'${pkg}'`);
      }
    }
  });

  it('apps/web client source imports @agentbbs/ui-shared only — never core/data-access/SQL', () => {
    const webSrc = join(repoRoot, 'apps', 'web', 'src');
    for (const file of sourceFiles(webSrc)) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from\s+['"]@agentbbs\/core['"]/);
      expect(text).not.toMatch(/from\s+['"]@agentbbs\/data-access['"]/);
      expect(text).not.toMatch(/from\s+['"]better-sqlite3['"]/);
    }
  });
});
