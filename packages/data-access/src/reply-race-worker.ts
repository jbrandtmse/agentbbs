// Cross-process reply race WORKER (Story 4.3 QA, AC #4 — the GENUINE concurrency proof).
//
// The per-process worker the reply-race orchestrator forks as a SEPARATE OS PROCESS (not a
// worker_thread — threads share one process + one better-sqlite3 address space and would
// NOT faithfully exercise cross-process WAL locking, the very thing under test). Every
// worker opens the SAME shared SQLite ledger via the REAL `createDataAccess` and replies to
// the SAME proto-room through the REAL `core.reply` path (room lookup → membership check →
// PLAIN `append` of `room.replied` + a conditional `board.joined`). NOTHING is stubbed.
//
// Why this is DISTINCT from the post-announcement-race / register-race workers:
//   - register's guard REJECTS on conflict (one winner, the rest HANDLE_TAKEN);
//   - post-announcement RETRIES with a bumped disambiguator (all win with distinct ids);
//   - reply is a PLAIN append (NO `appendGuarded`, NO uniqueness guard) — so under a genuine
//     N-way race EVERY worker's `room.replied` simply LANDS with its own monotonic `seq`,
//     zero lost writes, zero errors, and the single activator is a PURE read-side min-`seq`
//     derivation (the rooms projection). This worker proves "no lock, no error, both land"
//     against the REAL SQLite single-writer serialization — the mechanism that guarantees it.
//
// Two scenarios, selected by the `mode` arg (so ONE worker file serves both):
//   - mode 'distinct': each worker acts as its OWN member handle (`handle` arg) and replies
//     once. All N land; exactly one (min-`seq`) is the activator.
//   - mode 'same-actor': every worker acts as the SAME non-member handle (so each independently
//     computes `alreadyMember=false` from the pre-race stream and BUNDLES a `board.joined`
//     with its `room.replied`). All N land; the benign concurrent double-join is de-duplicated
//     by the members projection to exactly ONE member — the orchestrator asserts that.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port direction;
// lint-allowed) — so the worker drives the very `reply` op the MCP tool delegates to, making
// this the regressable proof of AC #4 at the real ledger layer.
//
// Mechanism (mirrors Story 2.2's register-race-worker): forked via child_process.fork of
// THIS file's BUILT artifact (dist/reply-race-worker.js); args on argv, result back over
// IPC. The board + member identities + the proto-room are seeded BY THE PARENT before
// forking. START BARRIER: open, send {type:'ready'}, BLOCK on {type:'go'}, then all N
// workers reply to the SAME room near-simultaneously — maximal write-write contention on
// the one ledger.

import { setTimeout as delay } from 'node:timers/promises';

import { reply } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** Which race scenario this worker participates in (see file header). */
export type ReplyRaceMode = 'distinct' | 'same-actor';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — for attribution in diagnostics + its reply body. */
  workerId: number;
  /** The room every worker races to reply to (the parent seeded the proto-room). */
  roomId: string;
  /** The handle this worker acts as (a distinct member, or the shared non-member). */
  handle: string;
  /** The scenario (distinct members vs. one shared non-member). */
  mode: ReplyRaceMode;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface ReplyRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** The handle this worker replied as. */
  handle: string;
  /** The `seq` of THIS worker's just-appended `room.replied` (the durable order key). */
  replySeq: number;
  /** The room's derived activator handle as read back AFTER this worker's reply. */
  activatedBy: string | undefined;
  /** The room's derived `activatedAtSeq` as read back after this worker's reply. */
  activatedAtSeq: number | undefined;
  /** True iff `reply` resolved with an active room (no error escaped). */
  replied: boolean;
}

/** Parse the positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, roomId, handle, modeRaw] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  if (roomId === undefined || roomId.length === 0) {
    throw new Error('worker: missing roomId arg');
  }
  if (handle === undefined || handle.length === 0) {
    throw new Error('worker: missing handle arg');
  }
  if (modeRaw !== 'distinct' && modeRaw !== 'same-actor') {
    throw new Error(`worker: bad mode "${modeRaw ?? ''}"`);
  }
  return { dbPath, workerId, roomId, handle, mode: modeRaw };
}

/** Resolve once the parent sends `{ type: 'go' }` over the IPC channel. */
function waitForGo(): Promise<void> {
  return new Promise((resolve) => {
    const onMessage = (msg: unknown): void => {
      if (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { type?: unknown }).type === 'go'
      ) {
        process.off('message', onMessage);
        resolve();
      }
    };
    process.on('message', onMessage);
  });
}

/** Send a message to the parent, asserting the IPC channel exists. */
function sendToParent(
  message: ReplyRaceWorkerResult | { type: 'ready' },
): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently so the
  // worker tolerates being first, though the parent has already migrated + seeded).
  const da = createDataAccess({ dbPath: args.dbPath });

  // BARRIER: announce readiness, then block until the orchestrator says go, so all N
  // processes reply to the SAME room together (maximal contention on the single writer).
  sendToParent({ type: 'ready' });
  await waitForGo();

  // The real op: room lookup → membership check → PLAIN append of room.replied (+ a
  // conditional board.joined for a non-member). Under the race there is NO uniqueness
  // guard to trip — every worker's append simply lands with its own monotonic seq. Any
  // throw is a genuine failure (no expected loser outcome, unlike register-race): we do
  // NOT swallow it — rethrow so the worker exits non-zero and the orchestrator's
  // Promise.all rejects (loud, diagnosable; never silent loss).
  let room;
  try {
    room = await reply(da, args.handle, {
      roomId: args.roomId,
      body: `reply from worker ${args.workerId} (${args.mode})`,
    });
  } catch (err) {
    da.close();
    throw err;
  }

  // Read THIS worker's own room.replied seq back from the durable ledger (the highest
  // room.replied seq attributed to this worker — there is exactly one per worker in the
  // distinct mode; in same-actor mode every reply shares the handle, so take the max,
  // which is this worker's since it just appended and the read is after its commit).
  const replies = await da.eventsByType('room.replied');
  const mine = replies.filter((e) => e.actor === args.handle);
  const replySeq = mine.length > 0 ? (mine[mine.length - 1]?.seq ?? -1) : -1;

  da.close();

  sendToParent({
    type: 'done',
    workerId: args.workerId,
    handle: args.handle,
    replySeq,
    activatedBy: room.activatedBy,
    activatedAtSeq: room.activatedAtSeq,
    replied: room.active,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `reply-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
