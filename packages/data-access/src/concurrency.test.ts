// Multi-process concurrency verification (Story 1.7, AC1/AC2) — THE CORRECTNESS GATE.
//
// This is the single most load-bearing test in the project: it proves NFR3/NFR10 —
// that N independent OS PROCESSES appending to ONE shared SQLite ledger lose no
// writes and receive a strict total order — BEFORE any later epic builds a
// projection on `seq`. It exercises the whole Epic 1 ledger stack end to end
// (connection 1.4 + append 1.5 + reads 1.6) under REAL multi-process concurrency.
//
// Why real processes (not worker_threads): worker_threads share one process and one
// better-sqlite3 address space, so they would NOT faithfully exercise cross-process
// WAL locking + busy_timeout — the very thing under test. We fork the BUILT worker
// (dist/concurrency-worker.js) as genuine OS processes via child_process.fork, which
// also gives us an IPC channel for the start barrier + result collection for free.
//
// Build dependency (Rule 8 discoverability): the test forks a BUILT artifact. In CI
// the `build` step precedes `test` (.github/workflows/ci.yml), so the worker exists.
// For a clean local `pnpm test` the worker may be absent or stale, so this file is
// BUILD-IF-MISSING/STALE: beforeAll builds @agentbbs/data-access if the worker dist
// is missing or older than its source. The test therefore runs green in the default
// `pnpm test` AND in CI from a clean checkout — it is named `*.test.ts`, co-located,
// and not excluded/tagged-out (it runs in the default Vitest project).
//
// Hygiene: every DB lives under os.tmpdir() (never the repo's .agentbbs/); the temp
// tree (DB + -wal/-shm sidecars) is removed and every spawned child is killed in
// finally/afterEach — no orphans even on failure. A generous explicit per-test
// timeout guards CI; runtime is seconds.
//
// Researched 2026-05-30 (Node 24 child_process.fork of an ESM dist worker; awaiting
// exit + collecting IPC failures; better-sqlite3 SQLITE_BUSY across processes under
// WAL; Vitest per-test timeout + child-process cleanup). See concurrency-worker.ts.

import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { WorkerResult } from './concurrency-worker.js';
import type { Event } from '@agentbbs/core';

// ---------------------------------------------------------------------------
// Paths. This test runs from src/ under Vitest (esbuild, uncompiled), so
// import.meta.url points into packages/data-access/src. The forked worker is the
// BUILT artifact under the sibling dist/.
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'concurrency-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'concurrency-worker.js');

// ---------------------------------------------------------------------------
// N×M tuning. Faithful enough to induce real cross-process contention, small
// enough to stay fast and non-flaky in CI (runtime: seconds).
//   - N writers = 6: comfortably more than one writer so SQLite must serialize
//     them (single-writer lock), but light enough that the bounded retry + 5s
//     busy_timeout reliably win — no StoreBusyError at this scale.
//   - M events per writer = 100: 600 total appends; enough sustained write traffic
//     after a synchronized barrier that contention genuinely occurs, while the run
//     finishes in well under a second of actual append work.
//   - LOCK_HOLD_MS = 150 (AC2 only): writer 0 holds a real BEGIN IMMEDIATE write
//     lock for 150ms after the barrier, deterministically forcing the other 5
//     writers' first appends to wait on a held lock — guaranteeing the busy path is
//     traversed every run, not left to interleaving luck. 150ms is well within the
//     5000ms busy_timeout, so the retry/timeout always resolves it (margin ~33x).
// ---------------------------------------------------------------------------
const N_WRITERS = 6;
const M_EVENTS = 100;
const EXPECTED_TOTAL = N_WRITERS * M_EVENTS;
const LOCK_HOLD_MS = 150;
const TEST_TIMEOUT_MS = 60_000;

/** Live children, tracked so afterEach can reap any orphan on failure. */
const liveChildren = new Set<ChildProcess>();

/**
 * Fork one worker process and resolve with its single IPC `done` result.
 *
 * Resolves only when BOTH a `done` message arrived AND the process exited 0;
 * rejects on spawn error, non-zero/ signalled exit, or exit before a result. The
 * worker also emits a `ready` message and waits for our `go` — captured via the
 * `onReady` callback so the orchestrator can implement the start barrier.
 */
function forkWorker(
  args: {
    dbPath: string;
    writerId: number;
    eventCount: number;
    holdLockMs: number;
  },
  onReady: (child: ChildProcess) => void,
): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [
        args.dbPath,
        String(args.writerId),
        String(args.eventCount),
        String(args.holdLockMs),
      ],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: WorkerResult | undefined;
    let exited = false;
    let settled = false;

    const settle = (): void => {
      if (settled || !exited) return;
      // Only finalize once the process has exited; success requires a result too.
      settled = true;
      if (result) resolvePromise(result);
      // If we reach here exited===true but no result, the exit handler already
      // rejected below; nothing to do.
    };

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as WorkerResult;
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
      exited = true;
      if (settled) return;
      if (code === 0 && result) {
        settle();
      } else {
        settled = true;
        rejectPromise(
          new Error(
            `writer ${args.writerId} exited code=${String(code)} signal=${String(
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

/**
 * Remove the temp DB tree (DB + -wal/-shm sidecars), robust to the Windows
 * handle-release race. `reapChildren()` issues an ASYNCHRONOUS SIGKILL, so a just-
 * killed writer may still hold an open WAL/SHM file handle for a few milliseconds
 * when cleanup runs; on Windows that makes a plain recursive unlink fail with
 * EBUSY/EPERM and silently leak the temp dir (observed once as an orphaned
 * agentbbs-concurrency-* dir with intact -wal/-shm). `maxRetries` + `retryDelay`
 * (linear backoff, retried on EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE per the Node fs
 * docs; active only with `recursive: true`) absorbs that brief window so no temp
 * tree is left behind — hardening cleanup ONLY, no assertion is affected.
 */
function removeTempTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

/**
 * Run the full N×M scenario against a fresh DB and return both the per-worker
 * results and the folded ledger read back through the real Story 1.6 read path.
 *
 * Implements the START BARRIER: fork all N workers, wait until every one has sent
 * `ready`, then broadcast `go` so they all hit the write lock together.
 *
 * Robustness (harness, not assertions): the DB is migrated ONCE here in the parent
 * BEFORE forking so the workers do not thundering-herd on a concurrent first-run
 * `migrate` (each worker's `createDataAccess` then finds the table present and its
 * idempotent migrate is a cheap no-op). And the barrier `await` is RACED against the
 * worker promises, so if any worker dies during startup (before sending `ready`) the
 * scenario rejects immediately with that error instead of hanging until the test
 * timeout — turning a would-be 60s hang into an instant, diagnosable failure.
 */
async function runScenario(
  dbPath: string,
  holdLockWriterId: number | null,
): Promise<{ results: WorkerResult[]; events: Event[] }> {
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
    if (readyChildren.length === N_WRITERS) resolveAllReady();
  };

  const workerPromises: Promise<WorkerResult>[] = [];
  for (let id = 0; id < N_WRITERS; id++) {
    const holdLockMs = id === holdLockWriterId ? LOCK_HOLD_MS : 0;
    workerPromises.push(
      forkWorker(
        { dbPath, writerId: id, eventCount: M_EVENTS, holdLockMs },
        onReady,
      ),
    );
  }

  // Barrier: release all writers simultaneously once each has opened. Race against
  // the worker promises so a startup death surfaces now (Promise.all rejects), never
  // a 60s hang waiting on an `allReady` that can no longer be reached.
  await Promise.race([
    allReady,
    // If any worker settles before all are ready, it can only be a rejection
    // (success requires the `go` we have not sent yet); surface it.
    Promise.all(workerPromises),
  ]);
  for (const child of readyChildren) child.send({ type: 'go' });

  const results = await Promise.all(workerPromises);

  // Read the ledger back through the REAL read path (eventsSince(0) => full order).
  const reader = createDataAccess({ dbPath });
  try {
    const events = await reader.eventsSince(0);
    return { results, events };
  } finally {
    reader.close();
  }
}

/** Assert AC1 invariants over a completed scenario's results + folded ledger. */
function assertAc1(results: WorkerResult[], events: Event[]): void {
  // Exactly N×M rows exist.
  expect(events.length).toBe(EXPECTED_TOTAL);

  // Every worker appended exactly M events and reported no escaped StoreBusyError.
  for (const r of results) {
    expect(r.appended).toBe(M_EVENTS);
    expect(r.busyErrors).toBe(0);
  }

  // Every `seq` is unique and STRICTLY increasing in read order (the total order).
  const seqs = events.map((e) => e.seq);
  for (let i = 1; i < seqs.length; i++) {
    expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
  }
  expect(new Set(seqs).size).toBe(EXPECTED_TOTAL);

  // The full attributable marker set is EXACTLY the N×M expected — no lost or
  // duplicated writes. Each event is identity.seen carrying its unique handle.
  const expectedMarkers = new Set<string>();
  for (let id = 0; id < N_WRITERS; id++) {
    for (let i = 0; i < M_EVENTS; i++) expectedMarkers.add(`writer-${id}#${i}`);
  }
  const observedMarkers = events.map((e) => {
    expect(e.type).toBe('identity.seen');
    return (e.payload as { handle: string }).handle;
  });
  // No duplicates.
  expect(new Set(observedMarkers).size).toBe(EXPECTED_TOTAL);
  // Exact set equality (every writer's M markers present; nothing extra).
  expect(new Set(observedMarkers)).toEqual(expectedMarkers);

  // Each writer's own reported markers are exactly its M, all present in the ledger.
  const observedSet = new Set(observedMarkers);
  for (const r of results) {
    expect(r.markers.length).toBe(M_EVENTS);
    for (const m of r.markers) expect(observedSet.has(m)).toBe(true);
  }
}

beforeAll(() => {
  // BUILD-IF-MISSING/STALE: the test forks the built worker. Ensure dist exists and
  // is at least as new as its source so a clean local `pnpm test` is self-contained.
  // (CI builds before test, so this is usually a no-op there.)
  const needsBuild =
    !existsSync(WORKER_DIST) ||
    statSync(WORKER_DIST).mtimeMs < statSync(WORKER_SRC).mtimeMs;
  if (needsBuild) {
    // `tsc -b --force` rebuilds and EMITS unconditionally. Plain `tsc -b` consults
    // the incremental `.tsbuildinfo` and would skip emit if it believes the project
    // is up to date — which happens when only the emitted .js was removed but the
    // build-info is still fresh, leaving the worker artifact missing. `--force`
    // sidesteps that. We invoke the package-local tsc via its bin path so this is
    // cross-platform (Windows + Linux CI) and does not depend on a shell. tsc -b is
    // idempotent, so a redundant force-build is harmless.
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

describe('multi-process concurrency verification (NFR3/NFR10)', () => {
  it(
    'AC1: N×M concurrent appends across processes — exact count, unique strictly-monotonic seq, no lost writes, one total order for every reader',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-concurrency-ac1-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const { results, events } = await runScenario(dbPath, null);
        assertAc1(results, events);

        // SAME total order for every (independent) reader: open a SECOND fresh
        // connection and fold again; the seq sequences must be identical.
        const reader2 = createDataAccess({ dbPath });
        try {
          const events2 = await reader2.eventsSince(0);
          expect(events2.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
          expect(
            events2.map((e) => (e.payload as { handle: string }).handle),
          ).toEqual(
            events.map((e) => (e.payload as { handle: string }).handle),
          );
        } finally {
          reader2.close();
        }
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );

  it(
    'AC2: survives induced lock contention — busy_timeout + retry resolves every contended write; final count still exactly N×M',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-concurrency-ac2-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        // writer 0 holds a real write lock for LOCK_HOLD_MS right after the barrier,
        // forcing the other writers to contend with a held lock (deterministic
        // SQLITE_BUSY that the 1.4 busy_timeout/retry must resolve).
        const { results, events } = await runScenario(dbPath, 0);

        // All AC1 invariants STILL hold under contention (no lost/dup writes; one
        // strict total order) — the retry recovered every contended write.
        assertAc1(results, events);

        // No StoreBusyError escaped the real append path at this N/M (retry won).
        for (const r of results) expect(r.busyErrors).toBe(0);

        // CONTENTION EVIDENCE: the lock was held LOCK_HOLD_MS, so at least one of the
        // CONTENDING writers (everyone except the holder) must have had a single
        // append blocked for a meaningful fraction of that hold before it resolved.
        // We assert at least one contending writer saw a max-append latency above a
        // conservative floor — proving the busy path was genuinely traversed, not a
        // trivially un-contended run.
        const contendingMax = results
          .filter((r) => r.writerId !== 0)
          .map((r) => r.maxAppendMs);
        const slowestContended = Math.max(...contendingMax);
        // Floor is a small fraction of the hold (LOCK_HOLD_MS=150) to stay robust on
        // slow CI yet still prove a real block occurred (an uncontended append is
        // sub-millisecond).
        expect(slowestContended).toBeGreaterThan(LOCK_HOLD_MS * 0.3);
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );
});
