// Cross-process `check` race (Story 6.1 QA, AC #3 — the GENUINE concurrency proof).
//
// THE GAP THIS CLOSES (a guarantee the dev's strong-but-SEQUENTIAL suite cannot reach). The dev's
// AC #3 coverage — check.test.ts's "concurrent higher-seq event is NOT swallowed" — SIMULATES the
// concurrency: it `await`s a full `check` (the fold → setCursor UPSERT → recordSeen ping all
// committed), THEN sequentially `await`s an `append`, THEN a second `check`. So the "a message
// lands CONCURRENTLY with my check" path AC #3 literally states is exercised against an
// already-settled stream — never against a genuine write-write race between the checker's cursor
// advance/recordSeen and a concurrent reply. `check` reads+writes a STORED cursor (getCursor →
// setCursor UPSERT) and appends a recordSeen presence ping ON THE HOT PATH, and `reply` is a PLAIN
// append (no `appendGuarded`) — so the AC #3 guarantee ultimately rests on SQLite's single-writer
// serialization (Story 1.7's concurrency.test.ts proved unique monotonic seqs; the reply-race
// proved a plain-append reply survives an N-way race with zero lost writes). But the CHECK delta's
// no-skip + the stored cursor's monotonicity under that race are a DIFFERENT, load-bearing
// guarantee no existing test covers. This forks ONE checker looping `core.check` while N real OS
// PROCESSES reply to the SAME room it participates in SIMULTANEOUSLY, and regresses three
// check-specific guarantees:
//   1. NO MESSAGE SKIPPED: the UNION of every message the checker returned across ALL its checks
//      is EXACTLY the set of replies the appenders landed — none lost (cursor advanced only to
//      `maxReturned`, so a reply with a higher seq surfaces on a later check), none duplicated.
//   2. CURSOR MONOTONIC: the stored per-identity cursor the checker observed never moved BACKWARD
//      across its successive checks, despite N concurrent appends.
//   3. UPSERT CONSISTENT + presence: the checker ran its whole loop with NO error (its per-check
//      setCursor UPSERT + recordSeen ping survived the contention), one identity.seen per check on
//      the durable ledger, and the final stored cursor equals the max in-scope seq.
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3 address
// space, so they would NOT exercise cross-process WAL locking — the mechanism that serializes the
// writers and makes `seq` a correct total order (the very basis of "advance only to maxReturned,
// the higher-seq reply is not swallowed"). We fork the BUILT worker (dist/check-race-worker.js) as
// genuine OS processes via child_process.fork, with an IPC start barrier so the checker's loop and
// the appenders' replies overlap.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a clean
// local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds @agentbbs/data-access
// if the worker dist is missing/older than its source). It is named `*.test.ts`, co-located under
// packages/*/src, and runs in the default Vitest project — the worker (`*-worker.ts`) is NOT
// matched by the test glob, so it is never collected as an empty test file (same structure as the
// reply-race / react-race / concurrency suites). Thus it is discoverable by the default
// `vitest run` (Rule 8).
//
// Hygiene: every DB lives under os.tmpdir() (never the repo's .agentbbs/); the temp tree + spawned
// children are removed/killed in finally/afterEach — no orphans even on failure.

import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  announceProject,
  check,
  joinBoard,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type {
  CheckRaceMode,
  CheckRaceWorkerResult,
} from './check-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'check-race-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'check-race-worker.js');

// N appenders: modest but > 1 so SQLite must serialize the writers on the single write lock while
// the checker concurrently advances its cursor. 8 gives healthy simultaneous contention on the one
// room + the cursor while keeping the run fast.
const N_APPENDERS = 8;
// The checker loops this many `check`s DURING the race (so many of its folds overlap an in-flight
// reply), then drains. More iterations than appenders → high odds a check observes a partial set.
const CHECKER_ITERATIONS = 12;
const BOARD_ID = 'calling-interface'; // a title that slugs to itself
const ROOM_SUBJECT = 'Need a reviewer';
const CHECKER_HANDLE = 'checker';
const TEST_TIMEOUT_MS = 60_000;

/** Live children, tracked so afterEach can reap any orphan on failure. */
const liveChildren = new Set<ChildProcess>();

/**
 * Fork one race worker and resolve with its single IPC `done` result. Resolves only when BOTH a
 * `done` message arrived AND the process exited 0; rejects on spawn error, non-zero/signalled
 * exit, or exit before a result. The worker emits `ready` and waits for our `go` — surfaced via
 * `onReady` for the start barrier.
 */
function forkWorker(
  args: {
    dbPath: string;
    workerId: number;
    roomId: string;
    handle: string;
    mode: CheckRaceMode;
    iterations: number;
  },
  onReady: (child: ChildProcess) => void,
): Promise<CheckRaceWorkerResult> {
  return new Promise<CheckRaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [
        args.dbPath,
        String(args.workerId),
        args.roomId,
        args.handle,
        args.mode,
        String(args.iterations),
      ],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: CheckRaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as CheckRaceWorkerResult;
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

/** An appender handle for racer `id`. */
function appenderHandle(id: number): string {
  return `appender-${id}`;
}

/**
 * Seed the shared ledger IN THE PARENT before forking and return the proto-room's roomId. An owner
 * announces the board (auto-joining) + posts the proto-room. The CHECKER then joins the board and
 * REPLIES once (so it is a seated PARTICIPANT of the room — every appender reply is in its `check`
 * scope, and its room floor sits at its own joining reply so later appender replies surface). Every
 * appender is registered + board-joined so its race reply is a single plain `room.replied` (no
 * bundled board.joined to perturb the seq accounting). Returns the room id.
 */
async function seedBoardAndRoom(dbPath: string): Promise<string> {
  const da = createDataAccess({ dbPath });
  try {
    const owner = 'owner';
    await register(da, { handle: owner, currentFocus: 'owner' });
    await announceProject(da, owner, {
      title: BOARD_ID,
      description: 'the shared board the checker dials into',
    });
    const room = await postAnnouncement(da, owner, {
      projectId: BOARD_ID,
      subject: ROOM_SUBJECT,
      body: 'looking for a second pair of eyes',
    });

    // The CHECKER: a seated participant (joins the board, then replies once so its room floor is
    // its own joining reply — appender replies, all later, are above it and in scope).
    await register(da, { handle: CHECKER_HANDLE, currentFocus: 'dialing in' });
    await joinBoard(da, CHECKER_HANDLE, BOARD_ID);
    await reply(da, CHECKER_HANDLE, {
      roomId: room.roomId,
      body: 'checker is here',
    });

    // Every appender: registered + a board member up front, so its race reply is a single plain
    // room.replied (no conditional board.joined bundled in) — keeps the seq accounting clean.
    for (let id = 0; id < N_APPENDERS; id += 1) {
      const handle = appenderHandle(id);
      await register(da, { handle, currentFocus: `appender ${handle}` });
      await joinBoard(da, handle, BOARD_ID);
    }
    return room.roomId;
  } finally {
    da.close();
  }
}

/**
 * Fork the checker + all N appenders with a START BARRIER and collect their results. Forks every
 * worker, waits until each is `ready`, then broadcasts `go` so the checker's loop and the
 * appenders' replies overlap. Worker 0 is the checker; workers 1..N are the appenders.
 */
async function runRace(
  dbPath: string,
  roomId: string,
): Promise<CheckRaceWorkerResult[]> {
  const totalWorkers = N_APPENDERS + 1;
  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === totalWorkers) resolveAllReady();
  };

  const workerPromises: Promise<CheckRaceWorkerResult>[] = [];
  // Worker 0 — the single checker (loops core.check while the appenders write).
  workerPromises.push(
    forkWorker(
      {
        dbPath,
        workerId: 0,
        roomId,
        handle: CHECKER_HANDLE,
        mode: 'checker',
        iterations: CHECKER_ITERATIONS,
      },
      onReady,
    ),
  );
  // Workers 1..N — the appenders (each replies once).
  for (let id = 0; id < N_APPENDERS; id += 1) {
    workerPromises.push(
      forkWorker(
        {
          dbPath,
          workerId: id + 1,
          roomId,
          handle: appenderHandle(id),
          mode: 'appender',
          iterations: 0,
        },
        onReady,
      ),
    );
  }

  // Barrier: release all workers simultaneously once each has opened. Race against the worker
  // promises so a startup death surfaces now instead of a 60s hang.
  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  return Promise.all(workerPromises);
}

beforeAll(() => {
  // BUILD-IF-MISSING/STALE: the test forks the built worker. Ensure dist exists and is at least as
  // new as its source (see Story 1.7 concurrency.test.ts rationale). `tsc -b --force` rebuilds +
  // emits unconditionally so a stale .tsbuildinfo can't skip emit.
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

describe('cross-process check race (Story 6.1 AC #3 — concurrent reply not swallowed, cursor monotonic)', () => {
  it(
    'ONE checker looping check while N appenders reply concurrently → no in-scope message is skipped, the cursor advances monotonically, and the UPSERT/presence stay consistent',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-check-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const roomId = await seedBoardAndRoom(dbPath);

        const results = await runRace(dbPath, roomId);

        // Split the results into the single checker + the N appenders. Every worker reported ok
        // (a throw would have made it exit non-zero and rejected Promise.all before here).
        expect(results).toHaveLength(N_APPENDERS + 1);
        for (const r of results) expect(r.ok).toBe(true);
        const checker = results.find((r) => r.mode === 'checker');
        const appenders = results.filter((r) => r.mode === 'appender');
        expect(checker).toBeDefined();
        expect(appenders).toHaveLength(N_APPENDERS);

        const reader = createDataAccess({ dbPath });
        try {
          // THE DURABLE LEDGER: exactly N appender room.replied rows in the shared room (zero lost
          // writes — every appender's plain append committed), with N UNIQUE strictly-increasing
          // seqs (one total order; the concurrent plain appends were serialized by the single
          // writer, no collision). The checker's own seeding reply is excluded (different actor).
          const appenderHandles = new Set(appenders.map((a) => a.handle));
          const allReplies = await reader.eventsByType('room.replied');
          const appenderReplies = allReplies.filter(
            (e) =>
              e.type === 'room.replied' &&
              e.payload.roomId === roomId &&
              appenderHandles.has(e.actor),
          );
          expect(appenderReplies).toHaveLength(N_APPENDERS);
          const landedSeqs = appenderReplies
            .map((e) => e.seq)
            .sort((a, b) => a - b);
          expect(new Set(landedSeqs).size).toBe(N_APPENDERS);
          for (let i = 1; i < landedSeqs.length; i += 1) {
            expect(landedSeqs[i]).toBeGreaterThan(landedSeqs[i - 1] as number);
          }
          // Each appender's self-reported replySeq matches a landed row (durable attribution).
          for (const a of appenders) {
            expect(landedSeqs).toContain(a.replySeq);
          }

          const observations = checker!.observations;
          // The checker observed at least its in-race iterations plus the drain tail.
          expect(observations.length).toBeGreaterThanOrEqual(
            CHECKER_ITERATIONS,
          );
          const maxLanded = landedSeqs[landedSeqs.length - 1] as number;

          // The IN-RACE messages the checker returned across all its checks (the concurrent-path
          // evidence). The checker worker exits INDEPENDENTLY of the appenders, so a reply that
          // committed after the checker's last in-race check may not be in here yet — that tail is
          // reconciled by the parent's quiescent drain below. What the in-race set DOES prove now:
          //   - NO PHANTOM: every message the checker returned mid-race is a REAL landed appender
          //     reply (the returned set is a subset of what actually landed — never a fabricated
          //     or out-of-scope seq).
          //   - NO DUPLICATE: a message is returned AT MOST ONCE across all the checker's checks —
          //     once a check returns it and advances the cursor past it, no later check re-returns
          //     it (the cursor advanced exactly to maxReturned, monotonically).
          const returnedSeqs = observations.flatMap((o) => o.messageSeqs);
          const returnedSet = new Set(returnedSeqs);
          expect(returnedSeqs.length).toBe(returnedSet.size); // no duplicate, ever
          for (const s of returnedSet) expect(landedSeqs).toContain(s); // no phantom

          // (2) CURSOR MONOTONIC. Across the checker's successive checks the stored cursor it
          // advanced to never moved BACKWARD, despite the N concurrent appends. This is a pure
          // in-race property of the checker's own observation sequence (immune to the exit race).
          const cursors = observations.map((o) => o.cursor);
          for (let i = 1; i < cursors.length; i += 1) {
            expect(cursors[i]).toBeGreaterThanOrEqual(cursors[i - 1] as number);
          }
          // Within each individual check, the returned messages are seq-ordered (the delta is a
          // single seq-sorted list) and all lie at or below that check's advanced cursor.
          for (const o of observations) {
            const sorted = [...o.messageSeqs].sort((a, b) => a - b);
            expect(o.messageSeqs).toEqual(sorted);
            for (const s of o.messageSeqs) {
              expect(s).toBeLessThanOrEqual(o.cursor);
            }
          }

          // Presence so far: every in-race check appended exactly one identity.seen for the checker
          // (recordSeen, its first consumer) — no orphan, no double on the hot path under
          // contention. Captured BEFORE the parent's drain checks (which add more) so the count is
          // exactly the checker's own check count.
          const seensBeforeDrain = (
            await reader.eventsByActor(CHECKER_HANDLE)
          ).filter((e) => e.type === 'identity.seen').length;
          expect(seensBeforeDrain).toBe(observations.length);

          // (1) NO MESSAGE SKIPPED — proven on a QUIESCENT ledger (all workers have now exited, so
          // no reply is still in flight). The parent drains the checker's remaining delta to two
          // consecutive empty checks. The UNION of (the checker's in-race returns) ∪ (this parent
          // drain) must be EXACTLY the set of appender replies: a higher-seq reply that landed
          // concurrently was NOT swallowed (cursor advanced only to maxReturned, so it satisfied
          // seq > cursor on a later check and surfaced), and nothing was duplicated. This is the
          // load-bearing AC #3 guarantee, immune to the checker-vs-appender exit race.
          const drainedSeqs: number[] = [];
          let consecutiveEmpty = 0;
          for (let i = 0; i < 1000 && consecutiveEmpty < 2; i += 1) {
            const r = await check(reader, CHECKER_HANDLE);
            const seqs = r.messages.map((m) => m.seq);
            drainedSeqs.push(...seqs);
            consecutiveEmpty = seqs.length === 0 ? consecutiveEmpty + 1 : 0;
          }
          const unionSeen = new Set([...returnedSeqs, ...drainedSeqs]);
          // No reply appears in BOTH the in-race set and the parent drain (each surfaces once total).
          expect(unionSeen.size).toBe(returnedSeqs.length + drainedSeqs.length);
          // The union is exactly the landed set — none skipped, none phantom.
          expect([...unionSeen].sort((a, b) => a - b)).toEqual(landedSeqs);

          // (3) UPSERT CONSISTENT — the final STORED cursor (read back out-of-band from the real
          // cursors table via the DataAccess port, AFTER the quiescent drain) equals the max
          // appender reply seq: the per-check setCursor UPSERT converged to ONE coherent
          // high-water-mark (no torn / duplicate cursor row) and the whole stream has been consumed.
          const storedCursor = await reader.getCursor(CHECKER_HANDLE);
          expect(storedCursor).toBe(maxLanded);
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
