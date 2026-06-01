// Cross-process protocol-SEED race WORKER (Story 7.2 QA, AC #2 — the GENUINE
// multi-process idempotency proof). The per-process worker the seed-protocol-race
// orchestrator forks as a SEPARATE OS PROCESS (not a worker_thread — threads share
// one process + one better-sqlite3 address space and would NOT faithfully exercise
// cross-process WAL locking, the very thing that makes the seed's `room_id`
// uniqueness guard atomic across processes). Every worker opens the SAME shared
// SQLite ledger via the REAL `createDataAccess` and runs the REAL
// `core.seedProtocolAnnouncement` — the actual one-time bootstrap append `main.ts`
// runs. NOTHING is stubbed.
//
// Why this is DISTINCT from post-announcement-race / register-race:
//   - register-race proves `appendGuarded`'s REJECT-on-conflict for a SINGLE event
//     (one winner registers the handle, the rest get HANDLE_TAKEN);
//   - post-announcement-race proves the disambiguator RETRY loop for a single
//     announcement.posted (all N succeed with distinct ids);
//   - THIS proves the SEED's specific new claim: a 4-event guarded append
//     (identity.registered + project.announced + board.joined + announcement.posted,
//     guarded on the announcement's `room_id`) run by N concurrent BOOTSTRAPPING
//     server processes converges to EXACTLY ONE protocol announcement + ONE reserved
//     `main` project + ONE `agentbbs` identity, with the losers SWALLOWING the
//     uniqueness conflict (idempotent — no error escapes). No single-event race test
//     covers that composite-append-then-swallow path.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port
// direction; lint-allowed) — so the worker drives the very `seedProtocolAnnouncement`
// op `main.ts` calls at bootstrap, making this the regressable proof of AC #2's
// "server restart / re-initialization → no duplicate" under the architecture's
// MULTI-PROCESS SQLite model (two server processes bootstrapping at once).
//
// Mechanism (mirrors Story 2.2's register-race-worker): forked via child_process.fork
// of THIS file's BUILT artifact (dist/seed-protocol-race-worker.js); args on argv,
// result back over IPC. START BARRIER: open + migrate, send {type:'ready'}, BLOCK on
// {type:'go'}, then all N workers seed near-simultaneously — maximal write-write
// contention on the one reserved room_id. Each worker reports that its seed RESOLVED
// (the seed must NEVER throw under the race — the loser swallows the guard conflict);
// any throw exits the worker non-zero and fails the orchestrator's Promise.all.

import { setTimeout as delay } from 'node:timers/promises';

import { seedProtocolAnnouncement } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — only for attribution in diagnostics. */
  workerId: number;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface SeedRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** True iff THIS worker's `seedProtocolAnnouncement` RESOLVED (never threw). */
  seeded: boolean;
}

/** Parse the two positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  return { dbPath, workerId };
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
function sendToParent(message: SeedRaceWorkerResult | { type: 'ready' }): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently
  // so every worker tolerates being first — exactly the bootstrap path main.ts runs).
  const da = createDataAccess({ dbPath: args.dbPath });

  // BARRIER: announce readiness, then block until the orchestrator says go, so all
  // N processes seed together (maximal contention on the one reserved room_id guard).
  sendToParent({ type: 'ready' });
  await waitForGo();

  // The real bootstrap seed. Under the race, the existence check can MISS in several
  // workers at once (all see no protocol yet), so multiple workers attempt the guarded
  // append — but the atomic `room_id` guard lets exactly ONE commit; the rest trip the
  // guard, which the seed SWALLOWS (isUniquenessConflict → idempotent return). So the
  // seed must RESOLVE in EVERY worker — never throw. Any throw is a genuine failure
  // (a NON-uniqueness fault, or the swallow logic regressing): rethrow so the worker
  // exits non-zero and the orchestrator's Promise.all rejects (loud; never silent).
  try {
    await seedProtocolAnnouncement(da);
  } catch (err) {
    da.close();
    throw err;
  }

  da.close();

  sendToParent({ type: 'done', workerId: args.workerId, seeded: true });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `seed-protocol-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
