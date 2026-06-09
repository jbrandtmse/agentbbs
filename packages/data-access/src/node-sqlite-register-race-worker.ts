// Cross-process registration-race WORKER for the node:sqlite adapter (Story 10.2, AC3 /
// Rule 5). The node:sqlite analogue of register-race-worker.ts: each forked OS PROCESS opens
// the SAME shared SQLite ledger via the REAL `createDataAccessNodeSqlite` and attempts to
// `register` the SAME handle through the REAL `core.register` → `appendGuarded` path (the
// node:sqlite BEGIN IMMEDIATE transaction). NOTHING is stubbed — the genuine atomic guard is
// what must let EXACTLY ONE worker win and force the rest to HANDLE_TAKEN.
//
// Why real processes (not worker_threads): threads share one process + one node:sqlite
// connection address space, so they would NOT exercise cross-process WAL locking — the very
// mechanism that makes BEGIN IMMEDIATE atomic across processes. Forked as a BUILT artifact
// (dist/node-sqlite-register-race-worker.js) via child_process.fork; result back over IPC.
// START BARRIER: open + migrate, send {ready}, BLOCK on {go}, then all N register together.

import { setTimeout as delay } from 'node:timers/promises';

import { BoardError, register } from '@agentbbs/core';

import { createDataAccessNodeSqlite } from './node-sqlite/data-access-node-sqlite.js';

/** The single result message a worker sends back over IPC before exiting 0. */
export interface NodeSqliteRaceWorkerResult {
  type: 'done';
  workerId: number;
  /** True iff THIS worker's register succeeded (returned the identity). */
  won: boolean;
  /** True iff THIS worker observed HANDLE_TAKEN (lost the race cleanly). */
  handleTaken: boolean;
  /** The created_at the winner read back (only meaningful when `won`). */
  createdAt: string | null;
}

interface WorkerArgs {
  dbPath: string;
  workerId: number;
  handle: string;
}

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

function sendToParent(
  message: NodeSqliteRaceWorkerResult | { type: 'ready' },
): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const da = createDataAccessNodeSqlite({ dbPath: args.dbPath });

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
    if (err instanceof BoardError && err.code === 'HANDLE_TAKEN') {
      handleTaken = true;
    } else {
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

  await delay(0);
  process.exit(0);
}

void main().catch((err: unknown) => {
  process.stderr.write(
    `node-sqlite-register-race worker fatal: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }\n`,
  );
  process.exit(1);
});
