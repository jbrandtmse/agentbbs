// Cross-process post-announcement race WORKER (Story 4.1 QA, AC #4 — the GENUINE
// concurrency proof). The per-process worker the post-announcement-race orchestrator
// forks as a SEPARATE OS PROCESS (not a worker_thread — threads share one process +
// one better-sqlite3 address space and would NOT faithfully exercise cross-process WAL
// locking, the very thing under test). Every worker opens the SAME shared SQLite ledger
// via the REAL `createDataAccess` and posts an announcement with the SAME subject through
// the REAL `core.postAnnouncement` path (membership gate → `appendGuarded` with a
// `room_id` uniqueness guard → disambiguator retry). NOTHING is stubbed.
//
// Why this is DISTINCT from register-race-worker: register's guard REJECTS on conflict
// (one winner, the rest HANDLE_TAKEN). post-announcement's op RETRIES with a bumped
// disambiguator on conflict — so under a genuine N-way same-subject race, EVERY worker
// must SUCCEED with its OWN distinct `roomId` (`base`, `base-2`, …, `base-N`), zero lost
// writes, zero errors. This worker proves that retry-under-real-contention loop converges,
// which the sequential unit/integration tests (awaited, never racing) cannot.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port direction;
// lint-allowed) — so the worker drives the very `postAnnouncement` op the MCP tool
// delegates to, making this the regressable proof of AC #4's "concurrent same-subject
// posts converge to sequential unique ids" at the real ledger layer.
//
// Mechanism (mirrors Story 2.2's register-race-worker): forked via child_process.fork of
// THIS file's BUILT artifact (dist/post-announcement-race-worker.js); args on argv, result
// back over IPC. The board + every member identity are seeded BY THE PARENT before forking
// (so each worker is already a member and the race is isolated to the room-id allocation).
// START BARRIER: open, send {type:'ready'}, BLOCK on {type:'go'}, then all N workers post
// the SAME subject near-simultaneously — maximal write-write contention on the room_id guard.

import { setTimeout as delay } from 'node:timers/promises';

import { postAnnouncement } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — also indexes its pre-seeded member handle. */
  workerId: number;
  /** The sub-board this worker posts into (the parent seeded it + every member). */
  projectId: string;
  /** The member handle this worker acts as (parent seeded its membership). */
  handle: string;
  /** The SAME subject every worker posts (so all room ids collide on one base). */
  subject: string;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface PostRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** The `roomId` this worker's post was allocated (must be globally unique). */
  roomId: string;
  /** The `seq` of this worker's announcement.posted event (the durable order key). */
  seq: number;
  /** True iff postAnnouncement resolved with a room (no error escaped the retry). */
  posted: boolean;
}

/** Parse the positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, projectId, handle, subject] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  if (projectId === undefined || projectId.length === 0) {
    throw new Error('worker: missing projectId arg');
  }
  if (handle === undefined || handle.length === 0) {
    throw new Error('worker: missing handle arg');
  }
  if (subject === undefined || subject.length === 0) {
    throw new Error('worker: missing subject arg');
  }
  return { dbPath, workerId, projectId, handle, subject };
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
function sendToParent(message: PostRaceWorkerResult | { type: 'ready' }): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently
  // so the worker tolerates being first, though the parent has already migrated+seeded).
  const da = createDataAccess({ dbPath: args.dbPath });

  // BARRIER: announce readiness, then block until the orchestrator says go, so all N
  // processes post the SAME subject together (maximal contention on the room_id guard).
  sendToParent({ type: 'ready' });
  await waitForGo();

  // The real op: membership gate (this worker is a seeded member) → allocate a globally
  // unique roomId via appendGuarded + disambiguator retry → read back the proto-room.
  // Under the race, conflicts here are EXPECTED and the op MUST resolve them by retrying
  // with a bumped disambiguator — no error should escape (contrast register-race, where
  // the loser legitimately catches HANDLE_TAKEN). Any throw is a genuine failure: we do
  // NOT swallow it — rethrow so the worker exits non-zero and the orchestrator's
  // Promise.all rejects (loud, diagnosable; never silent loss).
  let room;
  try {
    room = await postAnnouncement(da, args.handle, {
      projectId: args.projectId,
      subject: args.subject,
      body: `body from worker ${args.workerId}`,
    });
  } catch (err) {
    da.close();
    throw err;
  }

  da.close();

  sendToParent({
    type: 'done',
    workerId: args.workerId,
    roomId: room.roomId,
    seq: room.seq,
    posted: true,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `post-announcement-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
