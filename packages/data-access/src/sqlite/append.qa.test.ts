// QA-added coverage (Story 1.5, AC1/AC2) — REAL-RUNTIME, OS temp dirs only.
//
// Complements the dev's append.test.ts / migrate.test.ts by closing genuine
// AC-surface gaps the existing suite does not assert directly:
//   - AC2 (NFR10, "never reused"): after a batch ROLLS BACK mid-flight, the
//     sequence is not left corrupt — a subsequent successful append still returns
//     seqs strictly greater than the last COMMITTED seq, and the AUTOINCREMENT
//     high-water mark in sqlite_sequence only ever advances (never decreases /
//     reuses). This is the property Story 1.7's N×M concurrency proof relies on.
//   - AC2 (THE APPEND INVARIANT): total order is `seq`, NEVER `created_at`. With
//     rows whose `created_at` deliberately sorts OPPOSITE to insertion order,
//     `ORDER BY seq` still reflects insertion order — the ledger's authoritative
//     ordering is independent of the display-only timestamp.
//   - AC1: the events columns are in the exact DDL ORDINAL order
//     (seq, type, actor, created_at, payload) — PRAGMA `cid` order, which the
//     name-set assertion in migrate.test.ts does not pin.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir()
// and the temp tree is removed in afterEach.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newEventToRow } from '../mapping.js';
import { createAppend } from './append.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

import type { NewEvent } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

interface ColumnInfo {
  cid: number;
  name: string;
}

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

function freshDb(): DatabaseInstance {
  const opened = openDatabase({ dbPath });
  migrate(opened);
  return opened;
}

function seen(handle: string): NewEvent {
  return { type: 'identity.seen', actor: handle, payload: { handle } };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-append-qa-'));
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

describe('append — sequence integrity across rollback (AC2 / NFR10)', () => {
  it('does not corrupt the sequence: a rejected batch leaves a clean monotonic continuation', async () => {
    db = freshDb();
    const append = createAppend(db);

    // 1) Commit a good batch.
    const committed = await append([seen('a'), seen('b')]);
    expect(committed).toHaveLength(2);

    // 2) A batch that fails mid-flight (NULL into NOT NULL actor) must roll back.
    const bad = {
      type: 'identity.seen',
      actor: null as unknown as string,
      payload: { handle: 'x' },
    } as NewEvent;
    await expect(append([seen('c'), bad, seen('d')])).rejects.toThrow();

    // The rollback persisted nothing: still exactly the 2 committed rows.
    const count = db.prepare('SELECT COUNT(*) AS n FROM events').get() as {
      n: number;
    };
    expect(count.n).toBe(2);

    // 3) A subsequent good append continues STRICTLY ABOVE the last committed seq.
    const after = await append([seen('e')]);
    const lastCommitted = committed[committed.length - 1] as number;
    expect(after[0]).toBeGreaterThan(lastCommitted);

    // And the persisted ledger is still strictly increasing with no reused seq.
    const seqs = (
      db.prepare('SELECT seq FROM events ORDER BY seq ASC').all() as {
        seq: number;
      }[]
    ).map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
  });

  it('the AUTOINCREMENT high-water mark only advances (never reused) even across a rollback', async () => {
    db = freshDb();
    const append = createAppend(db);

    await append([seen('a'), seen('b'), seen('c')]);
    const highAfterCommit = (
      db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'")
        .get() as { seq: number }
    ).seq;
    expect(highAfterCommit).toBe(3);

    // Failed batch: rolls back the inserts. AUTOINCREMENT's high-water mark must
    // never go backwards / reuse a value.
    const bad = {
      type: 'identity.seen',
      actor: null as unknown as string,
      payload: { handle: 'x' },
    } as NewEvent;
    await expect(append([seen('d'), bad])).rejects.toThrow();

    const highAfterRollback = (
      db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'")
        .get() as { seq: number }
    ).seq;
    expect(highAfterRollback).toBeGreaterThanOrEqual(highAfterCommit);

    // Next successful append is strictly above the high-water mark — never reuses.
    const next = await append([seen('e')]);
    expect(next[0]).toBeGreaterThan(highAfterRollback);
  });
});

describe('append — total order is seq, never created_at (THE APPEND INVARIANT)', () => {
  it('orders by seq independently of the display-only created_at timestamp', () => {
    db = freshDb();

    // Insert three rows whose created_at DELIBERATELY sorts OPPOSITE to insertion
    // order. We go through the real mapping (newEventToRow) but stamp descending
    // timestamps, simulating clock skew / out-of-order display timestamps. The
    // ledger's authoritative order must remain insertion order via seq.
    const insert = db.prepare(
      'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
    );
    const descendingTimestamps = [
      '2026-05-30T03:00:00.000Z', // inserted 1st, but LATEST timestamp
      '2026-05-30T02:00:00.000Z', // inserted 2nd
      '2026-05-30T01:00:00.000Z', // inserted 3rd, but EARLIEST timestamp
    ];
    const insertionActors = ['first', 'second', 'third'];
    insertionActors.forEach((actor, i) => {
      const row = newEventToRow(seen(actor), descendingTimestamps[i] as string);
      insert.run(row.type, row.actor, row.created_at, row.payload);
    });

    // ORDER BY seq == insertion order.
    const bySeq = (
      db.prepare('SELECT actor FROM events ORDER BY seq ASC').all() as {
        actor: string;
      }[]
    ).map((r) => r.actor);
    expect(bySeq).toEqual(['first', 'second', 'third']);

    // ORDER BY created_at would be the OPPOSITE — proving the two orders genuinely
    // differ, so "order by seq" is a real, load-bearing choice (not coincidence).
    const byCreatedAt = (
      db.prepare('SELECT actor FROM events ORDER BY created_at ASC').all() as {
        actor: string;
      }[]
    ).map((r) => r.actor);
    expect(byCreatedAt).toEqual(['third', 'second', 'first']);
    expect(byCreatedAt).not.toEqual(bySeq);
  });
});

describe('migrate — exact column ordinal order (AC1)', () => {
  it('declares columns in DDL order: seq, type, actor, created_at, payload', () => {
    db = freshDb();

    const columns = db
      .prepare('PRAGMA table_info(events)')
      .all() as ColumnInfo[];

    // PRAGMA returns rows in cid (ordinal) order; pin the exact declaration order.
    const ordered = [...columns]
      .sort((a, b) => a.cid - b.cid)
      .map((c) => c.name);
    expect(ordered).toEqual(['seq', 'type', 'actor', 'created_at', 'payload']);
  });
});
