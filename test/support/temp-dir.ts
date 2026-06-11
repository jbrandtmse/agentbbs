// Shared test-only temp-dir helper (Story 13.1).
//
// WHAT THIS IS (and is NOT): a SINGLE source of truth for the hermetic per-test
// temp-directory create + robust teardown seam used by the two recorded Windows
// temp-dir teardown flakes — the `data-access` `seed-protocol-race.test.ts`
// (`E10-baseline-seedrace-eperm`) and the `cli` `index.test.ts` import-dispatch
// negative path (`E12-postmerge`). It factors out the proven Story-11.0 best-effort
// retry/swallow semantics that previously lived ONLY in seed-protocol-race.test.ts's
// local `removeTempTree`, so the SAME robustness covers the CLI suite too. It invents
// NO new behavior — it is the byte-equivalent of that proven helper, lifted to one place
// so the removal logic is never duplicated (the drift anti-pattern).
//
// TEST-INFRA ONLY: this file is NOT under any package's `src` barrel and is never
// re-exported from a published `@agentbbs/*` package — it is imported by RELATIVE PATH
// from the two test files, so nothing ships in any package's public `dist`/`exports`
// (Rule 13 — the shipped API stays byte-identical). It carries no `*.test.ts` suffix, so
// the Vitest test globs (`packages/*/src/**/*.test.{ts,tsx}`, `apps/*/src/**/*.test.{ts,tsx}`)
// never collect it as a test.
//
// WHY THE SWALLOW IS LEGITIMATE (not a masked assertion): every temp dir created here
// lives under `os.tmpdir()` (OS-reclaimed), and the removal runs in `finally` AFTER the
// test's assertions have already passed. So a residual Windows `EPERM`/`ENOTEMPTY` from a
// just-released file handle (an AV/indexer, or a just-SIGKILL'd worker still releasing a
// `.db`/`-wal`/`-shm` handle) is teardown hygiene — NEVER an assertion. The worst case is
// a stray dir under the OS temp root, which the OS reclaims; it must not red a gate whose
// guarantee is fully proven.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create a hermetic per-test temp directory under `os.tmpdir()` and return its
 * absolute path. `prefix` is the `mkdtemp` template prefix (e.g.
 * `'agentbbs-export-dispatch-'`); the OS appends random characters, so each call is
 * unique. Wraps `mkdtempSync(join(tmpdir(), prefix))`.
 */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Remove a temp directory tree, robust to the Windows handle-release race.
 *
 * BEST-EFFORT / NON-FATAL (Story 11.0 AC1, factored out here): wide retry budget
 * (`maxRetries: 20, retryDelay: 50` ≈ 1s of handle-release grace) then SWALLOW a
 * residual removal error rather than let teardown fail the gate. The caller's
 * assertions have already passed by the time this runs; the dir lives under
 * `os.tmpdir()`, so the worst case is a stray temp dir the OS reclaims (never an
 * orphan in the repo). This is teardown hygiene, never an assertion — see the file
 * header for why the swallow is legitimate.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  } catch {
    // Best-effort: a lingering Windows handle on a temp-only dir must not fail a test
    // whose assertions already passed. The dir lives under os.tmpdir(); leave it for
    // the OS to reclaim rather than red the gate.
  }
}
