// Direct test of the shared test-only temp-dir helper (Story 13.1 QA).
//
// WHY THIS TEST EXISTS: Story 13.1's deliverable is a SHARED test-support helper
// (`test/support/temp-dir.ts`) whose robustness is the load-bearing fix for the two
// recorded Windows temp-dir teardown flakes (`E10-baseline-seedrace-eperm`,
// `E12-postmerge`). The two consumer suites (`seed-protocol-race.test.ts`,
// `cli/index.test.ts`) exercise the helper's create/teardown seam, but only as a side
// effect of their own assertions — they prove the SUITES are green, not that the
// helper's contract holds. This test pins the helper's two load-bearing properties
// DIRECTLY and discoverably:
//
//   1. makeTempDir(prefix) → a hermetic, UNIQUE directory under os.tmpdir() (so two
//      concurrent tests never collide and nothing lands in the repo tree), with the
//      requested prefix preserved.
//   2. removeTempDir(dir) → removes a real tree, AND — the load-bearing teardown-flake
//      property — SWALLOWS a residual removal error (best-effort) rather than THROWING.
//      Teardown must never fail the gate (a red gate must mean a real regression, not a
//      Windows handle-release race); the dir is under os.tmpdir(), OS-reclaimed.
//
// DISCOVERABILITY (Rule 8): this file is co-located under packages/data-access/src and
// named *.test.ts, so the ROOT `pnpm test` collects it via the `packages/*/src/**/*.test.ts`
// project glob. The helper itself (test/support/temp-dir.ts) is NOT matched by any glob and
// is imported by relative path here exactly as the two consumer suites import it — it ships
// in no package's public dist/exports (Rule 13). This test is node-env (default project).

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Same relative import the two consumer suites use (../../../test/support/temp-dir.js
// from packages/data-access/src). Proves the shared helper resolves from a collected test.
import { makeTempDir, removeTempDir } from '../../../test/support/temp-dir.js';

describe('shared temp-dir helper (Story 13.1)', () => {
  describe('makeTempDir', () => {
    it('creates a real directory under os.tmpdir()', () => {
      const dir = makeTempDir('agentbbs-qa-mk-');
      try {
        expect(existsSync(dir)).toBe(true);
        expect(statSync(dir).isDirectory()).toBe(true);
        // Hermetic: the dir lives under the OS temp root, NEVER in the repo tree
        // (so a leaked dir is OS-reclaimed, never an orphan under .agentbbs/ or the workspace).
        expect(dirname(dir).startsWith(tmpdir())).toBe(true);
      } finally {
        removeTempDir(dir);
      }
    });

    it('preserves the requested prefix and is unique per call', () => {
      const a = makeTempDir('agentbbs-qa-uniq-');
      const b = makeTempDir('agentbbs-qa-uniq-');
      try {
        // Prefix preserved (mkdtemp appends random chars after it).
        expect(basename(a).startsWith('agentbbs-qa-uniq-')).toBe(true);
        expect(basename(b).startsWith('agentbbs-qa-uniq-')).toBe(true);
        // Two calls with the same prefix never collide — the per-test hermetic guarantee
        // that lets parallel suites share a prefix without racing the same path.
        expect(a).not.toBe(b);
      } finally {
        removeTempDir(a);
        removeTempDir(b);
      }
    });
  });

  describe('removeTempDir', () => {
    it('removes a real, non-empty tree (files + nested dirs)', () => {
      const dir = makeTempDir('agentbbs-qa-rm-');
      // Plant real content so removal is the recursive `rmSync`, not a trivial empty unlink.
      const nested = join(dir, 'a', 'b');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'leaf.txt'), 'content');
      writeFileSync(join(dir, 'top.txt'), 'content');

      removeTempDir(dir);

      expect(existsSync(dir)).toBe(false);
    });

    it('is idempotent on an already-removed dir (no throw)', () => {
      const dir = makeTempDir('agentbbs-qa-gone-');
      removeTempDir(dir);
      expect(existsSync(dir)).toBe(false);
      // Calling again on a now-absent path must NOT throw (force:true ignores ENOENT).
      expect(() => removeTempDir(dir)).not.toThrow();
    });

    // THE LOAD-BEARING PROPERTY (the whole point of Story 13.1): a residual removal error
    // must be SWALLOWED, never thrown — teardown must never fail the gate. We provoke a
    // genuine error from the underlying `rmSync` (an invalid path argument — the
    // deterministic, cross-platform stand-in for the non-deterministic Windows EPERM/ENOTEMPTY
    // handle-release race the helper exists to absorb) and assert removeTempDir does NOT throw.
    it('SWALLOWS a residual removal error instead of throwing (best-effort teardown)', () => {
      // `undefined` makes node:fs `rmSync` throw synchronously (ERR_INVALID_ARG_TYPE),
      // regardless of OS — exercising the helper's try/catch swallow exactly as a residual
      // Windows EPERM would. If the catch were removed, this throws and the gate reds.
      expect(() => removeTempDir(undefined as unknown as string)).not.toThrow();
    });
  });
});
