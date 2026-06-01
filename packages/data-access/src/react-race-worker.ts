// Cross-process react/unreact race WORKER (Story 5.2 QA — the GENUINE concurrency proof).
//
// The per-process worker the react-race orchestrator forks as a SEPARATE OS PROCESS (not a
// worker_thread — threads share one process + one better-sqlite3 address space and would NOT
// faithfully exercise cross-process WAL locking, the very mechanism under test). Every worker
// opens the SAME shared SQLite ledger via the REAL `createDataAccess` and reacts/unreacts the
// SAME message through the REAL `core.react` / `core.unreact` path (read stream → findMessage →
// participation gate → idempotent-no-op check → PLAIN `append` of message.reacted /
// message.unreacted → read-back). NOTHING is stubbed.
//
// THE CLAIM UNDER TEST (a guarantee the dev's SEQUENTIAL tests cannot reach). `react`/`unreact`
// are PLAIN appends (NO `appendGuarded`, NO uniqueness guard); LIVE 👍 state is DERIVED by
// latest-react-wins per actor (reactions.ts). The dev's react.test.ts (in-memory fake) +
// react.integration.test.ts (real MCP) drive react/unreact ONLY sequentially — each op is
// `await`ed after the prior has fully committed, so the latest-wins projection is exercised
// against an already-settled stream, never against a genuine concurrent conflict. Two
// reaction-specific guarantees no existing test proves under real cross-process contention:
//   - mode 'distinct': N DISTINCT participants each react the SAME message SIMULTANEOUSLY. Every
//     message.reacted must LAND (zero lost reactions) with its own monotonic `seq` (one total
//     order via the single writer), zero errors, and the live-reactor set must CONVERGE to
//     EXACTLY all N — the live projection is a faithful aggregate of concurrent appends.
//   - mode 'flap': ONE actor fires N alternating react/unreact ops on the SAME message
//     SIMULTANEOUSLY (each worker emits react if its id is even, unreact if odd, via the raw
//     append — bypassing the op-level idempotent no-op so every flap actually lands a row). The
//     final LIVE state must be the deterministic latest-wins-by-`seq` outcome: live IFF the
//     HIGHEST-`seq` op among them is a react. SQLite's single-writer serialization makes `seq` a
//     correct total order, so "latest-by-seq wins" is unambiguous even though the ops raced.
//
// Why a raw append (not core.react/unreact) in 'flap' mode: the ops short-circuit a same-state
// repeat to a no-op (re-react when already live appends nothing), which would make the number of
// landed rows depend on scheduling. The flap race tests the PROJECTION's latest-by-seq
// resolution over genuinely-concurrent reacted/unreacted rows, so each worker appends its
// assigned event directly via the SAME dataAccess.append the ops use — every flap lands exactly
// one row, and the orchestrator asserts the live state is decided by the max-seq row.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port direction;
// lint-allowed) — so the 'distinct' mode drives the very `react` op the MCP tool delegates to,
// making this the regressable proof at the real ledger layer.
//
// Mechanism (mirrors reply-race-worker): forked via child_process.fork of THIS file's BUILT
// artifact (dist/react-race-worker.js); args on argv, result back over IPC. The board + the
// participant identities + the proto-room + every reactor's seeding reply are seeded BY THE
// PARENT before forking. START BARRIER: open, send {type:'ready'}, BLOCK on {type:'go'}, then all
// N workers react/unreact the SAME message near-simultaneously — maximal write-write contention
// on the one ledger.

import { setTimeout as delay } from 'node:timers/promises';

import { liveReactors, react } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** Which race scenario this worker participates in (see file header). */
export type ReactRaceMode = 'distinct' | 'flap';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — for attribution + (in flap mode) the react/unreact parity. */
  workerId: number;
  /** The `seq` of the message every worker races to react/unreact (the parent seeded it). */
  messageSeq: number;
  /** The handle this worker acts as (a distinct participant, or the shared flapping actor). */
  handle: string;
  /** The scenario (distinct reactors vs. one flapping actor). */
  mode: ReactRaceMode;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface ReactRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** The handle this worker reacted/unreacted as. */
  handle: string;
  /**
   * The op this worker performed: 'react' in distinct mode; 'react' or 'unreact' in flap mode
   * (by id parity). The `seq` of the just-appended row, for the orchestrator's max-seq assertion.
   */
  op: 'react' | 'unreact';
  /** The `seq` of THIS worker's just-appended message.reacted / message.unreacted row. */
  appendedSeq: number;
  /**
   * The live reactors of the message as this worker read them back AFTER its own op (distinct
   * mode only — a convergence cross-check; `undefined` in flap mode, where only the FINAL state
   * read by the orchestrator is meaningful).
   */
  liveAfter: string[] | undefined;
  /** True iff the op completed without an error escaping. */
  ok: true;
}

/** Parse the positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, messageSeqRaw, handle, modeRaw] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  const messageSeq = Number(messageSeqRaw);
  if (!Number.isInteger(messageSeq) || messageSeq <= 0) {
    throw new Error(`worker: bad messageSeq "${messageSeqRaw ?? ''}"`);
  }
  if (handle === undefined || handle.length === 0) {
    throw new Error('worker: missing handle arg');
  }
  if (modeRaw !== 'distinct' && modeRaw !== 'flap') {
    throw new Error(`worker: bad mode "${modeRaw ?? ''}"`);
  }
  return { dbPath, workerId, messageSeq, handle, mode: modeRaw };
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
  message: ReactRaceWorkerResult | { type: 'ready' },
): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently so the worker
  // tolerates being first, though the parent has already migrated + seeded).
  const da = createDataAccess({ dbPath: args.dbPath });

  // In flap mode, even workers react and odd workers unreact (so the same actor's concurrent ops
  // disagree, and the latest-by-seq row decides the final live state).
  const op: 'react' | 'unreact' =
    args.mode === 'distinct' || args.workerId % 2 === 0 ? 'react' : 'unreact';

  // BARRIER: announce readiness, then block until the orchestrator says go, so all N processes
  // react/unreact the SAME message together (maximal contention on the single writer).
  sendToParent({ type: 'ready' });
  await waitForGo();

  let appendedSeq: number;
  let liveAfter: string[] | undefined;
  try {
    if (args.mode === 'distinct') {
      // The real op: read → findMessage → participation gate → idempotent-no-op check → PLAIN
      // append of message.reacted → read-back. Under the race there is NO uniqueness guard to
      // trip — every distinct reactor's append simply lands with its own monotonic seq. Any throw
      // is a genuine failure (no expected loser outcome): we rethrow so the worker exits non-zero
      // and the orchestrator's Promise.all rejects (loud, diagnosable; never silent loss).
      await react(da, args.handle, args.messageSeq);
      const after = await da.eventsSince(0);
      liveAfter = liveReactors(after, args.messageSeq);
      // This worker's own message.reacted seq (the max reacted seq attributed to it; in distinct
      // mode there is exactly one per handle, appended just now).
      const mine = (await da.eventsByType('message.reacted')).filter(
        (e) => e.actor === args.handle,
      );
      appendedSeq = mine.length > 0 ? (mine[mine.length - 1]?.seq ?? -1) : -1;
    } else {
      // Flap mode: append the assigned react/unreact row DIRECTLY (bypassing the op-level
      // idempotent no-op so every flap lands exactly one row — see the file header). This is the
      // SAME plain append `core.react`/`core.unreact` use; we drive the projection's
      // latest-by-seq resolution over genuinely-concurrent rows.
      const type = op === 'react' ? 'message.reacted' : 'message.unreacted';
      const [seq] = await da.append([
        { type, actor: args.handle, payload: { messageSeq: args.messageSeq } },
      ]);
      appendedSeq = seq ?? -1;
      liveAfter = undefined; // only the FINAL state (read by the orchestrator) is meaningful here
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
    op,
    appendedSeq,
    liveAfter,
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
    `react-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
