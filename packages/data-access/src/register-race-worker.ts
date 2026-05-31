// Cross-process registration-race WORKER (Story 2.2, Task 5 / AC #2 — FR1 proof).
//
// The per-process worker the register-race orchestrator forks as a SEPARATE OS
// PROCESS (not a worker_thread — threads share one process + one better-sqlite3
// address space and would NOT faithfully exercise cross-process WAL locking, the
// very thing under test). Every worker opens the SAME shared SQLite ledger via the
// REAL `createDataAccess` and attempts to register the SAME handle through the REAL
// `core.register` → `appendGuarded` path (BEGIN IMMEDIATE inside one transaction).
// NOTHING is stubbed: the genuine atomic uniqueness guard is what must let exactly
// ONE worker win and force the rest to HANDLE_TAKEN.
//
// data-access legitimately imports the @agentbbs/core barrel (adapter → port
// direction; lint-allowed) — so the worker drives the same `register` op the MCP
// tool delegates to, making this the regressable proof of AC #2's "two concurrent
// registrations cannot both succeed" at the real ledger layer.
//
// Mechanism (mirrors Story 1.7's concurrency-worker): forked via child_process.fork
// of THIS file's BUILT artifact (dist/register-race-worker.js); args on argv,
// result back over IPC. START BARRIER: open + migrate, send {type:'ready'}, BLOCK
// on {type:'go'}, then all N workers attempt the SAME register near-simultaneously
// — maximal write-write contention on the one handle. Each worker reports whether
// it WON (got the identity) or saw HANDLE_TAKEN (the BoardError code) so the
// orchestrator can assert exactly one winner.

import { setTimeout as delay } from 'node:timers/promises';

import { BoardError, register } from '@agentbbs/core';

import { createDataAccess } from './data-access.js';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This worker's id (0-based) — only for attribution in diagnostics. */
  workerId: number;
  /** The single contested handle every worker races to register. */
  handle: string;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface RaceWorkerResult {
  type: 'done';
  workerId: number;
  /** True iff THIS worker's register succeeded (returned the identity). */
  won: boolean;
  /** True iff THIS worker observed HANDLE_TAKEN (lost the race cleanly). */
  handleTaken: boolean;
  /** The created_at the winner read back (only meaningful when `won`). */
  createdAt: string | null;
}

/** Parse the three positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, workerIdRaw, handle] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const workerId = Number(workerIdRaw);
  if (!Number.isInteger(workerId) || workerId < 0) {
    throw new Error(`worker: bad workerId "${workerIdRaw ?? ''}"`);
  }
  if (handle === undefined || handle.length === 0) {
    throw new Error('worker: missing handle arg');
  }
  return { dbPath, workerId, handle };
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
function sendToParent(message: RaceWorkerResult | { type: 'ready' }): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess (migrates idempotently
  // so every worker tolerates being first).
  const da = createDataAccess({ dbPath: args.dbPath });

  // BARRIER: announce readiness, then block until the orchestrator says go, so all
  // N processes attempt the SAME register together (maximal contention on one handle).
  sendToParent({ type: 'ready' });
  await waitForGo();

  let won = false;
  let handleTaken = false;
  let createdAt: string | null = null;

  try {
    const identity = await register(da, {
      handle: args.handle,
      currentFocus: `focus from worker ${args.workerId}`,
    });
    won = true;
    createdAt = identity.createdAt;
  } catch (err) {
    // The expected loser outcome: the atomic guard rejected this writer's append
    // because another worker's registration committed first → HANDLE_TAKEN.
    if (err instanceof BoardError && err.code === 'HANDLE_TAKEN') {
      handleTaken = true;
    } else {
      // Any OTHER error (e.g. a StoreBusyError escaping the retry, or an unexpected
      // fault) is a genuine failure — rethrow so the worker exits non-zero and the
      // orchestrator's Promise.all rejects (loud, diagnosable; never silent loss).
      da.close();
      throw err;
    }
  }

  da.close();

  sendToParent({
    type: 'done',
    workerId: args.workerId,
    won,
    handleTaken,
    createdAt,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `register-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
