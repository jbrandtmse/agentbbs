// Cross-process reply race (Story 4.3 QA, AC #4 — the GENUINE concurrency proof).
//
// THE GAP THIS CLOSES (judging the dev's deferral). The dev's AC #4 coverage — reply.test.ts
// (core, in-memory fake) and reply.integration.test.ts (real MCP + real ledger) — drives
// replies ONLY SEQUENTIALLY: each second reply is `await`ed AFTER the first has fully
// committed, so the activator-is-min-`seq` derivation is exercised against an already-present
// row, never against a genuine concurrent conflict. AC #4's actual claim is about CONCURRENT
// replies: "they receive sequential `seq`s, EXACTLY ONE (the lowest `seq`) is the activator
// with NO lock and NO error, and the other is an ordinary message." `reply` is a PLAIN append
// (no `appendGuarded`), so the guarantee rests on SQLite's single-writer serialization (Story
// 1.7's concurrency.test.ts proved that for `identity.seen` markers) — but the activator
// min-`seq` derivation under a real race, and the benign same-actor double-join dedup, are
// `reply`-specific guarantees NO existing test covers. This forks N real OS PROCESSES that
// reply to ONE shared proto-room SIMULTANEOUSLY and regresses both.
//
// Two scenarios (one worker file, selected by `mode`):
//   - DISTINCT members: N members each reply ONCE. EVERY room.replied lands (zero lost
//     writes), N strictly-increasing seqs (one total order), exactly ONE min-`seq` activator,
//     no error. The activator every worker reads back is the SAME min-`seq` reply.
//   - SAME non-member: N processes reply as the SAME non-member handle. Each independently
//     computes `alreadyMember=false` from the pre-race stream → each BUNDLES a board.joined
//     with its room.replied (one transaction). All N room.replied land, but the members
//     projection DE-DUPLICATES the concurrent board.joined to EXACTLY ONE member (the benign
//     double-join the design calls out — proven benign here, not just asserted in prose).
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3
// address space, so they would NOT exercise cross-process WAL locking — the mechanism that
// serializes the writers. We fork the BUILT worker (dist/reply-race-worker.js) as genuine OS
// processes via child_process.fork, with an IPC start barrier so all N reply together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a
// clean local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds
// @agentbbs/data-access if the worker dist is missing/older than its source). It is named
// `*.test.ts`, co-located under packages/*/src, and runs in the default Vitest project — the
// worker (`*-worker.ts`) is NOT matched by the test glob, so it is never collected as an
// empty test file (same structure as the post-announcement-race / concurrency suites).
//
// Hygiene: every DB lives under os.tmpdir() (never the repo's .agentbbs/); the temp tree +
// spawned children are removed/killed in finally/afterEach — no orphans even on failure.

import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  announceProject,
  findProject,
  foldRooms,
  joinBoard,
  postAnnouncement,
  register,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type {
  ReplyRaceMode,
  ReplyRaceWorkerResult,
} from './reply-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'reply-race-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'reply-race-worker.js');

// N racers: modest but > 1 so SQLite must serialize the writers on the single write lock.
// 8 gives healthy simultaneous contention on the one room while keeping the run fast.
const N_WORKERS = 8;
const BOARD_ID = 'calling-interface'; // a title that slugs to itself
const ROOM_SUBJECT = 'Need a reviewer';
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
  args: {
    dbPath: string;
    workerId: number;
    roomId: string;
    handle: string;
    mode: ReplyRaceMode;
  },
  onReady: (child: ChildProcess) => void,
): Promise<ReplyRaceWorkerResult> {
  return new Promise<ReplyRaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [args.dbPath, String(args.workerId), args.roomId, args.handle, args.mode],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: ReplyRaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as ReplyRaceWorkerResult;
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
 * Seed the shared ledger IN THE PARENT before forking and return the proto-room's roomId.
 * `seedMembers` controls who is a member: in DISTINCT mode every racer is pre-joined (so the
 * race is isolated to the room.replied append); in SAME-ACTOR mode the racer handle is a
 * registered NON-member (so every concurrent reply bundles a board.joined). member-0 always
 * announces the board (auto-joining it) and posts the proto-room.
 */
async function seedBoardAndRoom(
  dbPath: string,
  opts: {
    racerHandles: string[];
    seedMembers: boolean;
  },
): Promise<string> {
  const da = createDataAccess({ dbPath });
  try {
    // member-0 owns the board + the proto-room (always a member via announceProject).
    await register(da, { handle: memberHandle(0), currentFocus: 'owner' });
    await announceProject(da, memberHandle(0), {
      title: BOARD_ID,
      description: 'the shared board every racer replies into',
    });
    const room = await postAnnouncement(da, memberHandle(0), {
      projectId: BOARD_ID,
      subject: ROOM_SUBJECT,
      body: 'looking for a second pair of eyes',
    });

    // Register every distinct racer handle (a Set: same-actor mode passes one handle N times).
    for (const handle of new Set(opts.racerHandles)) {
      if (handle === memberHandle(0)) continue; // already registered above
      await register(da, { handle, currentFocus: `racer ${handle}` });
      if (opts.seedMembers) {
        await joinBoard(da, handle, BOARD_ID);
      }
    }
    return room.roomId;
  } finally {
    da.close();
  }
}

/**
 * Fork all N workers with a START BARRIER and collect their results. Forks every worker,
 * waits until each is `ready`, then broadcasts `go` so they all reply to the SAME room
 * together. The per-worker `handle` comes from `handles[id]`.
 */
async function runRace(
  dbPath: string,
  roomId: string,
  handles: string[],
  mode: ReplyRaceMode,
): Promise<ReplyRaceWorkerResult[]> {
  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<ReplyRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id += 1) {
    workerPromises.push(
      forkWorker(
        { dbPath, workerId: id, roomId, handle: handles[id] as string, mode },
        onReady,
      ),
    );
  }

  // Barrier: release all workers simultaneously once each has opened. Race against the
  // worker promises so a startup death surfaces now instead of a 60s hang.
  await Promise.race([allReady, Promise.all(workerPromises)]);
  for (const child of readyChildren) child.send({ type: 'go' });

  return Promise.all(workerPromises);
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

describe('cross-process reply race (AC #4 — plain-append concurrency under the real ledger)', () => {
  it(
    'N members reply to ONE proto-room concurrently → EVERY room.replied lands with a sequential seq, EXACTLY ONE min-seq activator, no error',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-reply-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        // Distinct members: member-0 … member-(N-1), all pre-joined to the board.
        const handles = Array.from({ length: N_WORKERS }, (_, id) =>
          memberHandle(id),
        );
        const roomId = await seedBoardAndRoom(dbPath, {
          racerHandles: handles,
          seedMembers: true,
        });

        const results = await runRace(dbPath, roomId, handles, 'distinct');

        // Every worker reported a clean reply (no error escaped — a throw would have made
        // the worker exit non-zero and rejected Promise.all before here).
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) expect(r.replied).toBe(true);

        // THE DURABLE LEDGER: exactly N room.replied rows (zero lost writes — every racer's
        // plain append committed), with N UNIQUE strictly-increasing seqs (one total order;
        // the concurrent plain appends were serialized by the single writer, no collision).
        const reader = createDataAccess({ dbPath });
        try {
          const replies = await reader.eventsByType('room.replied');
          expect(replies).toHaveLength(N_WORKERS);
          const seqs = replies.map((e) => e.seq);
          expect(new Set(seqs).size).toBe(N_WORKERS);
          for (let i = 1; i < seqs.length; i += 1) {
            expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
          }
          // Every racer is attributed exactly one reply (the full set, none lost/dup).
          expect(new Set(replies.map((e) => e.actor))).toEqual(
            new Set(handles),
          );

          // EXACTLY ONE activator, derived read-side as the MIN-seq reply — independent of
          // which worker happened to win the race. Fold the real ledger and assert it.
          const events = await reader.eventsSince(0);
          const room = foldRooms(events).get(roomId);
          expect(room?.active).toBe(true);
          const minSeqReply = replies.reduce((lo, e) =>
            e.seq < lo.seq ? e : lo,
          );
          expect(room?.activatedBy).toBe(minSeqReply.actor);
          expect(room?.activatedAtSeq).toBe(minSeqReply.seq);

          // Every worker, reading back AFTER its own reply, agrees on the SAME single
          // activator (the min-seq one) — the derivation is convergent, not per-writer.
          for (const r of results) {
            expect(r.activatedBy).toBe(minSeqReply.actor);
            expect(r.activatedAtSeq).toBe(minSeqReply.seq);
          }
        } finally {
          reader.close();
        }
      } finally {
        reapChildren();
        removeTempTree(dir);
      }
    },
  );

  it(
    'N concurrent first-replies by the SAME non-member → all room.replied land but the benign double board.joined dedups to EXACTLY ONE member',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-reply-race-same-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        // Every racer is the SAME registered NON-member handle. Each independently sees
        // itself as a non-member in the pre-race stream → each bundles a board.joined.
        const racer = 'newcomer';
        const handles = Array.from({ length: N_WORKERS }, () => racer);
        const roomId = await seedBoardAndRoom(dbPath, {
          racerHandles: handles,
          seedMembers: false, // the racer is NOT pre-joined (a registered non-member)
        });

        const results = await runRace(dbPath, roomId, handles, 'same-actor');
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) expect(r.replied).toBe(true);

        const reader = createDataAccess({ dbPath });
        try {
          // All N room.replied landed, every one attributed to the same racer.
          const replies = await reader.eventsByType('room.replied');
          expect(replies).toHaveLength(N_WORKERS);
          expect(replies.every((e) => e.actor === racer)).toBe(true);

          // The BENIGN DOUBLE-JOIN: under the race, more than one worker may have appended
          // a board.joined for the racer (each saw a non-member pre-state) — so the raw
          // board.joined COUNT for the racer can be ≥ 1. That is expected and harmless.
          const events = await reader.eventsSince(0);
          const racerJoins = (await reader.eventsByType('board.joined')).filter(
            (e) => e.actor === racer,
          );
          expect(racerJoins.length).toBeGreaterThanOrEqual(1);

          // THE GUARANTEE: the members projection DE-DUPLICATES those concurrent joins —
          // the racer is a member EXACTLY ONCE (a handle joining twice stays one member).
          const project = findProject(events, BOARD_ID);
          expect(project).toBeDefined();
          expect(project!.members.filter((m) => m === racer)).toHaveLength(1);
          // member-0 (owner) + the racer = two distinct members, no phantom duplicate.
          expect(new Set(project!.members)).toEqual(
            new Set([memberHandle(0), racer]),
          );

          // The room still resolves to a single min-seq activator (the racer), active.
          const room = foldRooms(events).get(roomId);
          expect(room?.active).toBe(true);
          expect(room?.activatedBy).toBe(racer);
          const minSeq = Math.min(...replies.map((e) => e.seq));
          expect(room?.activatedAtSeq).toBe(minSeq);
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
