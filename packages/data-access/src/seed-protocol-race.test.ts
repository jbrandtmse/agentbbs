// Cross-process protocol-SEED race (Story 7.2 QA, AC #2 — THE GENUINE MULTI-PROCESS
// IDEMPOTENCY PROOF). N independent OS PROCESSES each run `seedProtocolAnnouncement`
// against ONE shared SQLite ledger, simultaneously — modelling the architecture's
// MULTI-PROCESS SQLite reality where two server processes can BOOTSTRAP at the same
// time (both pass the seed's `findRoom` existence check in the race window, both
// attempt the guarded append). The regressable guarantee: the ledger converges to
// EXACTLY ONE protocol announcement, EXACTLY ONE reserved `main` project, and EXACTLY
// ONE `agentbbs` system identity — and EVERY worker's seed RESOLVES (no error escapes;
// the losers swallow the `room_id` uniqueness conflict). This is AC #2's "server
// restart / re-initialization → no duplicate" proven under genuine concurrency.
//
// WHY THIS TEST EXISTS (the gap it closes): the dev's seed coverage —
// protocol-announcement.test.ts (core, in-memory fake) and protocol-seed.integration.test.ts
// (real MCP + real ledger) — exercises idempotency ONLY SEQUENTIALLY (the second seed is
// `await`ed AFTER the first fully committed, so it short-circuits on the existence check
// and never drives the guard) and the race-swallow ONLY SAME-PROCESS (a hand-rolled fake
// that always rejects — it never proves the REAL SQLite guard lets exactly one of N
// concurrent composite appends commit). The `appendGuarded` `room_id` uniqueness primitive
// is proven atomic across processes by Story 2.2's register-race and Story 4.1's
// post-announcement-race, but ONLY for a SINGLE event. The SEED appends FOUR events in one
// guarded call (identity.registered + project.announced + board.joined + announcement.posted,
// guard on the announcement's room_id) and SWALLOWS the loser's conflict — that
// composite-append-then-swallow under real bootstrap contention is a distinct guarantee no
// existing test covers. This closes it.
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3
// address space, so they would NOT exercise cross-process WAL locking — the mechanism that
// makes the guard atomic across processes. We fork the BUILT worker
// (dist/seed-protocol-race-worker.js) as genuine OS processes via child_process.fork, with
// an IPC start barrier so all N hit the seed together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a
// clean local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds
// @agentbbs/data-access if the worker dist is missing/older than its source). It is named
// `*.test.ts`, co-located under packages/*/src, and runs in the default Vitest project — the
// worker (`*-worker.ts`) is NOT matched by the test glob, so it is never collected as an
// empty test file (same structure as Stories 1.7 / 2.2 / 4.1).
//
// Hygiene: every DB lives under os.tmpdir() (never the repo's .agentbbs/); the temp tree +
// spawned children are removed/killed in finally/afterEach — no orphans even on failure. A
// generous per-test timeout guards CI; runtime is well under a second.

import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAIN_BOARD_PROJECT_ID,
  PROTOCOL_ROOM_ID,
  SYSTEM_HANDLE,
  findProject,
  findRoom,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { SeedRaceWorkerResult } from './seed-protocol-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'seed-protocol-race-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'seed-protocol-race-worker.js');

// N racers: modest but > 1 so SQLite must serialize the writers on the single write lock
// AND so several workers' existence checks miss together (the race window the guard must
// close); 8 gives healthy simultaneous contention on the one reserved room_id while keeping
// the run fast and non-flaky.
const N_WORKERS = 8;
const TEST_TIMEOUT_MS = 60_000;

/** Live children, tracked so afterEach can reap any orphan on failure. */
const liveChildren = new Set<ChildProcess>();

/**
 * Fork one race worker and resolve with its single IPC `done` result. Resolves only when
 * BOTH a `done` message arrived AND the process exited 0; rejects on spawn error,
 * non-zero/signalled exit, or exit before a result. The worker emits `ready` and waits for
 * our `go` — surfaced via `onReady` for the start barrier.
 */
function forkWorker(
  args: { dbPath: string; workerId: number },
  onReady: (child: ChildProcess) => void,
): Promise<SeedRaceWorkerResult> {
  return new Promise<SeedRaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(WORKER_DIST, [args.dbPath, String(args.workerId)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    liveChildren.add(child);

    let result: SeedRaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as SeedRaceWorkerResult;
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

/**
 * Kill any still-running children (defensive — no orphans even on failure) AND await
 * their actual exit before returning.
 *
 * Story 11.0 AC1: previously this sent `SIGKILL` and returned IMMEDIATELY without
 * awaiting exit, so the subsequent `removeTempTree(dir)` could run while a just-killed
 * worker still held the `.db`/`-wal`/`-shm` handle → Windows `EPERM` on removal. We now
 * await each killed child's `exit` (bounded, so a stuck child can't hang teardown), so
 * the OS has released the worker's file handles before we attempt the tree removal. In
 * the happy path `liveChildren` is already empty (every worker exited 0 via the awaited
 * `Promise.all`), so this is a no-op there; it only matters on the defensive failure
 * path. Combined with the best-effort `removeTempTree`, the teardown is robust.
 */
async function reapChildren(): Promise<void> {
  const exits: Promise<void>[] = [];
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      exits.push(
        new Promise<void>((resolveExit) => {
          // Resolve on exit, or after a short bound so a wedged child cannot hang
          // teardown (the dir cleanup is best-effort regardless).
          const timer = setTimeout(resolveExit, 2000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolveExit();
          });
        }),
      );
      if (!child.killed) child.kill('SIGKILL');
    }
  }
  await Promise.all(exits);
  liveChildren.clear();
}

/**
 * Remove the temp DB tree, robust to the Windows handle-release race (see 1.7).
 *
 * Story 11.0 AC1 — BEST-EFFORT / NON-FATAL teardown: this runs in `finally` AFTER the
 * race assertions have already passed, so a failure to remove the tree is a cleanup
 * nuisance, NOT a test failure. On Windows, a just-SIGKILL'd worker (the defensive
 * `reapChildren` path) or an AV/indexer can momentarily still hold the `.db`/`-wal`/
 * `-shm` handle, and Windows then reports `EPERM` (not `EBUSY`) on the directory
 * removal — which previously intermittently RED'd the gate even though the test's
 * guarantee was fully proven. We keep the wide retry budget (≈1s of handle-release
 * grace) and then SWALLOW a residual removal error rather than let teardown fail the
 * gate. The `os.tmpdir()` discipline is preserved: the worst case is a stray temp dir
 * under the OS temp root (which the OS reclaims), never an orphan in the repo.
 */
function removeTempTree(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  } catch {
    // Best-effort: a lingering Windows handle on a temp-only DB sidecar must not fail a
    // test whose assertions already passed. The dir lives under os.tmpdir(); leave it
    // for the OS to reclaim rather than red the gate.
  }
}

/**
 * Run the N-way seed race against a fresh DB and return both the per-worker results and the
 * ledger read back through the real read path (the at-rest counts + the folded projections).
 * Implements the START BARRIER: fork all N, wait until every one is `ready`, then broadcast
 * `go` so they all run the seed together.
 */
async function runRace(dbPath: string): Promise<{
  results: SeedRaceWorkerResult[];
  protocolAnnouncementCount: number;
  mainProjectCount: number;
  systemIdentityCount: number;
  protocolRoomPresent: boolean;
  mainHasSystemMember: boolean;
}> {
  // Pre-create + migrate the shared ledger once (avoids a concurrent-migrate herd) WITHOUT
  // seeding — every worker performs the bootstrap seed itself, which is the point of the race.
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

  const workerPromises: Promise<SeedRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id += 1) {
    workerPromises.push(forkWorker({ dbPath, workerId: id }, onReady));
  }

  // Barrier: release all workers simultaneously once each has opened. Race against the
  // worker promises so a startup death surfaces now instead of a 60s hang.
  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  const results = await Promise.all(workerPromises);

  // Read the ledger back through the REAL read path: the durable at-rest event counts AND the
  // folded projections (the protocol proto-room + the reserved main project), all reproducible
  // from the events alone — proving no duplicate landed and no write was lost or clobbered.
  const reader = createDataAccess({ dbPath });
  try {
    const announcements = await reader.eventsByType('announcement.posted');
    const protocolAnnouncementCount = announcements.filter(
      (e) => (e.payload as { roomId: string }).roomId === PROTOCOL_ROOM_ID,
    ).length;

    const projectsAnnounced = await reader.eventsByType('project.announced');
    const mainProjectCount = projectsAnnounced.filter(
      (e) =>
        (e.payload as { projectId: string }).projectId ===
        MAIN_BOARD_PROJECT_ID,
    ).length;

    const registrations = await reader.eventsByType('identity.registered');
    const systemIdentityCount = registrations.filter(
      (e) => (e.payload as { handle: string }).handle === SYSTEM_HANDLE,
    ).length;

    const events = await reader.eventsSince(0);
    const protocolRoom = findRoom(events, PROTOCOL_ROOM_ID);
    const mainProject = findProject(events, MAIN_BOARD_PROJECT_ID);

    return {
      results,
      protocolAnnouncementCount,
      mainProjectCount,
      systemIdentityCount,
      protocolRoomPresent:
        protocolRoom !== undefined &&
        protocolRoom.projectId === MAIN_BOARD_PROJECT_ID &&
        protocolRoom.postedBy === SYSTEM_HANDLE,
      mainHasSystemMember:
        mainProject?.members.includes(SYSTEM_HANDLE) ?? false,
    };
  } finally {
    reader.close();
  }
}

beforeAll(() => {
  // BUILD-IF-MISSING/STALE: the test forks the built worker. Ensure dist exists and is at
  // least as new as its source (see Story 1.7 concurrency.test.ts rationale). `tsc -b
  // --force` rebuilds + emits unconditionally so a stale .tsbuildinfo can't skip emit.
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

afterEach(async () => {
  await reapChildren();
});

describe('cross-process protocol-seed race (AC #2 — idempotent under genuine multi-process bootstrap)', () => {
  it(
    'N processes seeding concurrently → EXACTLY ONE protocol announcement / main project / system identity, every seed resolves (no error escapes)',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-seed-protocol-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const {
          results,
          protocolAnnouncementCount,
          mainProjectCount,
          systemIdentityCount,
          protocolRoomPresent,
          mainHasSystemMember,
        } = await runRace(dbPath);

        // Every worker's seed RESOLVED — the loser of the guard race SWALLOWED the
        // uniqueness conflict (idempotent), so NO error escaped any worker. (A throw would
        // have exited that worker non-zero and rejected Promise.all before reaching here.)
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) expect(r.seeded).toBe(true);

        // The DURABLE ledger holds EXACTLY ONE protocol announcement — the atomic room_id
        // guard prevented every concurrent duplicate (the core AC #2 claim under concurrency).
        expect(protocolAnnouncementCount).toBe(1);
        // …and EXACTLY ONE reserved `main` project + ONE `agentbbs` system identity (the
        // sub-facts are guarded too, so the composite append did not double-create them).
        expect(mainProjectCount).toBe(1);
        expect(systemIdentityCount).toBe(1);

        // The folded projections agree: the protocol proto-room exists on the reserved main
        // project (authored by the system identity), and the system identity is main's member
        // — i.e. the WINNER's full 4-event composite append committed intact (no torn write).
        expect(protocolRoomPresent).toBe(true);
        expect(mainHasSystemMember).toBe(true);
      } finally {
        // Await child exit (handles released) BEFORE the best-effort tree removal, so a
        // just-killed worker's lingering handle does not EPERM the cleanup (AC1).
        await reapChildren();
        removeTempTree(dir);
      }
    },
  );
});
