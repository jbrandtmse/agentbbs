// Cross-process registration race (Story 2.2, Task 5 / AC #2) — THE FR1 ATOMIC
// PROOF. N independent OS PROCESSES each attempt to `register` the SAME handle
// against ONE shared SQLite ledger, simultaneously. The regressable guarantee:
// EXACTLY ONE wins (one identity.registered event), and every other process gets
// HANDLE_TAKEN — proving the uniqueness check + insert are atomic across processes
// (the appendGuarded BEGIN IMMEDIATE transaction), i.e. AC #2's "two concurrent
// registrations of the same handle cannot both succeed."
//
// Why real processes (not worker_threads): threads share one process + one
// better-sqlite3 address space, so they would NOT exercise cross-process WAL
// locking — the very mechanism that makes the guard atomic across processes. We
// fork the BUILT worker (dist/register-race-worker.js) as genuine OS processes via
// child_process.fork, with an IPC start barrier so all N hit the register together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before
// test; for a clean local `pnpm test` this file is BUILD-IF-MISSING/STALE
// (beforeAll rebuilds @agentbbs/data-access if the worker dist is missing/older
// than its source). It is named `*.test.ts`, co-located, and runs in the default
// Vitest project — the worker (`*-worker.ts`) is NOT matched by the test glob, so
// it is never collected as an empty test file (same structure as Story 1.7).
//
// Hygiene: every DB lives under os.tmpdir() (never the repo's .agentbbs/); the temp
// tree + spawned children are removed/killed in finally/afterEach — no orphans even
// on failure. A generous per-test timeout guards CI; runtime is well under a second.

import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { RaceWorkerResult } from './register-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'register-race-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'register-race-worker.js');

// N racers: modest but > 1 so SQLite must serialize the writers on the single
// write lock; 8 gives a healthy simultaneous contention on the one handle while
// keeping the run fast and non-flaky.
const N_WORKERS = 8;
const CONTESTED_HANDLE = 'contested-handle';
const TEST_TIMEOUT_MS = 60_000;

/** Live children, tracked so afterEach can reap any orphan on failure. */
const liveChildren = new Set<ChildProcess>();

/**
 * Fork one race worker and resolve with its single IPC `done` result. Resolves
 * only when BOTH a `done` message arrived AND the process exited 0; rejects on
 * spawn error, non-zero/signalled exit, or exit before a result. The worker emits
 * `ready` and waits for our `go` — surfaced via `onReady` for the start barrier.
 */
function forkWorker(
  args: { dbPath: string; workerId: number; handle: string },
  onReady: (child: ChildProcess) => void,
): Promise<RaceWorkerResult> {
  return new Promise<RaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [args.dbPath, String(args.workerId), args.handle],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: RaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as RaceWorkerResult;
      }
    });

    child.once('error', (err) => {
      liveChildren.delete(child);
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    });

    child.once('exit', (code, signal) => {
      liveChildren.delete(child);
      if (settled) return;
      settled = true;
      if (code === 0 && result) {
        resolvePromise(result);
      } else {
        rejectPromise(
          new Error(
            `worker ${args.workerId} exited code=${String(code)} signal=${String(
              signal,
            )} resultReceived=${String(Boolean(result))}`,
          ),
        );
      }
    });
  });
}

/** Kill any still-running children (defensive — no orphans even on failure). */
function reapChildren(): void {
  for (const child of liveChildren) {
    if (!child.killed) child.kill('SIGKILL');
  }
  liveChildren.clear();
}

/** Remove the temp DB tree, robust to the Windows handle-release race (see 1.7). */
function removeTempTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

/**
 * Run the N-way register race against a fresh DB and return both the per-worker
 * results and the folded ledger read back through the real read path. Implements
 * the START BARRIER: fork all N, wait until every one is `ready`, then broadcast
 * `go` so they all attempt the same register together.
 */
async function runRace(
  dbPath: string,
): Promise<{ results: RaceWorkerResult[]; registeredCount: number }> {
  // Pre-create + migrate the shared ledger once (avoids a concurrent-migrate herd).
  const seed = createDataAccess({ dbPath });
  seed.close();

  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<RaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id++) {
    workerPromises.push(
      forkWorker({ dbPath, workerId: id, handle: CONTESTED_HANDLE }, onReady),
    );
  }

  // Barrier: release all workers simultaneously once each has opened. Race against
  // the worker promises so a startup death surfaces now instead of a 60s hang.
  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  const results = await Promise.all(workerPromises);

  // Read the ledger back through the REAL read path and count the registrations
  // for the contested handle.
  const reader = createDataAccess({ dbPath });
  try {
    const events = await reader.eventsByType('identity.registered');
    const registeredCount = events.filter(
      (e) => e.actor === CONTESTED_HANDLE,
    ).length;
    return { results, registeredCount };
  } finally {
    reader.close();
  }
}

beforeAll(() => {
  // BUILD-IF-MISSING/STALE: the test forks the built worker. Ensure dist exists and
  // is at least as new as its source (see Story 1.7 concurrency.test.ts rationale).
  const needsBuild =
    !existsSync(WORKER_DIST) ||
    statSync(WORKER_DIST).mtimeMs < statSync(WORKER_SRC).mtimeMs;
  if (needsBuild) {
    const tscBin = resolve(
      PACKAGE_ROOT,
      '..',
      '..',
      'node_modules',
      'typescript',
      'bin',
      'tsc',
    );
    execFileSync(process.execPath, [tscBin, '-b', '--force', 'tsconfig.json'], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    });
  }
  expect(existsSync(WORKER_DIST)).toBe(true);
}, TEST_TIMEOUT_MS);

afterEach(() => {
  reapChildren();
});

describe('cross-process registration race (AC #2 — atomic uniqueness across processes)', () => {
  it(
    'N processes registering the SAME handle → EXACTLY ONE wins, the rest get HANDLE_TAKEN, ledger holds exactly one event',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-register-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const { results, registeredCount } = await runRace(dbPath);

        // Every worker reported a clean outcome: it either WON or saw HANDLE_TAKEN
        // (no worker ended in an ambiguous/unexpected state — those rethrow and
        // would have failed the run before reaching here).
        for (const r of results) {
          expect(r.won || r.handleTaken).toBe(true);
          // Exactly one of the two is true per worker.
          expect(r.won && r.handleTaken).toBe(false);
        }

        const winners = results.filter((r) => r.won);
        const losers = results.filter((r) => r.handleTaken);

        // EXACTLY ONE winner; everyone else lost cleanly with HANDLE_TAKEN.
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(N_WORKERS - 1);

        // The ledger holds EXACTLY ONE identity.registered for the contested handle
        // — the atomic guard prevented every concurrent duplicate (the core claim).
        expect(registeredCount).toBe(1);

        // The single winner read back a real created_at (the data-access-assigned
        // timestamp), proving the winning path completed the full register op.
        expect(typeof winners[0]?.createdAt).toBe('string');
        expect(new Date(winners[0]!.createdAt as string).toISOString()).toBe(
          winners[0]!.createdAt,
        );
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );
});
