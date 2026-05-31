// Migration tests (Story 1.5, AC1) — REAL-RUNTIME: a genuine SQLite file in an OS
// temp dir, opened via the real Story 1.4 connection module. Asserts the EXACT
// baseline schema (columns + the two indexes) and that the migration is
// forward-only idempotent (running it twice neither errors nor duplicates schema).
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

import type { Database as DatabaseInstance } from 'better-sqlite3';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface MasterRow {
  type: string;
  name: string;
}

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-migrate-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
});

afterEach(() => {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  db = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('migrate — schema shape (AC1)', () => {
  it('creates the events table with the exact snake_case columns', () => {
    db = openDatabase({ dbPath });
    migrate(db);

    const columns = db
      .prepare('PRAGMA table_info(events)')
      .all() as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    // Exactly the five snake_case columns, no more.
    expect([...byName.keys()].sort()).toEqual(
      ['actor', 'created_at', 'payload', 'seq', 'type'].sort(),
    );

    // seq is the INTEGER PRIMARY KEY.
    expect(byName.get('seq')?.pk).toBe(1);
    expect(byName.get('seq')?.type).toBe('INTEGER');

    // The non-seq columns are NOT NULL TEXT.
    for (const col of ['type', 'actor', 'created_at', 'payload']) {
      expect(byName.get(col)?.type).toBe('TEXT');
      expect(byName.get(col)?.notnull).toBe(1);
    }
  });

  it('declares seq as AUTOINCREMENT (sqlite_sequence row exists after first insert)', () => {
    db = openDatabase({ dbPath });
    migrate(db);

    // AUTOINCREMENT tables get a sqlite_sequence entry once a row is inserted.
    db.prepare(
      'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
    ).run('identity.seen', 'alice', '2026-05-30T00:00:00.000Z', '{}');

    const seqRow = db
      .prepare("SELECT name FROM sqlite_sequence WHERE name = 'events'")
      .get() as { name: string } | undefined;
    expect(seqRow?.name).toBe('events');

    // The DDL text records AUTOINCREMENT (belt-and-suspenders on the column decl).
    const ddl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='events'",
      )
      .get() as { sql: string };
    expect(ddl.sql).toMatch(/AUTOINCREMENT/i);
  });

  it('creates the baseline indexes idx_events_type and idx_events_actor', () => {
    db = openDatabase({ dbPath });
    migrate(db);

    const indexes = db
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE type='index' AND tbl_name='events'",
      )
      .all() as MasterRow[];
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_events_type');
    expect(names).toContain('idx_events_actor');
  });
});

describe('migrate — forward-only idempotency (AC1)', () => {
  it('runs twice without error and without duplicating schema', () => {
    db = openDatabase({ dbPath });

    migrate(db);
    // Second application must be a pure no-op (IF NOT EXISTS throughout).
    expect(() => migrate(db as DatabaseInstance)).not.toThrow();

    // Still exactly one events table.
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events'",
      )
      .all() as MasterRow[];
    expect(tables).toHaveLength(1);

    // Still exactly one of each baseline index (no duplicates).
    const typeIdx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_type'",
      )
      .all() as MasterRow[];
    const actorIdx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_actor'",
      )
      .all() as MasterRow[];
    expect(typeIdx).toHaveLength(1);
    expect(actorIdx).toHaveLength(1);
  });

  it('preserves existing rows across a re-migration (no data loss / recreate)', () => {
    db = openDatabase({ dbPath });
    migrate(db);

    db.prepare(
      'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
    ).run('identity.seen', 'alice', '2026-05-30T00:00:00.000Z', '{}');

    // Re-migrate; the row must survive (proves IF NOT EXISTS, not DROP+CREATE).
    migrate(db);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM events')
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
