// Cross-process `check` race WORKER (Story 6.1 QA, AC #3 — the GENUINE concurrency proof).
//
// The per-process worker the check-race orchestrator forks as a SEPARATE OS PROCESS (not a
// worker_thread — threads share one process + one better-sqlite3 address space and would NOT
// faithfully exercise cross-process WAL locking, the very mechanism under test). Every worker
// opens the SAME shared SQLite ledger via the REAL `createDataAccess` and drives the REAL code
// path for its role. NOTHING is stubbed.
//
// THE CLAIM UNDER TEST (a guarantee the dev's SEQUENTIAL AC #3 test cannot reach). The dev's
// check.test.ts SIMULATES the concurrent case: it `await`s a full `check` (fold → setCursor →
// recordSeen all committed), THEN sequentially `await`s an `append`, THEN a second `check` — so
// the "higher-seq event lands concurrently with my check" path is exercised against an
// already-settled stream, never against a genuine write-write race. AC #3 explicitly claims
// CONCURRENCY ("a message lands CONCURRENTLY with my check"), and `check` ADVANCES A STORED
// CURSOR (getCursor → setCursor UPSERT) + appends a recordSeen presence ping — all on the hot
// path. Three guarantees no existing test proves under real cross-process contention:
//   1. NO MESSAGE SKIPPED: an in-scope `room.replied` that lands during the checker's fold is
//      never swallowed. Because `check` advances the cursor only to `maxReturned` (NOT the global
//      `maxSeq`), a reply whose `seq` exceeds what a given check returned still satisfies
//      `seq > cursor` on a SUBSEQUENT check and surfaces then. Over the whole race, the UNION of
//      every message the checker returned across all its checks is EXACTLY the set of replies the
//      appenders landed — none lost, none duplicated.
//   2. CURSOR MONOTONIC: the stored per-identity cursor the checker reads/writes never moves
//      BACKWARD across its successive checks, even while N appenders race `room.replied`s in.
//   3. UPSERT CONSISTENT: the `cursors` table UPSERT (setCursor) the checker performs every
//      iteration stays a single coherent row under the concurrent writes — the checker completes
//      its whole loop with no error and a final stored cursor equal to the max in-scope seq.
//
// Two roles, selected by the `mode` arg (so ONE worker file serves both):
//   - mode 'checker': ONE worker loops `iterations` times calling the REAL `core.check`, recording
//     the full sequence of (cursor, returned-message-seqs) it observed. It is a SEATED PARTICIPANT
//     of the shared room (the parent seeded its joining reply), so every appender reply is in its
//     `check` scope. Its cursor read/advance + recordSeen ping race against the appenders' writes.
//   - mode 'appender': each worker replies ONCE to the SAME shared room via the REAL `core.reply`
//     (a PLAIN append of `room.replied` with its own monotonic seq). All N land concurrently with
//     the checker's loop — maximal write-write contention with the checker's setCursor/recordSeen.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port direction;
// lint-allowed) — so both roles drive the very ops the MCP tools delegate to (`check`, `reply`),
// making this the regressable proof of AC #3 at the real ledger layer.
//
// Mechanism (mirrors reply-race-worker / react-race-worker): forked via child_process.fork of
// THIS file's BUILT artifact (dist/check-race-worker.js); args on argv, result back over IPC. The
// board + the checker's + appenders' identities + the proto-room + the checker's seeding reply are
// seeded BY THE PARENT before forking. START BARRIER: open, send {type:'ready'}, BLOCK on
// {type:'go'}, then the checker loops while all N appenders reply near-simultaneously.

import { setTimeout as delay } from 'node:timers/promises';

import { check, reply } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** Which race role this worker plays (see file header). */
export type CheckRaceMode = 'checker' | 'appender';

// Timing knobs that make the overlap a MEANINGFUL probe of the concurrent-higher-seq path (NOT a
// correctness lever — the no-skip / monotonic-cursor guarantees hold at any timing; these just
// ensure the checker actually observes GROWING PARTIAL deltas rather than all-N-at-once on lucky
// scheduling). Appenders dribble their replies in across the checker's loop window; the checker
// yields briefly between checks so its loop spans that window and sees a reply that landed AFTER an
// earlier check surface on a LATER one — the literal AC #3 scenario.
/** Per-appender post-`go` stagger: appender `id` waits `id * this` ms before replying. */
const APPENDER_STAGGER_MS = 8;
/** The checker yields this many ms between successive in-race checks (so deltas grow gradually). */
const CHECKER_INTER_CHECK_MS = 3;

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — for attribution + the appender's reply body. */
  workerId: number;
  /** The room the checker participates in / the appenders reply to (the parent seeded it). */
  roomId: string;
  /** The handle this worker acts as (the checker, or a distinct appender). */
  handle: string;
  /** The role (the single looping checker, or one of N appenders). */
  mode: CheckRaceMode;
  /** Checker only: how many `check` iterations to run during the race (ignored by appenders). */
  iterations: number;
}

/** One observation the checker records per `check` call: the cursor + the in-scope message seqs. */
export interface CheckObservation {
  /** The cursor this check advanced to (`maxReturned`). */
  cursor: number;
  /** The `seq`s of the messages this check RETURNED, in returned order (already seq-sorted). */
  messageSeqs: number[];
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface CheckRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** The handle this worker acted as. */
  handle: string;
  /** The role this worker played. */
  mode: CheckRaceMode;
  /**
   * Checker only: the ordered observations across its loop PLUS the drain checks (see below) —
   * every (cursor, messageSeqs) it saw. Empty for an appender.
   */
  observations: CheckObservation[];
  /**
   * Appender only: the `seq` of THIS worker's just-appended `room.replied` (the durable order
   * key the orchestrator reconciles against the checker's union). `-1` for the checker.
   */
  replySeq: number;
  /** True iff this worker's whole role completed without an error escaping. */
  ok: true;
}

/** Parse the positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, roomId, handle, modeRaw, iterationsRaw] =
    argv.slice(2);
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
  if (modeRaw !== 'checker' && modeRaw !== 'appender') {
    throw new Error(`worker: bad mode "${modeRaw ?? ''}"`);
  }
  const iterations = Number(iterationsRaw ?? '0');
  if (!Number.isInteger(iterations) || iterations < 0) {
    throw new Error(`worker: bad iterations "${iterationsRaw ?? ''}"`);
  }
  return { dbPath, workerId, roomId, handle, mode: modeRaw, iterations };
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
  message: CheckRaceWorkerResult | { type: 'ready' },
): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

/**
 * The CHECKER role: loop `core.check` `iterations` times during the race, then keep checking
 * until the delta DRAINS (two consecutive empty deltas) so every reply that landed — including
 * any that arrived after the last in-race check — is observed exactly once. Records every
 * (cursor, messageSeqs). The cursor read/advance (getCursor → setCursor UPSERT) and the recordSeen
 * presence ping race against the appenders' writes the whole time.
 */
async function runChecker(
  da: ReturnType<typeof createDataAccess>,
  args: WorkerArgs,
): Promise<CheckObservation[]> {
  const observations: CheckObservation[] = [];

  const checkOnce = async (): Promise<CheckObservation> => {
    const result = await check(da, args.handle);
    const obs: CheckObservation = {
      cursor: result.cursor,
      // Only the messages in THIS worker's participated room matter for the reconciliation; but
      // record every returned message seq (the checker participates in exactly the one room here).
      messageSeqs: result.messages.map((m) => m.seq),
    };
    observations.push(obs);
    return obs;
  };

  // In-race loop: check repeatedly while the appenders are landing replies. A tiny yield between
  // checks spreads the loop across the appenders' stagger window, so the checker observes the
  // delta GROW (returns up to seq K, a higher-seq reply lands, it surfaces on the NEXT check) —
  // the literal AC #3 concurrent-higher-seq path, not all-N-at-once.
  for (let i = 0; i < args.iterations; i += 1) {
    await checkOnce();
    await delay(CHECKER_INTER_CHECK_MS);
  }

  // DRAIN: after the in-race loop, keep checking until two consecutive empty deltas, so a reply
  // that committed after the final in-race check is still surfaced (AC #3: it has seq > cursor on
  // a later check). Bounded so a bug cannot hang the suite (far more than the appender count).
  let consecutiveEmpty = 0;
  const maxDrain = 1000;
  for (let i = 0; i < maxDrain && consecutiveEmpty < 2; i += 1) {
    const obs = await checkOnce();
    consecutiveEmpty = obs.messageSeqs.length === 0 ? consecutiveEmpty + 1 : 0;
  }

  return observations;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently so the worker
  // tolerates being first, though the parent has already migrated + seeded).
  const da = createDataAccess({ dbPath: args.dbPath });

  // BARRIER: announce readiness, then block until the orchestrator says go, so the checker's loop
  // and all N appenders' replies overlap maximally (contention on the single writer + the cursor).
  sendToParent({ type: 'ready' });
  await waitForGo();

  let observations: CheckObservation[] = [];
  let replySeq = -1;
  try {
    if (args.mode === 'checker') {
      observations = await runChecker(da, args);
    } else {
      // Stagger the appenders so their replies dribble in across the checker's loop window (appender
      // `id` waits `id * APPENDER_STAGGER_MS`), maximizing the odds the checker observes a PARTIAL
      // delta then a later-landing higher-seq reply on a subsequent check. Timing only — every reply
      // still lands; ordering/no-skip is what the orchestrator asserts.
      await delay(args.workerId * APPENDER_STAGGER_MS);
      // The real op: room lookup → membership check → PLAIN append of room.replied. Under the race
      // there is NO uniqueness guard to trip — every appender's reply simply lands with its own
      // monotonic seq. Any throw is a genuine failure: we rethrow so the worker exits non-zero and
      // the orchestrator's Promise.all rejects (loud, diagnosable; never silent loss).
      await reply(da, args.handle, {
        roomId: args.roomId,
        body: `reply from appender ${args.workerId}`,
      });
      // Read THIS appender's own room.replied seq back (the max room.replied seq attributed to it;
      // it acts as a distinct handle, so exactly one, appended just now).
      const replies = await da.eventsByType('room.replied');
      const mine = replies.filter((e) => e.actor === args.handle);
      replySeq = mine.length > 0 ? (mine[mine.length - 1]?.seq ?? -1) : -1;
    }
  } catch (err) {
    da.close();
    throw err;
  }

  da.close();

  sendToParent({
    type: 'done',
    workerId: args.workerId,
    handle: args.handle,
    mode: args.mode,
    observations,
    replySeq,
    ok: true,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator treats any
  // non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `check-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
