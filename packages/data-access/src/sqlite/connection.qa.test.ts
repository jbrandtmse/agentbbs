// QA-added coverage (Story 1.4, AC1/AC2) — REAL-RUNTIME, OS temp dirs only.
//
// Complements the dev's connection.test.ts by closing genuine AC-surface gaps
// the existing suite does not assert directly:
//   - AC1: openDatabase() physically CREATES `.agentbbs/` (and the .db file) on
//     first run from an ABSENT state — the AC1 "created on first run" side-effect,
//     observed at the openDatabase boundary (the dev test only read journal_mode).
//   - AC1: WAL mode leaves its defining observable artifact on disk — a `-wal`
//     sidecar file after a write — i.e. real file-level WAL evidence, not just the
//     pragma read-back.
//   - AC2: SQLITE_BUSY_SNAPSHOT (the other code in BUSY_CODES) is treated as
//     retryable and, when sustained, exhausts to the typed StoreBusyError. The
//     dev's contention tests only ever induce plain SQLITE_BUSY.
//   - AC2: the DEFAULT bound (MAX_WRITE_ATTEMPTS, no explicit attempts arg) is the
//     one wired into runWithRetry on exhaustion.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir()
// and the temp tree is removed in afterEach.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreBusyError } from '../errors.js';
import {
  MAX_WRITE_ATTEMPTS,
  getJournalMode,
  openDatabase,
  runWithRetry,
} from './connection.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-conn-qa-'));
  // Nested under a not-yet-existing `.agentbbs/` so first-run creation is real.
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase — first-run side effects on disk (AC1)', () => {
  it('creates the absent .agentbbs/ directory and the DB file on first run', () => {
    const agentbbsDir = dirname(dbPath);
    // Precondition: neither the dir nor the file exists yet.
    expect(existsSync(agentbbsDir)).toBe(false);
    expect(existsSync(dbPath)).toBe(false);

    const db = openDatabase({ dbPath });
    try {
      expect(existsSync(agentbbsDir)).toBe(true); // .agentbbs/ created
      expect(existsSync(dbPath)).toBe(true); // the ledger file materialised
    } finally {
      db.close();
    }
  });

  it('leaves an observable WAL sidecar (-wal file) on disk after a write', () => {
    const db = openDatabase({ dbPath });
    try {
      expect(getJournalMode(db)).toBe('wal');
      // A write under WAL produces the `<db>-wal` sidecar — the defining,
      // file-level evidence that WAL (not rollback-journal) is in effect.
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      db.prepare('INSERT INTO t DEFAULT VALUES').run();
      expect(existsSync(`${dbPath}-wal`)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('runWithRetry — busy-code branch + default bound (AC2)', () => {
  /** A fake error carrying a SQLite busy `.code`, like better-sqlite3 surfaces. */
  function busyError(code: 'SQLITE_BUSY' | 'SQLITE_BUSY_SNAPSHOT'): Error {
    const err = new Error(`database is locked (${code})`);
    (err as Error & { code: string }).code = code;
    return err;
  }

  it('retries SQLITE_BUSY_SNAPSHOT and SUCCEEDS on a later attempt', () => {
    let attempt = 0;
    const result = runWithRetry(() => {
      attempt += 1;
      if (attempt === 1) throw busyError('SQLITE_BUSY_SNAPSHOT');
      return 'committed';
    }, 5);

    expect(attempt).toBe(2);
    expect(result).toBe('committed');
  });

  it('exhausts on sustained SQLITE_BUSY_SNAPSHOT into the typed StoreBusyError', () => {
    let thrown: unknown;
    try {
      runWithRetry(() => {
        throw busyError('SQLITE_BUSY_SNAPSHOT');
      }, 2);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(StoreBusyError);
    const busy = thrown as StoreBusyError;
    expect(busy.attempts).toBe(2);
    expect((busy.cause as { code?: string }).code).toBe('SQLITE_BUSY_SNAPSHOT');
  });

  it('uses the exported default bound (MAX_WRITE_ATTEMPTS) when none is passed', () => {
    let attempts = 0;
    let thrown: unknown;
    try {
      runWithRetry(() => {
        attempts += 1;
        throw busyError('SQLITE_BUSY');
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(StoreBusyError);
    expect(attempts).toBe(MAX_WRITE_ATTEMPTS);
    expect((thrown as StoreBusyError).attempts).toBe(MAX_WRITE_ATTEMPTS);
  });
});
