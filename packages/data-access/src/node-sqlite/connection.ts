// node:sqlite connection — the VS Code extension-host SQLite driver (Story 10.2, AC3).
//
// THE SECOND NFR2-seam driver. The MCP server / agent backend keeps better-sqlite3
// (`../sqlite/`) BYTE-IDENTICAL; this parallel module set backs the VS Code extension
// host, where a native better-sqlite3 addon cannot be rebuilt for the Electron ABI on
// this machine (no MSVC) — node:sqlite ships embedded in Electron's Node and needs no
// native toolchain. Both drivers implement the SAME `@agentbbs/core` `DataAccess` port
// over the SAME schema, with the SAME WAL + busy_timeout + atomic-`appendGuarded`
// semantics; the only difference is the driver under the seam.
//
// node:sqlite API (verified Rule 3 against the INSTALLED @types/node sqlite.d.ts AND the
// REAL VS Code 1.122.1 Electron host probe — host: electron 39.8.8 / node 22.22.1 / ABI
// 140 / sqlite 3.51.2; node:sqlite DatabaseSync resolved + opened :memory: there):
//   - `new DatabaseSync(path)`            — synchronous connection (since node v22.5.0).
//   - `.exec(sql)`                        — run statements with no result (DDL/PRAGMA/txn).
//   - `.prepare(sql)` → StatementSync     — `.get(...p)`/`.all(...p)`/`.run(...p)`.
//   - `.run(...)` → { changes, lastInsertRowid } (number with the default readBigInts:false,
//     matching better-sqlite3 safe-integers-OFF — INTEGER→number, TEXT→string, NULL→null).
//   - `.close()`.
//
// DELTA from better-sqlite3 (recorded in the Dev Agent Record):
//   - NO `db.transaction(fn)` wrapper and NO `db.pragma()` helper. Transactions are
//     `exec('BEGIN IMMEDIATE')` … `exec('COMMIT')` / `exec('ROLLBACK')`; PRAGMAs are
//     `exec('PRAGMA …')` (set) + `prepare('PRAGMA …').get()` (read-back). Everything else
//     (prepared-statement reuse, parameter binding with `?`, json_extract, the
//     INTEGER PRIMARY KEY AUTOINCREMENT seq) is identical.
//   - busy_timeout is set via `PRAGMA busy_timeout` (portable to the host's node 22, vs the
//     constructor `{ timeout }` option which only exists since node v24) — the SAME
//     mechanism + value (BUSY_TIMEOUT_MS) the better-sqlite3 connection uses.

import { DatabaseSync } from 'node:sqlite';

import { ensureDbDirectory, resolveDbPath } from '../path.js';
import { StoreBusyError } from '../errors.js';

// IMPORT-GRAPH ISOLATION (load-bearing): this module must NOT import from `../sqlite/*` (the
// better-sqlite3 path), because the extension-host bundle externalizes — and CANNOT load —
// the native better-sqlite3 addon. Importing even a constant from `../sqlite/connection.ts`
// drags `import Database from 'better-sqlite3'` into the node:sqlite bundle (a runtime
// `require('better-sqlite3')` that fails in the Electron host). So the tunables + the options
// type are declared LOCALLY here, kept numerically identical to the better-sqlite3 values
// (BUSY_TIMEOUT_MS=5000, MAX_WRITE_ATTEMPTS=3 — AR4/NFR3); the only shared import is the
// driver-agnostic `SCHEMA_SQL`/`StoreBusyError`/path helpers (none of which touch a driver).

/** Bounded SQLite busy wait per call, in milliseconds (~5s, AR4/NFR3). Mirrors the better-sqlite3 value. */
export const BUSY_TIMEOUT_MS = 5000;

/** Max whole-call attempts before surfacing StoreBusyError. Mirrors the better-sqlite3 value. */
export const MAX_WRITE_ATTEMPTS = 3;

/** Options for {@link openNodeSqliteDatabase}. Mirrors the better-sqlite3 `OpenDatabaseOptions`. */
export interface OpenDatabaseOptions {
  /** Explicit DB path; bypasses discovery when provided. */
  dbPath?: string;
  /** Open read-only (skips WAL/dir creation). Default false. */
  readonly?: boolean;
}

/** SQLite error codes that mean "locked, retry may succeed" (same set as better-sqlite3). */
const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT']);

/**
 * True when `err` is a node:sqlite busy/locked error. node:sqlite throws an error whose
 * `code` is the SQLite extended/primary result code string (e.g. `SQLITE_BUSY`), mirroring
 * better-sqlite3 — so the same detection works. We read `code` defensively.
 */
function isBusyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && BUSY_CODES.has(code)) return true;
  // node:sqlite may also surface the busy condition in the message; treat a SQLITE_BUSY
  // substring as busy so a transient lock is retried rather than thrown raw.
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /SQLITE_BUSY/.test(message);
}

/**
 * Open the SQLite ledger via node:sqlite with WAL + busy_timeout and confirm WAL took
 * effect. Mirrors `../sqlite/connection.ts#openDatabase` exactly, but using the node:sqlite
 * `DatabaseSync` API. Creates `.agentbbs/` on first run (unless read-only or `:memory:`).
 *
 * @throws Error if WAL could not be enabled on a file-backed DB (fail loud, like the
 *   better-sqlite3 path).
 */
export function openNodeSqliteDatabase(
  options: OpenDatabaseOptions = {},
): DatabaseSync {
  const dbPath = options.dbPath ?? resolveDbPath();

  if (!options.readonly) {
    ensureDbDirectory(dbPath);
  }

  // node:sqlite has no `readonly` constructor flag pre-v24 readOnly option name; the
  // readOnly option exists since v22.12.0. Pass it so a read-only caller cannot write.
  const db = new DatabaseSync(dbPath, { readOnly: options.readonly ?? false });

  // busy_timeout is per-connection (not persisted) — set it on every open. Same value the
  // better-sqlite3 connection uses (BUSY_TIMEOUT_MS).
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  if (!options.readonly) {
    // WAL is persisted in the file, but set + verify on every writable open so a fresh DB
    // lands in WAL and a misconfigured one fails fast. In-memory DBs report `memory`.
    db.exec('PRAGMA journal_mode = WAL');
    if (dbPath !== ':memory:') {
      const mode = getJournalMode(db);
      if (mode !== 'wal') {
        db.close();
        throw new Error(
          `Failed to enable WAL mode on ${dbPath}: journal_mode is "${String(mode)}" (expected "wal").`,
        );
      }
    }
  }

  return db;
}

/** Read back the effective `busy_timeout` (ms) for a node:sqlite connection. */
export function getBusyTimeout(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA busy_timeout').get() as
    | { timeout?: number; busy_timeout?: number }
    | undefined;
  // The PRAGMA result column name is `timeout` for busy_timeout.
  const value = row?.timeout ?? row?.busy_timeout;
  return typeof value === 'number' ? value : 0;
}

/** Read back the effective `journal_mode` for a node:sqlite connection. */
export function getJournalMode(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA journal_mode').get() as
    | { journal_mode?: string }
    | undefined;
  return typeof row?.journal_mode === 'string' ? row.journal_mode : '';
}

/**
 * Run a write `fn` with bounded retry on `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT`. Identical
 * contract to `../sqlite/connection.ts#runWithRetry`: each attempt relies on node:sqlite's
 * `busy_timeout` to wait internally; up to {@link MAX_WRITE_ATTEMPTS} whole-call attempts;
 * sustained busy is wrapped in a typed {@link StoreBusyError} (never a raw driver error
 * past the seam). Non-busy errors propagate immediately, unwrapped.
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
