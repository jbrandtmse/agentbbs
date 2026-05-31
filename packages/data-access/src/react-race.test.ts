// Cross-process react/unreact race (Story 5.2 QA — the GENUINE concurrency proof).
//
// THE GAP THIS CLOSES (a guarantee the dev's strong-but-SEQUENTIAL suite cannot reach). The
// dev's AC #1/#2 coverage — react.test.ts (core, in-memory fake) and react.integration.test.ts
// (real MCP + real ledger) — drives react/unreact ONLY SEQUENTIALLY: each op is `await`ed AFTER
// the prior has fully committed, so the latest-react-wins live projection is exercised against an
// already-settled stream, never against a genuine concurrent conflict. Story 5.2 has NO
// concurrency-claiming AC, but reactions are inherently concurrent (multiple actors react/unreact
// the same message), and the live set is the input Story 5.3's current-contract reads — so its
// faithfulness under real cross-process contention is load-bearing. `react`/`unreact` are PLAIN
// appends (no `appendGuarded`), so the guarantee rests on SQLite's single-writer serialization
// (Story 1.7's concurrency.test.ts proved unique monotonic seqs; Story 4.3's reply-race proved a
// plain-append op survives an N-way race with zero lost writes — but reaction LIVENESS is a
// DIFFERENT projection: latest-react-wins per actor, not min-seq activation). This forks N real
// OS PROCESSES that react/unreact ONE shared message SIMULTANEOUSLY and regresses two
// reaction-specific guarantees no existing test covers.
//
// Two scenarios (one worker file, selected by `mode`):
//   - DISTINCT reactors: N distinct, already-seated participants each react the SAME message
//     ONCE, concurrently. EVERY message.reacted lands (zero lost reactions), N strictly-
//     increasing seqs (one total order), no error, and the live-reactor set CONVERGES to EXACTLY
//     all N (the live projection is a faithful aggregate of the concurrent appends — no lost
//     reaction, no phantom).
//   - SAME-actor FLAP: ONE participant fires N alternating react/unreact ops on the SAME message
//     concurrently (even ids react, odd ids unreact — appended directly so every flap lands a
//     row). All N rows land; the FINAL live state is the deterministic latest-wins-by-`seq`
//     outcome — live IFF the HIGHEST-`seq` row among them is a react — proving the projection
//     resolves a genuine same-actor race to one unambiguous state (not a coin-flip).
//
// Why real processes (not worker_threads): threads share one process + one better-sqlite3
// address space, so they would NOT exercise cross-process WAL locking — the mechanism that
// serializes the writers and makes `seq` a correct total order. We fork the BUILT worker
// (dist/react-race-worker.js) as genuine OS processes via child_process.fork, with an IPC start
// barrier so all N react/unreact together.
//
// Build dependency (Rule 8): the test forks a BUILT artifact. CI builds before test; for a clean
// local `pnpm test` this file is BUILD-IF-MISSING/STALE (beforeAll rebuilds @agentbbs/data-access
// if the worker dist is missing/older than its source). It is named `*.test.ts`, co-located under
// packages/*/src, and runs in the default Vitest project — the worker (`*-worker.ts`) is NOT
// matched by the test glob, so it is never collected as an empty test file (same structure as the
// reply-race / post-announcement-race / concurrency suites). Thus it is discoverable by the
// default `vitest run` (Rule 8).
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
  joinBoard,
  liveReactors,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type {
  ReactRaceMode,
  ReactRaceWorkerResult,
} from './react-race-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../data-access/src
const PACKAGE_ROOT = resolve(HERE, '..'); // .../data-access
const WORKER_SRC = join(HERE, 'react-race-worker.ts');
const WORKER_DIST = join(PACKAGE_ROOT, 'dist', 'react-race-worker.js');

// N racers: modest but > 1 so SQLite must serialize the writers on the single write lock. 8 gives
// healthy simultaneous contention on the one message while keeping the run fast.
const N_WORKERS = 8;
const BOARD_ID = 'calling-interface'; // a title that slugs to itself
const ROOM_SUBJECT = 'Need a reviewer';
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
    messageSeq: number;
    handle: string;
    mode: ReactRaceMode;
  },
  onReady: (child: ChildProcess) => void,
): Promise<ReactRaceWorkerResult> {
  return new Promise<ReactRaceWorkerResult>((resolvePromise, rejectPromise) => {
    const child = fork(
      WORKER_DIST,
      [
        args.dbPath,
        String(args.workerId),
        String(args.messageSeq),
        args.handle,
        args.mode,
      ],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    liveChildren.add(child);

    let result: ReactRaceWorkerResult | undefined;
    let settled = false;

    child.on('message', (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return;
      const tag = (msg as { type?: unknown }).type;
      if (tag === 'ready') {
        onReady(child);
      } else if (tag === 'done') {
        result = msg as ReactRaceWorkerResult;
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

/** A participant handle for racer `id`. */
function memberHandle(id: number): string {
  return `member-${id}`;
}

/**
 * Seed the shared ledger IN THE PARENT before forking and return the SEQ of the message under
 * test (cleo's reply — a non-announcement message). member-0 announces the board (auto-joining)
 * and posts the proto-room; then every distinct racer handle REPLIES (so each is a seated
 * participant whose react gate passes), and a final extra participant `cleo` replies — cleo's
 * reply is the shared target message. Returns its `seq`.
 *
 * In FLAP mode `racerHandles` is the same handle N times; we register + reply it ONCE (a Set), so
 * the flapping actor is a single seated participant.
 */
async function seedBoardRoomAndTarget(
  dbPath: string,
  racerHandles: string[],
): Promise<number> {
  const da = createDataAccess({ dbPath });
  try {
    // member-0 owns the board + the proto-room (a member via announceProject).
    await register(da, { handle: memberHandle(0), currentFocus: 'owner' });
    await announceProject(da, memberHandle(0), {
      title: BOARD_ID,
      description: 'the shared board every racer reacts in',
    });
    const room = await postAnnouncement(da, memberHandle(0), {
      projectId: BOARD_ID,
      subject: ROOM_SUBJECT,
      body: 'looking for a second pair of eyes',
    });

    // member-0 replies so it is a seated participant too (it announced but had not replied).
    await reply(da, memberHandle(0), {
      roomId: room.roomId,
      body: `seed reply from ${memberHandle(0)}`,
    });

    // Register + reply every distinct racer handle (a Set: flap mode passes one handle N times),
    // so each is a seated participant of the room (the react/unreact gate passes for all).
    for (const handle of new Set(racerHandles)) {
      if (handle === memberHandle(0)) continue; // already seated above
      await register(da, { handle, currentFocus: `racer ${handle}` });
      await joinBoard(da, handle, BOARD_ID);
      await reply(da, handle, {
        roomId: room.roomId,
        body: `seed reply from ${handle}`,
      });
    }

    // The SHARED target message: a final participant `cleo` posts a reply every racer reacts to.
    await register(da, { handle: 'cleo', currentFocus: 'the target author' });
    await joinBoard(da, 'cleo', BOARD_ID);
    const targetSeqs = await da.eventsByType('room.replied');
    const cleoReply = await (async () => {
      await reply(da, 'cleo', {
        roomId: room.roomId,
        body: 'me too — react to this one',
      });
      const replies = await da.eventsByType('room.replied');
      return replies[replies.length - 1];
    })();
    expect(cleoReply).toBeDefined();
    expect(cleoReply!.actor).toBe('cleo');
    // Sanity: the target seq is beyond every seeding reply (it is the last reply appended).
    for (const e of targetSeqs) {
      expect(cleoReply!.seq).toBeGreaterThan(e.seq);
    }
    return cleoReply!.seq;
  } finally {
    da.close();
  }
}

/**
 * Fork all N workers with a START BARRIER and collect their results. Forks every worker, waits
 * until each is `ready`, then broadcasts `go` so they all react/unreact the SAME message
 * together. The per-worker `handle` comes from `handles[id]`.
 */
async function runRace(
  dbPath: string,
  messageSeq: number,
  handles: string[],
  mode: ReactRaceMode,
): Promise<ReactRaceWorkerResult[]> {
  const readyChildren: ChildProcess[] = [];
  let resolveAllReady: () => void;
  const allReady = new Promise<void>((r) => {
    resolveAllReady = r;
  });
  const onReady = (child: ChildProcess): void => {
    readyChildren.push(child);
    if (readyChildren.length === N_WORKERS) resolveAllReady();
  };

  const workerPromises: Promise<ReactRaceWorkerResult>[] = [];
  for (let id = 0; id < N_WORKERS; id += 1) {
    workerPromises.push(
      forkWorker(
        {
          dbPath,
          workerId: id,
          messageSeq,
          handle: handles[id] as string,
          mode,
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
  // as new as its source (see Story 1.7 concurrency.test.ts rationale). `tsc -b --force` rebuilds
  // + emits unconditionally so a stale .tsbuildinfo can't skip emit.
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

describe('cross-process react/unreact race (Story 5.2 — plain-append reaction concurrency under the real ledger)', () => {
  it(
    'N distinct participants react ONE message concurrently → EVERY message.reacted lands with a sequential seq, no error, and the live set converges to EXACTLY all N',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-react-race-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        // Distinct participants member-0 … member-(N-1), all seated (each replied during seeding).
        const handles = Array.from({ length: N_WORKERS }, (_, id) =>
          memberHandle(id),
        );
        const messageSeq = await seedBoardRoomAndTarget(dbPath, handles);

        const results = await runRace(dbPath, messageSeq, handles, 'distinct');

        // Every worker reported a clean react (no error escaped — a throw would have made the
        // worker exit non-zero and rejected Promise.all before here).
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) {
          expect(r.ok).toBe(true);
          expect(r.op).toBe('react');
        }

        const reader = createDataAccess({ dbPath });
        try {
          // THE DURABLE LEDGER: exactly N message.reacted rows for the target (zero lost
          // reactions — every racer's plain append committed), with N UNIQUE strictly-increasing
          // seqs (one total order; the concurrent plain appends were serialized by the single
          // writer, no collision).
          const reacted = (await reader.eventsByType('message.reacted')).filter(
            (e) =>
              e.type === 'message.reacted' &&
              e.payload.messageSeq === messageSeq,
          );
          expect(reacted).toHaveLength(N_WORKERS);
          const seqs = reacted.map((e) => e.seq);
          expect(new Set(seqs).size).toBe(N_WORKERS);
          for (let i = 1; i < seqs.length; i += 1) {
            expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
          }
          // Every racer is attributed exactly one reaction (the full set, none lost/dup).
          expect(new Set(reacted.map((e) => e.actor))).toEqual(
            new Set(handles),
          );

          // CONVERGENCE: the live-reactor set folded from the real ledger is EXACTLY all N
          // racers — the live projection faithfully aggregates the concurrent appends.
          const events = await reader.eventsSince(0);
          expect(new Set(liveReactors(events, messageSeq))).toEqual(
            new Set(handles),
          );

          // Every worker, reading back AFTER its own react, already saw itself live (its own
          // reaction landed) — the read-back is consistent per writer.
          for (const r of results) {
            expect(r.liveAfter).toBeDefined();
            expect(r.liveAfter).toContain(r.handle);
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
    'ONE actor flapping react/unreact on the SAME message concurrently → the FINAL live state is the deterministic latest-wins-by-seq outcome (live iff the highest-seq op is a react)',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'agentbbs-react-race-flap-'));
      const dbPath = join(dir, '.agentbbs', 'agentbbs.db');
      try {
        // Every racer is the SAME seated participant `flapper` (registered + replied ONCE).
        const flapper = 'flapper';
        const handles = Array.from({ length: N_WORKERS }, () => flapper);
        const messageSeq = await seedBoardRoomAndTarget(dbPath, handles);

        const results = await runRace(dbPath, messageSeq, handles, 'flap');
        expect(results).toHaveLength(N_WORKERS);
        for (const r of results) {
          expect(r.ok).toBe(true);
          expect(r.handle).toBe(flapper);
        }

        const reader = createDataAccess({ dbPath });
        try {
          // Every flap landed exactly one row (N rows total across reacted+unreacted for the
          // target by the flapper) — append-only, zero lost writes, all attributed to flapper.
          const reacted = (await reader.eventsByType('message.reacted')).filter(
            (e) =>
              e.type === 'message.reacted' &&
              e.payload.messageSeq === messageSeq &&
              e.actor === flapper,
          );
          const unreacted = (
            await reader.eventsByType('message.unreacted')
          ).filter(
            (e) =>
              e.type === 'message.unreacted' &&
              e.payload.messageSeq === messageSeq &&
              e.actor === flapper,
          );
          expect(reacted.length + unreacted.length).toBe(N_WORKERS);

          // The N rows carry N unique strictly-increasing seqs (one total order — the single
          // writer serialized the genuinely-concurrent flaps).
          const allSeqs = [...reacted, ...unreacted]
            .map((e) => e.seq)
            .sort((a, b) => a - b);
          expect(new Set(allSeqs).size).toBe(N_WORKERS);

          // THE GUARANTEE: latest-wins-by-seq is UNAMBIGUOUS. The op that won the race is the row
          // with the MAXIMUM seq; the flapper is live IFF that row is a message.reacted. Compute
          // the expected outcome independently of the projection, then assert the projection agrees.
          const maxReactedSeq =
            reacted.length > 0 ? Math.max(...reacted.map((e) => e.seq)) : -1;
          const maxUnreactedSeq =
            unreacted.length > 0
              ? Math.max(...unreacted.map((e) => e.seq))
              : -1;
          const expectedLive = maxReactedSeq > maxUnreactedSeq;

          const events = await reader.eventsSince(0);
          const live = liveReactors(events, messageSeq);
          expect(live.includes(flapper)).toBe(expectedLive);
          // The live set is EITHER exactly [flapper] (won by a react) or [] (won by an unreact) —
          // never a phantom or duplicate, whichever op happened to get the highest seq.
          expect(live).toEqual(expectedLive ? [flapper] : []);
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
