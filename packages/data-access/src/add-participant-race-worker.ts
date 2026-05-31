// Cross-process add_participant race WORKER (Story 4.5 QA — the GENUINE concurrency proof).
//
// The per-process worker the add-participant-race orchestrator forks as a SEPARATE OS PROCESS
// (not a worker_thread — threads share one process + one better-sqlite3 address space and would
// NOT faithfully exercise cross-process WAL locking, the very mechanism under test). Every
// worker opens the SAME shared SQLite ledger via the REAL `createDataAccess` and pulls the SAME
// target into the SAME room through the REAL `core.addParticipant` path (room lookup →
// participation gate → target resolution → idempotency check → PLAIN `append` of
// `room.participant_added` + a conditional `board.joined` for the target). NOTHING is stubbed.
//
// THE CLAIM UNDER TEST (the dev's explicit deferral). `addParticipant` is a PLAIN append (NO
// `appendGuarded`, NO uniqueness guard): the story's Design decision 4 asserts "a benign
// concurrent double-add is deduped by the participants/members projections (plain append, no
// guard needed)." The participants-projection dedup is a pure-fold property already unit-proven
// (participants.test.ts: a handle added twice appears once). What NO existing test proves is
// that the dedup HOLDS under genuine cross-process contention: when N real processes each
// independently compute `target is NOT yet a participant` AND `target is NOT yet a member` from
// the same pre-race stream, every one of them appends both a `room.participant_added` AND a
// `board.joined` for that target — and the read-side projections must still resolve the target
// to EXACTLY ONE participant and EXACTLY ONE board member, with zero errors and zero lost
// writes. This worker forks the race; the orchestrator regresses that guarantee against the
// real ledger.
//
// The single scenario (this op has no second mode like reply's distinct/same-actor — the only
// concurrency claim is the benign double-add dedup): every worker is a DISTINCT, already-seated
// participant of the room (each replied during seeding, so the participation GATE passes for
// all), and they ALL add the SAME registered NON-member target simultaneously. Each sees the
// target as a non-participant non-member in the pre-race stream, so each bundles
// room.participant_added + the target's board.joined in one transaction.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port direction;
// lint-allowed) — so the worker drives the very `addParticipant` op the MCP tool delegates to,
// making this the regressable proof at the real ledger layer.
//
// Mechanism (mirrors reply-race-worker): forked via child_process.fork of THIS file's BUILT
// artifact (dist/add-participant-race-worker.js); args on argv, result back over IPC. The board
// + the participant identities + the proto-room + every adder's seeding reply are seeded BY THE
// PARENT before forking. START BARRIER: open, send {type:'ready'}, BLOCK on {type:'go'}, then
// all N workers add the SAME target near-simultaneously — maximal write-write contention on the
// one ledger.

import { setTimeout as delay } from 'node:timers/promises';

import { addParticipant } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — for attribution in diagnostics. */
  workerId: number;
  /** The room every worker races to add the target into (the parent seeded it). */
  roomId: string;
  /** The handle this worker acts as — a DISTINCT, already-seated participant (the adder). */
  adder: string;
  /** The SHARED target handle every worker concurrently pulls into the room. */
  target: string;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface AddParticipantRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** The adder handle this worker acted as. */
  adder: string;
  /** True iff `addParticipant` resolved without throwing (no error escaped). */
  added: boolean;
  /**
   * The target's participant-count as THIS worker read it back AFTER its own add (the number
   * of times the target appears in the room's participants list — MUST be 1 even under the
   * race, since the projection de-dups). Lets the orchestrator assert every worker converges
   * on the de-duplicated single-participant view, not just the final out-of-band read.
   */
  targetParticipantCount: number;
}

/** Parse the positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, roomId, adder, target] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  if (roomId === undefined || roomId.length === 0) {
    throw new Error('worker: missing roomId arg');
  }
  if (adder === undefined || adder.length === 0) {
    throw new Error('worker: missing adder arg');
  }
  if (target === undefined || target.length === 0) {
    throw new Error('worker: missing target arg');
  }
  return { dbPath, workerId, roomId, adder, target };
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
  message: AddParticipantRaceWorkerResult | { type: 'ready' },
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
  // processes add the SAME target together (maximal contention on the single writer).
  sendToParent({ type: 'ready' });
  await waitForGo();

  // The real op: room lookup → participation gate (this worker's adder is a seated participant)
  // → target resolution → idempotency check → PLAIN append of room.participant_added (+ the
  // target's conditional board.joined). Under the race there is NO uniqueness guard to trip:
  // every worker that computed a non-participant pre-state simply lands its append with its own
  // monotonic seq. Any throw is a genuine failure (a benign double-add is NOT supposed to error
  // — that is the whole claim): we do NOT swallow it — rethrow so the worker exits non-zero and
  // the orchestrator's Promise.all rejects (loud, diagnosable; never silent loss).
  let result;
  try {
    result = await addParticipant(da, args.adder, {
      roomId: args.roomId,
      handle: args.target,
    });
  } catch (err) {
    da.close();
    throw err;
  }

  // How many times does the target appear in the participants list THIS worker read back? The
  // projection de-dups, so this MUST be exactly 1 even though several workers may each have
  // appended a room.participant_added for the same target. Reported so the orchestrator can
  // assert every worker converged on the single-participant view (not just the final read).
  const targetParticipantCount = result.participants.filter(
    (h) => h === args.target,
  ).length;

  da.close();

  sendToParent({
    type: 'done',
    workerId: args.workerId,
    adder: args.adder,
    added: true,
    targetParticipantCount,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `add-participant-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
