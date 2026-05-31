// Connection tests (Story 1.4, AC1/AC2) — REAL-RUNTIME: a genuine SQLite file
// opened via better-sqlite3 in an OS temp dir. Asserts WAL + busy_timeout, and
// induces a REAL SQLITE_BUSY (held write lock on a second connection) to prove
// (a) a retried write succeeds within the window, and (b) exhausting the bound
// throws the TYPED StoreBusyError — never a raw better-sqlite3 error.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreBusyError } from '../errors.js';
import {
  BUSY_TIMEOUT_MS,
  getBusyTimeout,
  getJournalMode,
  openDatabase,
  runWithRetry,
} from './connection.js';

import type { Database as DatabaseInstance } from 'better-sqlite3';

let dir: string;
let dbPath: string;
const opened: DatabaseInstance[] = [];

function track(db: DatabaseInstance): DatabaseInstance {
  opened.push(db);
  return db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-conn-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
});

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase — WAL + busy_timeout + discovery (AC1)', () => {
  it('creates .agentbbs/ on first run and opens a fresh DB in WAL', () => {
    const db = track(openDatabase({ dbPath }));
    expect(getJournalMode(db)).toBe('wal');
  });

  it('sets the bounded busy_timeout (~5s)', () => {
    const db = track(openDatabase({ dbPath }));
    expect(getBusyTimeout(db)).toBe(BUSY_TIMEOUT_MS);
    expect(BUSY_TIMEOUT_MS).toBe(5000);
  });

  it('discovers via AGENTBBS_DB override when no dbPath is passed', () => {
    const previous = process.env.AGENTBBS_DB;
    process.env.AGENTBBS_DB = dbPath;
    try {
      const db = track(openDatabase());
      expect(getJournalMode(db)).toBe('wal');
    } finally {
      if (previous === undefined) delete process.env.AGENTBBS_DB;
      else process.env.AGENTBBS_DB = previous;
    }
  });
});

describe('runWithRetry — real SQLITE_BUSY contention (AC2)', () => {
  // Open a writer with busy_timeout=0 so a held lock surfaces SQLITE_BUSY
  // IMMEDIATELY (deterministic, no multi-second waits in the test).
  function openWriterNoWait(): DatabaseInstance {
    const db = track(new Database(dbPath));
    db.pragma('busy_timeout = 0');
    return db;
  }

  beforeEach(() => {
    // Initialise schema + WAL via the real connection module, then close so the
    // contention test controls all open connections.
    const setup = openDatabase({ dbPath });
    setup.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    setup.close();
  });

  it('induces a genuine SQLITE_BUSY and proves the retried write SUCCEEDS within the window', () => {
    const holder = openWriterNoWait(); // holds an exclusive write lock
    const writer = openWriterNoWait(); // contends for it

    // Sanity: with the lock held and busy_timeout=0, a write throws SQLITE_BUSY.
    holder.prepare('BEGIN IMMEDIATE').run();
    let sawBusy = false;
    try {
      writer.prepare('INSERT INTO t (v) VALUES (?)').run('blocked');
    } catch (err) {
      sawBusy = (err as { code?: string }).code === 'SQLITE_BUSY';
    }
    expect(sawBusy).toBe(true);

    // Now drive runWithRetry: the holder releases its lock after the first
    // failed attempt, so a SUBSEQUENT attempt succeeds within the bound.
    let attempt = 0;
    const result = runWithRetry(() => {
      attempt += 1;
      if (attempt === 1) {
        // First attempt collides with the still-held lock → real SQLITE_BUSY.
        return writer.prepare('INSERT INTO t (v) VALUES (?)').run('a');
      }
      // Before a later attempt, release the contended lock so the write lands.
      holder.prepare('COMMIT').run();
      return writer.prepare('INSERT INTO t (v) VALUES (?)').run('a');
    }, 5);

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(result.changes).toBe(1);
    const count = writer.prepare('SELECT COUNT(*) AS n FROM t').get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it('throws the TYPED StoreBusyError (not a raw better-sqlite3 error) when the bound is exhausted', () => {
    const holder = openWriterNoWait();
    const writer = openWriterNoWait();
    holder.prepare('BEGIN IMMEDIATE').run(); // never released → sustained contention

    let thrown: unknown;
    try {
      runWithRetry(
        () => writer.prepare('INSERT INTO t (v) VALUES (?)').run('x'),
        3,
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(StoreBusyError);
    const busy = thrown as StoreBusyError;
    expect(busy.code).toBe('STORE_BUSY');
    expect(busy.attempts).toBe(3);
    // The raw better-sqlite3 error is preserved as the cause but NOT surfaced.
    expect((busy.cause as { code?: string }).code).toBe('SQLITE_BUSY');

    holder.prepare('COMMIT').run();
  });

  it('propagates a non-busy error unwrapped', () => {
    const db = openWriterNoWait();
    expect(() =>
      runWithRetry(() =>
        db.prepare('INSERT INTO no_such_table VALUES (1)').run(),
      ),
    ).toThrow(/no such table/i);
  });
});
