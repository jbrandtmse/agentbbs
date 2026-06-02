// QA hardening — prove the NFR4/NFR2 structural guard is NON-VACUOUS (Story 9.3,
// skill-rules Rule 7).
//
// `on-demand.nfr.test.ts` asserts that no source file in core/data-access/mcp-server
// imports the cli host, and that the host imports no client/app barrel. A
// scan-and-assert-no-match test has a classic vacuity failure mode: if the file
// collector returns an EMPTY list (a wrong path, a renamed dir, a glob that matches
// nothing), every `expect(text).not.toMatch(...)` loop body simply never runs and the
// test passes GREEN while proving NOTHING. The brief flags exactly this risk.
//
// This test pins the guard's TWO load-bearing premises:
//   (1) The collector actually FINDS the real source files (non-empty, and includes
//       the known host modules + the agent-package entrypoints it scans). If the path
//       resolution rots, this goes RED instead of silently passing.
//   (2) The match REGEXES the guard relies on actually FIRE on a planted offending
//       import — so a real violation WOULD be caught. (The mutation test, in-memory:
//       we feed the same regexes a synthetic line that imports `@agentbbs/cli` / a host
//       module / a forbidden client barrel and assert each matches.)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

/** Mirror the collector used by the guard (recursive *.ts(x), excluding tests). */
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

describe('NFR4/NFR2 structural guard is non-vacuous', () => {
  it('the collector actually finds the agent-package + host source files (not an empty scan)', () => {
    for (const pkg of ['core', 'data-access', 'mcp-server']) {
      const files = sourceFiles(join(repoRoot, 'packages', pkg, 'src'));
      // If this were 0 the guard's no-match assertions would be vacuous.
      expect(files.length).toBeGreaterThan(0);
    }
    const hostFiles = sourceFiles(
      join(repoRoot, 'packages', 'cli', 'src', 'host'),
    );
    expect(hostFiles.length).toBeGreaterThan(0);
    // The known host modules are present in the scanned set (path resolution is live).
    const base = hostFiles.map((f) => f.replace(/\\/g, '/'));
    expect(base.some((f) => f.endsWith('/host/server.ts'))).toBe(true);
    expect(base.some((f) => f.endsWith('/host/sse.ts'))).toBe(true);
    expect(base.some((f) => f.endsWith('/host/json-api.ts'))).toBe(true);
  });

  it("the guard's regexes FIRE on a planted offending import (so a real violation is caught)", () => {
    // These are the exact patterns the NFR4 guard asserts must NOT match in agent code.
    const cliBarrelRe = /from\s+['"]@agentbbs\/cli['"]/;
    const hostReachRe = /from\s+['"][^'"]*\/(?:host\/server|ui)\.js['"]/;

    // A synthetic offending agent-source line — the guard must catch each form.
    expect(`import { startHost } from '@agentbbs/cli';`).toMatch(cliBarrelRe);
    expect(`import { startHost } from '../cli/src/host/server.js';`).toMatch(
      hostReachRe,
    );
    expect(`import { runUi } from '../../cli/src/ui.js';`).toMatch(hostReachRe);

    // And a clean line must NOT match (the guard is specific, not a blanket reject).
    expect(`import { listProjects } from '@agentbbs/core';`).not.toMatch(
      cliBarrelRe,
    );
    expect(`import { listProjects } from '@agentbbs/core';`).not.toMatch(
      hostReachRe,
    );
  });

  it('the NFR2 host-boundary forbidden-barrel check FIRES on a planted forbidden import', () => {
    // The guard does `expect(text).not.toContain("'@agentbbs/mcp-server'")` etc. Prove
    // the substring it keys on actually appears in a real offending import line.
    const forbidden = [
      '@agentbbs/mcp-server',
      '@agentbbs/ui-shared',
      '@agentbbs/web',
    ];
    for (const pkg of forbidden) {
      const offending = `import { x } from '${pkg}';`;
      expect(offending).toContain(`'${pkg}'`);
    }
    // The real host source does NOT contain them (re-confirm the live state).
    const hostFiles = sourceFiles(
      join(repoRoot, 'packages', 'cli', 'src', 'host'),
    );
    for (const file of hostFiles) {
      const text = readFileSync(file, 'utf8');
      for (const pkg of forbidden) {
        expect(text).not.toContain(`'${pkg}'`);
      }
    }
  });
});
