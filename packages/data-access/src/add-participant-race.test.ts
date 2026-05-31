// Cross-process add_participant race (Story 4.5 QA — the GENUINE concurrency proof).
//
// THE GAP THIS CLOSES (judging the dev's explicit deferral). The dev's Story 4.5 suite proves
// every AC, but drives `add_participant` ONLY SEQUENTIALLY: add-participant.test.ts (core, the
// in-memory fake) and add-participant.integration.test.ts (real MCP + real ledger) each `await`
// one add fully before the next, so the benign-double-add dedup is exercised only as a pure
// projection property (participants.test.ts: a handle added twice folds to one) — never against
// a genuine concurrent conflict on the real ledger. `addParticipant` is a PLAIN append (no
// `appendGuarded`); the story's Design decision 4 CLAIMS "a benign concurrent double-add is
// deduped by the participants/members projections (plain append, no guard needed)." That claim
// rests on SQLite's single-writer serialization (Story 1.7's concurrency.test.ts proved it for
// `identity.seen`; reply-race.test.ts proved the analogous reply double-join), but the
// add_participant-specific shape — N processes each appending BOTH a room.participant_added AND
// a board.joined for the SAME target, then the projections collapsing to exactly-one-participant
// + exactly-one-member — is a guarantee NO existing test covers. This forks N real OS PROCESSES
// that add the SAME target to ONE room SIMULTANEOUSLY and regresses both halves of the dedup.
//
// The scenario (one worker file, one mode — this op has no second concurrency claim):
//   - N DISTINCT, already-seated participants (each replied during seeding, so the participation
//     GATE passes for every adder) ALL add the SAME registered NON-member target at once. Each
//     independently computes, from the pre-race stream, that the target is NOT yet a participant
//     and NOT yet a member → each BUNDLES room.participant_added + the target's board.joined in
//     ONE transaction. Under the race MORE THAN ONE may land both (the benign double-add). THE
//     GUARANTEE regressed here: every room.participant_added lands (zero lost writes, strictly
//     increasing seqs, no error), the participants projection collapses the target to EXACTLY
//     ONE participant, AND the members projection collapses the target's joins to EXACTLY ONE
//     board member. No duplicate participant, no duplicate membership, no thrown error.
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3
// address space, so they would NOT exercise cross-process WAL locking — the mechanism that
// serializes the writers. We fork the BUILT worker (dist/add-participant-race-worker.js) as
// genuine OS processes via child_process.fork, with an IPC start barrier so all N add together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a
// clean local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds
// @agentbbs/data-access if the worker dist is missing/older than its source). It is named
// `*.test.ts`, co-located under packages/*/src, and runs in the default Vitest project — the
// worker (`*-worker.ts`) is NOT matched by the test glob `packages/*/src/**/*.test.{ts,tsx}`,
// so it is never collected as an empty test file (same structure as the reply-race /
// post-announcement-race / concurrency suites).
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
  isParticipant,
  postAnnouncement,
  register,
  reply,
  roomParticipants,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { AddParticipantRaceWorkerResult } from './add-participant-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'add-participant-race-worker.ts');
const WORKER_DIST = join(
  PACKAGE_ROOT,
  'dist',
  'add-participant-race-worker.js',
);

// N racers: modest but > 1 so SQLite must serialize the writers on the single write lock.
// 8 gives healthy simultaneous contention on the one room while keeping the run fast.
const N_WORKERS = 8;
const BOARD_ID = 'calling-interface'; // a title that slugs to itself
const ROOM_SUBJECT = 'Need a reviewer';
const TARGET = 'newcomer'; // the single registered NON-member every racer pulls in
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
    adder: string;
    target: string;
  },
  onReady: (child: ChildProcess) => void,
): Promise<AddParticipantRaceWorkerResult> {
  return new Promise<AddParticipantRaceWorkerResult>(
    (resolvePromise, rejectPromise) => {
      const child = fork(
        WORKER_DIST,
        [
          args.dbPath,
          String(args.workerId),
          args.roomId,
          args.adder,
          args.target,
        ],
        { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
      );
      liveChildren.add(child);

      let result: AddParticipantRaceWorkerResult | undefined;
      let settled = false;

      child.on('message', (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return;
        const tag = (msg as { type?: unknown }).type;
        if (tag === 'ready') {
          onReady(child);
        } else if (tag === 'done') {
          result = msg as AddParticipantRaceWorkerResult;
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
              `worker ${args.workerId} exited code=${String(
                code,
              )} signal=${String(signal)} resultReceived=${String(
                Boolean(result),
              )}`,
            ),
          );
        }
      });
    },
  );
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

/** A distinct adder/participant handle for racer `id`. */
function adderHandle(id: number): string {
  return `adder-${id}`;
}

/**
 * Seed the shared ledger IN THE PARENT before forking and return the proto-room's roomId.
 * adder-0 announces the board (auto-joining it) and posts the proto-room. EVERY adder-{id}
 * registers and REPLIES to the room, so each is a seated PARTICIPANT (the participation gate
 * passes for every racer) AND a board member. The shared `TARGET` registers as a NON-member,
 * NON-participant — the peer every racer concurrently pulls in. After seeding, the room is
 * ACTIVE, its participants are {adder-0 … adder-(N-1)}, and the board members are the same set;
 * the target is neither.
 */
async function seedBoardRoomAndParticipants(dbPath: string): Promise<string> {
  const da = createDataAccess({ dbPath });
  try {
    // adder-0 owns the board + the proto-room (a member via announceProject).
    await register(da, { handle: adderHandle(0), currentFocus: 'owner' });
    await announceProject(da, adderHandle(0), {
      title: BOARD_ID,
      description: 'the shared board every racer adds the target into',
    });
    const room = await postAnnouncement(da, adderHandle(0), {
      projectId: BOARD_ID,
      subject: ROOM_SUBJECT,
      body: 'looking for a second pair of eyes',
    });

    // Every adder (including adder-0) replies so it is a SEATED participant of the room — the
    // participation gate passes for all N. adder-0 is already a board member (announced); the
    // rest auto-join the board on their reply.
    for (let id = 0; id < N_WORKERS; id += 1) {
      const handle = adderHandle(id);
      if (id !== 0) {
        await register(da, { handle, currentFocus: `participant ${handle}` });
      }
      await reply(da, handle, {
        roomId: room.roomId,
        body: `seating reply from ${handle}`,
      });
    }

    // The shared target: a registered NON-member, NON-participant (never replied, never joined).
    await register(da, { handle: TARGET, currentFocus: 'the pulled-in peer' });

    return room.roomId;
  } finally {
    da.close();
  }
}

/**
 * Fork all N workers with a START BARRIER and collect their results. Forks every worker, waits
 * until each is `ready`, then broadcasts `go` so they all add the SAME target into the SAME room
 * together. Worker `id` acts as participant `adder-{id}`; all share the one `TARGET`.
 */
async function runRace(
  dbPath: string,
  roomId: string,
): Promise<AddParticipantRaceWorkerResult[]> {
  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<AddParticipantRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id += 1) {
    workerPromises.push(
      forkWorker(
        {
          dbPath,
          workerId: id,
          roomId,
          adder: adderHandle(id),
          target: TARGET,
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
  // BUILD-IF-MISSING/STALE: the test forks the built worker. Ensure dist exists and is at least
  // as new as its source (see Story 1.7 concurrency.test.ts rationale). `tsc -b --force`
  // rebuilds + emits unconditionally so a stale .tsbuildinfo can't skip emit.
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

describe('cross-process add_participant race (Story 4.5 — benign double-add dedup under the real ledger)', () => {
  it(
    'N participants concurrently add the SAME non-member target → every room.participant_added lands, no error, and the projections dedup to EXACTLY ONE participant + EXACTLY ONE board member',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-addpart-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        const roomId = await seedBoardRoomAndParticipants(dbPath);

        const results = await runRace(dbPath, roomId);

        // NOTE (empirically verified during authoring): under the IPC start barrier all N=8
        // workers reliably collide before any commit is visible, so EVERY worker computes a
        // non-participant/non-member pre-state and appends BOTH a room.participant_added AND a
        // board.joined for the target — the ledger holds N duplicate adds + N duplicate joins
        // that the projections must collapse. The assertions below use a `>= 1` lower bound so
        // they stay correct at ANY contention level (never flaky), but the dedup is genuinely
        // exercised against maximal contention, not a trivial single-add pass.

        // Every worker reported a clean add (no error escaped — a throw would have made the
        // worker exit non-zero and rejected Promise.all before here). The benign double-add is
        // NOT supposed to error: that is the core of the claim.
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) expect(r.added).toBe(true);

        // Every worker, reading back AFTER its own add, already saw the target as EXACTLY ONE
        // participant (the projection de-dups per-read; no worker ever observed a duplicate).
        for (const r of results) expect(r.targetParticipantCount).toBe(1);

        const reader = createDataAccess({ dbPath });
        try {
          const events = await reader.eventsSince(0);

          // ZERO LOST WRITES: at least one room.participant_added for the target landed (under
          // the race ≥1 worker bundled one — possibly several), every one attributed correctly
          // (actor = some adder, payload.handle = the target), with strictly-increasing seqs
          // (one total order; the concurrent plain appends were serialized, no collision).
          // Narrow on the `type` discriminant (the Event union → payload.{roomId,handle} only
          // type once narrowed; `eventsByType` returns the broad union statically).
          const targetAdds = (
            await reader.eventsByType('room.participant_added')
          )
            .filter((e) => e.type === 'room.participant_added')
            .filter((e) => e.payload.handle === TARGET);
          expect(targetAdds.length).toBeGreaterThanOrEqual(1);
          const adderHandles = new Set(
            Array.from({ length: N_WORKERS }, (_, id) => adderHandle(id)),
          );
          for (const e of targetAdds) {
            expect(e.payload.roomId).toBe(roomId);
            expect(adderHandles.has(e.actor)).toBe(true);
          }
          const addSeqs = targetAdds.map((e) => e.seq);
          expect(new Set(addSeqs).size).toBe(addSeqs.length); // all unique
          for (let i = 1; i < addSeqs.length; i += 1) {
            expect(addSeqs[i]).toBeGreaterThan(addSeqs[i - 1] as number);
          }

          // THE BENIGN DOUBLE-JOIN half: under the race more than one worker may have appended a
          // board.joined for the target (each saw a non-member pre-state) — so the raw count can
          // be ≥ 1. Expected and harmless; the projection is what must collapse it.
          const targetJoins = (
            await reader.eventsByType('board.joined')
          ).filter((e) => e.actor === TARGET);
          expect(targetJoins.length).toBeGreaterThanOrEqual(1);

          // THE GUARANTEE #1 — PARTICIPATION dedup: the participants projection collapses the
          // concurrent adds so the target is a participant EXACTLY ONCE (a handle added N times
          // stays one participant), and is genuinely present (isParticipant agrees).
          const participants = roomParticipants(events, roomId);
          expect(participants.filter((h) => h === TARGET)).toHaveLength(1);
          expect(isParticipant(events, roomId, TARGET)).toBe(true);
          // The full participant set is the seated adders + the one target, no phantom dup.
          expect(new Set(participants)).toEqual(
            new Set([
              ...Array.from({ length: N_WORKERS }, (_, id) => adderHandle(id)),
              TARGET,
            ]),
          );
          // Set size == array length ⇒ the WHOLE list is duplicate-free, not just the target.
          expect(new Set(participants).size).toBe(participants.length);

          // THE GUARANTEE #2 — MEMBERSHIP dedup: the members projection collapses the concurrent
          // board.joined so the target is a board member EXACTLY ONCE.
          const project = findProject(events, BOARD_ID);
          expect(project).toBeDefined();
          expect(project!.members.filter((m) => m === TARGET)).toHaveLength(1);
          // The members are the seated adders + the one target, no phantom duplicate.
          expect(new Set(project!.members)).toEqual(
            new Set([
              ...Array.from({ length: N_WORKERS }, (_, id) => adderHandle(id)),
              TARGET,
            ]),
          );
          expect(new Set(project!.members).size).toBe(project!.members.length);
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
