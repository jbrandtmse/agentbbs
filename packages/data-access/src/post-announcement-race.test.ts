// Cross-process post-announcement race (Story 4.1 QA, AC #4 — the GENUINE concurrency
// proof). N independent OS PROCESSES each post an announcement with the SAME subject
// against ONE shared SQLite ledger, simultaneously. The regressable guarantee: EVERY
// post SUCCEEDS with a DISTINCT `roomId` — the complete disambiguator sequence
// (`calling-interface`, `calling-interface-2`, …, `calling-interface-N`) — with NO lost
// write and NO error, proving AC #4's "concurrent same-subject posts converge to
// sequential unique ids" against the REAL atomic `room_id` uniqueness guard + the op's
// disambiguator-retry loop.
//
// WHY THIS TEST EXISTS (the gap it closes): the dev's existing AC #4 coverage —
// post-announcement.test.ts (core, in-memory fake) and post-announcement.integration.test.ts
// (real MCP + real ledger) — exercises the disambiguator ONLY SEQUENTIALLY: each second
// post is `await`ed AFTER the first has fully committed, so the retry path is driven by an
// already-present row, never by a genuine concurrent conflict. The `appendGuarded` primitive
// is proven atomic across processes by Story 2.2's register-race, but ONLY for the
// REJECT-on-conflict outcome (one winner, the rest HANDLE_TAKEN). postAnnouncement's
// behavior is the OPPOSITE: on conflict it RETRIES with a bumped disambiguator, so under a
// real N-way race ALL N must succeed with N distinct ids. That retry-loop-under-real-
// contention is a distinct guarantee no existing test covers — this closes it.
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3
// address space, so they would NOT exercise cross-process WAL locking — the mechanism that
// makes the guard atomic across processes. We fork the BUILT worker
// (dist/post-announcement-race-worker.js) as genuine OS processes via child_process.fork,
// with an IPC start barrier so all N hit the same-subject post together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a
// clean local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds
// @agentbbs/data-access if the worker dist is missing/older than its source). It is named
// `*.test.ts`, co-located under packages/*/src, and runs in the default Vitest project — the
// worker (`*-worker.ts`) is NOT matched by the test glob, so it is never collected as an
// empty test file (same structure as Stories 1.7 / 2.2).
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
  announceProject,
  foldRooms,
  joinBoard,
  register,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { PostRaceWorkerResult } from './post-announcement-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'post-announcement-race-worker.ts');
const WORKER_DIST = join(
  PACKAGE_ROOT,
  'dist',
  'post-announcement-race-worker.js',
);

// N racers: modest but > 1 so SQLite must serialize the writers on the single write lock
// AND so the disambiguator must walk a multi-step sequence (base … base-N); 8 gives healthy
// simultaneous contention on the one room_id base while keeping the run fast and non-flaky.
const N_WORKERS = 8;
const BOARD_ID = 'calling-interface'; // a title that slugs to itself
const SHARED_SUBJECT = 'Calling Interface'; // every worker posts THIS → base 'calling-interface'
const SHARED_BASE = 'calling-interface';
const TEST_TIMEOUT_MS = 60_000;

/** Live children, tracked so afterEach can reap any orphan on failure. */
const liveChildren = new Set<ChildProcess>();

/**
 * The complete set of room ids N concurrent same-subject posts MUST converge to: the base
 * for the first, then `base-2` … `base-N` (1-based ordinal disambiguator) for the rest. The
 * ORDER in which workers win is non-deterministic (it is a race), but the SET is exact.
 */
function expectedRoomIds(base: string, n: number): Set<string> {
  const ids = new Set<string>([base]);
  for (let k = 2; k <= n; k += 1) ids.add(`${base}-${k}`);
  return ids;
}

/**
 * Fork one race worker and resolve with its single IPC `done` result. Resolves only when
 * BOTH a `done` message arrived AND the process exited 0; rejects on spawn error,
 * non-zero/signalled exit, or exit before a result. The worker emits `ready` and waits for
 * our `go` — surfaced via `onReady` for the start barrier.
 */
function forkWorker(
  args: {
    dbPath: string;
    workerId: number;
    projectId: string;
    handle: string;
    subject: string;
  },
  onReady: (child: ChildProcess) => void,
): Promise<PostRaceWorkerResult> {
  return new Promise<PostRaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [
        args.dbPath,
        String(args.workerId),
        args.projectId,
        args.handle,
        args.subject,
      ],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: PostRaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as PostRaceWorkerResult;
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

/** A member handle for racer `id`. */
function memberHandle(id: number): string {
  return `member-${id}`;
}

/**
 * Seed the shared ledger IN THE PARENT before forking: register N member identities, have
 * member-0 announce the board (which auto-joins it), and join every other member to it.
 * Done sequentially through the REAL ops so the race the workers run is isolated to the
 * room-id allocation (every worker is already a member; the membership gate is a no-op
 * read for them, leaving only the `appendGuarded` room_id guard + retry under contention).
 */
async function seedBoardAndMembers(dbPath: string): Promise<void> {
  const da = createDataAccess({ dbPath });
  try {
    for (let id = 0; id < N_WORKERS; id += 1) {
      await register(da, {
        handle: memberHandle(id),
        currentFocus: `racer ${id}`,
      });
    }
    // member-0 announces the board (announceProject auto-joins the announcer).
    await announceProject(da, memberHandle(0), {
      title: BOARD_ID,
      description: 'the shared board every racer posts to',
    });
    // Every other member joins it through the REAL op (member-0 is already joined via
    // the announce). postAnnouncement only needs membership; this is the same join the
    // join_board tool would perform.
    for (let id = 1; id < N_WORKERS; id += 1) {
      await joinBoard(da, memberHandle(id), BOARD_ID);
    }
  } finally {
    da.close();
  }
}

/**
 * Run the N-way same-subject post race against the pre-seeded DB and return both the
 * per-worker results and the announcement.posted events read back through the real read
 * path. Implements the START BARRIER: fork all N, wait until every one is `ready`, then
 * broadcast `go` so they all post the SAME subject together.
 */
async function runRace(dbPath: string): Promise<{
  results: PostRaceWorkerResult[];
  postedRoomIds: string[];
  postedSeqs: number[];
}> {
  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<PostRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id += 1) {
    workerPromises.push(
      forkWorker(
        {
          dbPath,
          workerId: id,
          projectId: BOARD_ID,
          handle: memberHandle(id),
          subject: SHARED_SUBJECT,
        },
        onReady,
      ),
    );
  }

  // Barrier: release all workers simultaneously once each has opened. Race against the
  // worker promises so a startup death surfaces now instead of a 60s hang.
  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  const results = await Promise.all(workerPromises);

  // Read the ledger back through the REAL read path: the room ids + seqs of every
  // announcement.posted (mapped from the on-disk snake_case room_id), in seq order.
  const reader = createDataAccess({ dbPath });
  try {
    const posted = await reader.eventsByType('announcement.posted');
    return {
      results,
      postedRoomIds: posted.map(
        (e) => (e.payload as { roomId: string }).roomId,
      ),
      postedSeqs: posted.map((e) => e.seq),
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

afterEach(() => {
  reapChildren();
});

describe('cross-process post-announcement race (AC #4 — disambiguator retry under genuine concurrency)', () => {
  it(
    'N processes posting the SAME subject → EVERY post succeeds with a DISTINCT roomId (base … base-N), no lost write, no error',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-post-ann-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        await seedBoardAndMembers(dbPath);
        const { results, postedRoomIds, postedSeqs } = await runRace(dbPath);

        // Every worker reported a clean post (no error escaped the retry loop — a throw
        // would have made the worker exit non-zero and rejected Promise.all before here).
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) expect(r.posted).toBe(true);

        // Every worker's returned roomId is UNIQUE — no two posts share an id.
        const workerRoomIds = results.map((r) => r.roomId);
        expect(new Set(workerRoomIds).size).toBe(N_WORKERS);

        // The SET of returned ids is EXACTLY the complete disambiguator sequence
        // {base, base-2, …, base-N} — every slot filled, none skipped, none beyond N. The
        // WIN ORDER is non-deterministic (it is a race), so we assert the set, not a list.
        expect(new Set(workerRoomIds)).toEqual(
          expectedRoomIds(SHARED_BASE, N_WORKERS),
        );

        // The DURABLE ledger agrees: exactly N announcement.posted rows, their room ids the
        // exact same complete set (no lost write — every racer's append committed), and N
        // unique strictly-increasing seqs (one total order; concurrent posts serialized).
        expect(postedRoomIds).toHaveLength(N_WORKERS);
        expect(new Set(postedRoomIds)).toEqual(
          expectedRoomIds(SHARED_BASE, N_WORKERS),
        );
        expect(new Set(postedSeqs).size).toBe(N_WORKERS);
        for (let i = 1; i < postedSeqs.length; i += 1) {
          expect(postedSeqs[i]).toBeGreaterThan(postedSeqs[i - 1] as number);
        }

        // Each worker's reported seq is a real durable seq present in the ledger (the post
        // it claims to have made is the one that actually committed).
        const durableSeqs = new Set(postedSeqs);
        for (const r of results) expect(durableSeqs.has(r.seq)).toBe(true);

        // INDEPENDENT READ-BACK: a second fresh connection folds the same N distinct rooms
        // (the proto-room directory is reproducible from the events alone — no lost/merged
        // room). Each room's body is its own worker's body, proving no write clobbered
        // another.
        const reader = createDataAccess({ dbPath });
        try {
          const events = await reader.eventsSince(0);
          const directory = foldRooms(events);
          expect(directory.size).toBe(N_WORKERS);
          expect(new Set(directory.keys())).toEqual(
            expectedRoomIds(SHARED_BASE, N_WORKERS),
          );
          // Every folded room is on the shared board, with the verbatim shared subject and
          // a DISTINCT body (one per racer — no body was lost or duplicated).
          const bodies = new Set<string>();
          for (const room of directory.values()) {
            expect(room.projectId).toBe(BOARD_ID);
            expect(room.subject).toBe(SHARED_SUBJECT);
            expect(room.active).toBe(false);
            bodies.add(room.body);
          }
          expect(bodies.size).toBe(N_WORKERS);
        } finally {
          reader.close();
        }
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );
});
