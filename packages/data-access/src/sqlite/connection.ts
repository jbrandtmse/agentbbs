// SQLite connection: WAL + busy_timeout + bounded retry (Story 1.4, AC1/AC2).
//
// This is the ONLY module that imports better-sqlite3 (NFR2 swap seam, lint-
// enforced). It opens the resolved ledger path, puts the connection in WAL mode
// with a bounded `busy_timeout`, confirms the pragmas took effect, and provides a
// bounded-retry wrapper that converts sustained `SQLITE_BUSY` contention into a
// typed `StoreBusyError`.
//
// Scope (Story 1.4): connection plumbing only — NO events schema, migration,
// append, read queries, or domain logic (those are Stories 1.5–1.7).
//
// Concurrency model (NFR3/AR4): better-sqlite3's `busy_timeout` makes a single
// synchronous call block-and-retry internally for up to BUSY_TIMEOUT_MS before it
// throws `SQLITE_BUSY`. The retry wrapper below adds a small BOUNDED number of
// additional whole-call attempts on top of that, for the residual cases SQLite
// surfaces as SQLITE_BUSY even after waiting (e.g. write-write WAL contention /
// SQLITE_BUSY_SNAPSHOT). Worst-case wall time is ~BUSY_TIMEOUT_MS × MAX_ATTEMPTS;
// exhausting it throws StoreBusyError — the documented graduation signal (NFR2).

import Database from 'better-sqlite3';

import { ensureDbDirectory, resolveDbPath } from '../path.js';
import { StoreBusyError } from '../errors.js';

import type { Database as DatabaseInstance } from 'better-sqlite3';

/** Bounded SQLite busy wait per call, in milliseconds (~5s, AR4/NFR3). */
export const BUSY_TIMEOUT_MS = 5000;

/**
 * Max number of whole-call attempts the retry wrapper makes before surfacing
 * `StoreBusyError`. This is ON TOP OF SQLite's own internal `busy_timeout`
 * waiting per attempt — a bounded backstop, not the primary wait mechanism.
 */
export const MAX_WRITE_ATTEMPTS = 3;

/** SQLite error codes that mean "locked, retry may succeed". */
const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT']);

/** Options for {@link openDatabase}. */
export interface OpenDatabaseOptions {
  /**
   * Explicit DB path; bypasses discovery when provided. When omitted, the path
   * is resolved via {@link resolveDbPath} (AGENTBBS_DB override / walk-up).
   */
  dbPath?: string;
  /** Open read-only (skips WAL/dir creation). Default false. */
  readonly?: boolean;
}

/** True when `err` is a better-sqlite3 busy/locked error. */
function isBusyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    BUSY_CODES.has((err as { code: string }).code)
  );
}

/**
 * Open the SQLite ledger with WAL + busy_timeout and confirm the pragmas took
 * effect. Creates `.agentbbs/` on first run (unless read-only or `:memory:`).
 *
 * @throws Error if WAL could not be enabled (e.g. unexpectedly returns a
 *   non-`wal` journal mode), so a misconfigured connection fails loudly rather
 *   than silently running without the concurrency guarantees.
 */
export function openDatabase(
  options: OpenDatabaseOptions = {},
): DatabaseInstance {
  const dbPath = options.dbPath ?? resolveDbPath();

  if (!options.readonly) {
    ensureDbDirectory(dbPath);
  }

  const db = new Database(dbPath, { readonly: options.readonly ?? false });

  // busy_timeout is per-connection (not persisted) — set it every open.
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

  if (!options.readonly) {
    // WAL is persisted in the file, but set + verify on every writable open so a
    // fresh DB lands in WAL and a misconfigured one fails fast. In-memory DBs
    // cannot use WAL; they report `memory`, which is acceptable for tests.
    const mode = db.pragma('journal_mode = WAL', { simple: true });
    if (dbPath !== ':memory:' && mode !== 'wal') {
      db.close();
      throw new Error(
        `Failed to enable WAL mode on ${dbPath}: journal_mode is "${String(mode)}" (expected "wal").`,
      );
    }
  }

  return db;
}

/** Read back the effective `busy_timeout` (ms) for a connection. */
export function getBusyTimeout(db: DatabaseInstance): number {
  return db.pragma('busy_timeout', { simple: true }) as number;
}

/** Read back the effective `journal_mode` for a connection. */
export function getJournalMode(db: DatabaseInstance): string {
  return db.pragma('journal_mode', { simple: true }) as string;
}

/**
 * Run a write `fn` with bounded retry on `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT`.
 *
 * Each attempt relies on SQLite's `busy_timeout` to wait internally; if SQLite
 * still surfaces a busy error, up to {@link MAX_WRITE_ATTEMPTS} whole-call
 * attempts are made. On success the value is returned. If the bound is exhausted
 * the underlying busy error is wrapped in a typed {@link StoreBusyError} — the
 * raw better-sqlite3 error never escapes the seam. Non-busy errors propagate
 * immediately, unwrapped.
 *
 * @param attempts Max whole-call attempts (default {@link MAX_WRITE_ATTEMPTS}).
 */
export function runWithRetry<T>(
  fn: () => T,
  attempts: number = MAX_WRITE_ATTEMPTS,
): T {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isBusyError(err)) throw err;
      lastError = err;
    }
  }
  throw new StoreBusyError(
    `SQLite write contention persisted after ${attempts} attempt(s) ` +
      `(busy_timeout=${BUSY_TIMEOUT_MS}ms). Sustained contention is the documented ` +
      `signal to graduate to the V2 HTTP backend.`,
    attempts,
    lastError,
  );
}
