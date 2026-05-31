// Multi-process concurrency-verification WORKER (Story 1.7, AC1/AC2).
//
// This is the per-writer worker the Story 1.7 orchestrator forks as a SEPARATE OS
// PROCESS (not a worker_thread — threads share the process and would not exercise
// cross-process WAL + busy_timeout faithfully). Each worker opens the SAME shared
// SQLite ledger via the REAL Story 1.6 `createDataAccess` and appends M events
// through the REAL Story 1.5 `append` path, so the genuine Story 1.4 connection
// (WAL + busy_timeout=5000 + bounded retry + StoreBusyError) is what serializes the
// concurrent writers and assigns `seq`. NOTHING in the ledger impl is stubbed.
//
// Mechanism (researched 2026-05-30, Node 24 child_process + better-sqlite3 + WAL):
//   - Launched via `child_process.fork` of THIS file's BUILT artifact
//     (dist/concurrency-worker.js). The package is `"type":"module"`, so the built
//     `.js` is ESM; `fork` runs it with `process.execPath` and an IPC channel for
//     free — no shim needed on Node 24. Args arrive on argv; results go back over
//     the IPC channel as a single structured message before a clean exit(0).
//   - START BARRIER: the worker opens + migrates the DB, then sends `{type:'ready'}`
//     and BLOCKS on a `{type:'go'}` IPC message before its tight append loop. The
//     orchestrator waits for every worker's `ready`, then broadcasts `go`, so all N
//     writers hit `BEGIN IMMEDIATE` near-simultaneously — maximal write-write
//     contention with no stagger. That is what makes SQLITE_BUSY actually occur
//     across processes (it would otherwise be masked by serialized arrivals).
//   - The real `append` swallows retries internally, so the worker cannot see a
//     retry directly; instead it (a) records per-append wall time (a contended
//     append that waited on the busy handler / retried is observably slower) and
//     (b) counts any StoreBusyError that escaped (MUST be 0 — the 1.4 retry +
//     busy_timeout always wins at this N/M; that escaping would be the Rule-5 bug).
//
// Each event carries a UNIQUE attributable marker so loss/duplication is detectable
// by the orchestrator: it is an `identity.seen` event whose actor is `writer-<id>`
// and whose payload handle is `writer-<id>#<index>` (0-based, < M). The full set of
// N×M markers is therefore known up front and asserted exactly.
//
// This file lives in data-access/src so it may use the package's own public API and
// (for the optional lock-holder probe) better-sqlite3 — both lint-allowed here. It
// is built into dist by the package `tsc -b`, alongside the rest of the source.

import { setTimeout as delay } from 'node:timers/promises';

import Database from 'better-sqlite3';

import { createDataAccess } from './data-access.js';
import { StoreBusyError } from './errors.js';

import type { NewEvent } from '@agentbbs/core';

/** A structured arg bundle parsed from argv (positional). */
interface WorkerArgs {
  /** Absolute path to the shared SQLite ledger file. */
  dbPath: string;
  /** This writer's id (0-based); the contention marker namespace. */
  writerId: number;
  /** Number of events this writer appends (M). */
  eventCount: number;
  /**
   * If > 0, this designated writer (typically writer 0) holds an explicit write
   * lock for this many ms AFTER the `go` barrier and BEFORE its own appends,
   * deterministically forcing the other writers' first appends to contend with a
   * held write lock. Used by the AC2 variant to guarantee SQLITE_BUSY is reachable
   * even though busy_timeout=5000 would otherwise mask brief contention.
   */
  holdLockMs: number;
}

/** The single result message a worker sends back over IPC before exiting 0. */
export interface WorkerResult {
  type: 'done';
  writerId: number;
  /** How many events this worker actually appended (must equal eventCount). */
  appended: number;
  /** The `seq` values this worker received, in append order. */
  seqs: number[];
  /** The attributable markers this worker wrote (handle strings), in order. */
  markers: string[];
  /** Slowest single append in ms (contention evidence — a blocked/retried append). */
  maxAppendMs: number;
  /**
   * Count of StoreBusyError that ESCAPED the real append path. MUST be 0: the 1.4
   * busy_timeout + bounded retry is expected to resolve every contended write at
   * this N/M. A non-zero value is a genuine correctness signal (Rule 5), not noise.
   */
  busyErrors: number;
}

/** Parse the four positional argv values; throw loudly on anything malformed. */
function parseArgs(argv: string[]): WorkerArgs {
  const [dbPath, writerIdRaw, eventCountRaw, holdLockMsRaw] = argv.slice(2);
  if (dbPath === undefined) throw new Error('worker: missing dbPath arg');
  const writerId = Number(writerIdRaw);
  const eventCount = Number(eventCountRaw);
  const holdLockMs = Number(holdLockMsRaw ?? '0');
  if (!Number.isInteger(writerId) || writerId < 0) {
    throw new Error(`worker: bad writerId "${writerIdRaw ?? ''}"`);
  }
  if (!Number.isInteger(eventCount) || eventCount <= 0) {
    throw new Error(`worker: bad eventCount "${eventCountRaw ?? ''}"`);
  }
  if (!Number.isInteger(holdLockMs) || holdLockMs < 0) {
    throw new Error(`worker: bad holdLockMs "${holdLockMsRaw ?? ''}"`);
  }
  return { dbPath, writerId, eventCount, holdLockMs };
}

/** Build the attributable marker handle for writer `id`'s `index`-th event. */
function markerFor(writerId: number, index: number): string {
  return `writer-${writerId}#${index}`;
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
function sendToParent(message: WorkerResult | { type: 'ready' }): void {
  if (typeof process.send !== 'function') {
    throw new Error('worker: no IPC channel (must be launched via fork)');
  }
  process.send(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Open the SHARED ledger via the real composed DataAccess. createDataAccess
  // migrates (forward-only, idempotent) so every worker tolerates being first.
  const da = createDataAccess({ dbPath: args.dbPath });

  // Pre-build this writer's M single-event appends with unique markers.
  const markers: string[] = [];
  const events: NewEvent[] = [];
  for (let i = 0; i < args.eventCount; i++) {
    const handle = markerFor(args.writerId, i);
    markers.push(handle);
    events.push({
      type: 'identity.seen',
      actor: `writer-${args.writerId}`,
      payload: { handle },
    });
  }

  // BARRIER: announce readiness, then block until the orchestrator says go. This is
  // what synchronizes all N processes onto the write lock simultaneously.
  sendToParent({ type: 'ready' });
  await waitForGo();

  // Optional deterministic lock-hold (AC2): the designated writer holds a real
  // BEGIN IMMEDIATE write lock briefly so the OTHER writers' first appends provably
  // contend with a held write lock (the busy handler must then wait/retry). This is
  // a lock-timing device on a dedicated connection — it never mutates the events
  // ledger, so the append invariant is untouched.
  if (args.holdLockMs > 0) {
    await holdWriteLock(args.dbPath, args.holdLockMs);
  }

  const seqs: number[] = [];
  let maxAppendMs = 0;

  for (const event of events) {
    const start = performance.now();
    try {
      const [seq] = await da.append([event]);
      seqs.push(seq);
    } catch (err) {
      // A StoreBusyError here means the 1.4 busy_timeout + bounded retry did NOT
      // resolve this contended write — which, at the chosen N/M, must never happen.
      // We do NOT swallow it: rethrowing makes the worker exit non-zero, so the
      // orchestrator's Promise.all rejects and the test fails loudly (the Rule-5
      // correctness signal). The reported `busyErrors` is therefore always 0 by
      // construction — a non-zero count can only manifest as a dead worker, never as
      // a quietly-reported number — and the test asserts that 0 as the invariant.
      throw err instanceof StoreBusyError
        ? new Error(
            `writer ${args.writerId}: StoreBusyError escaped the retry path under ` +
              `contention (busy_timeout+retry failed to resolve a contended write): ` +
              `${err.message}`,
          )
        : err;
    }
    const elapsed = performance.now() - start;
    if (elapsed > maxAppendMs) maxAppendMs = elapsed;
  }

  da.close();

  sendToParent({
    type: 'done',
    writerId: args.writerId,
    appended: seqs.length,
    seqs,
    markers,
    maxAppendMs,
    // Always 0 here by construction: an unresolved contended write rethrows above
    // (worker dies, test fails) rather than being counted-and-reported. The field
    // documents the invariant the orchestrator asserts (busy_timeout+retry won).
    busyErrors: 0,
  });

  // Let the IPC message flush before exiting cleanly.
  await delay(0);
  process.exit(0);
}

/**
 * Hold a real SQLite write lock for `ms` milliseconds on a dedicated connection,
 * then release it. Uses the connection's `BEGIN IMMEDIATE` (which takes the write
 * lock at BEGIN) on a throwaway table-free transaction so it touches NOT the events
 * ledger — purely a contention-timing device for the AC2 variant.
 */
async function holdWriteLock(dbPath: string, ms: number): Promise<void> {
  // Open a second connection (WAL + busy_timeout) and grab the write lock by
  // issuing BEGIN IMMEDIATE directly, sleeping, then COMMIT. data-access is the only
  // package allowed to import the driver, so we issue raw SQL the public append seam
  // intentionally does not expose.
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  try {
    db.exec('BEGIN IMMEDIATE'); // takes the single-writer lock now
    await delay(ms);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

void main().catch((err: unknown) => {
  // Surface the failure to the parent via a non-zero exit + stderr; the orchestrator
  // treats any non-zero worker exit as a hard test failure (no silent loss).
  process.stderr.write(
    `worker fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
