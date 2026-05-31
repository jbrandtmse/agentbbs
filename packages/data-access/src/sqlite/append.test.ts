// Append tests (Story 1.5, AC2) — REAL-RUNTIME: a genuine SQLite file in an OS
// temp dir, migrated via the real schema, appended through the real `createAppend`.
//
// This is the substrate Story 1.7's N×M concurrency proof builds on, so the
// single-process guarantees are pinned down hard here:
//   - append of N events => exactly N rows, returning unique strictly-monotonic
//     `seq`s in INPUT order;
//   - a multi-event append is ATOMIC (a forced failure mid-batch leaves zero rows);
//   - `created_at` is a valid ISO-8601 UTC string;
//   - payload round-trips: snake_case keys on disk (read raw), camelCase from core.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppend } from './append.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

import type { NewEvent } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

interface RawEventRow {
  seq: number;
  type: string;
  actor: string;
  created_at: string;
  payload: string;
}

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

function freshDb(): DatabaseInstance {
  const opened = openDatabase({ dbPath });
  migrate(opened);
  return opened;
}

function seenEvents(handles: string[]): NewEvent[] {
  return handles.map((handle) => ({
    type: 'identity.seen' as const,
    actor: handle,
    payload: { handle },
  }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-append-'));
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

describe('append — N rows, monotonic seq in input order (AC2)', () => {
  it('appends exactly N rows and returns unique strictly-monotonic seqs in order', async () => {
    db = freshDb();
    const append = createAppend(db);

    const handles = Array.from({ length: 25 }, (_, i) => `agent-${i}`);
    const seqs = await append(seenEvents(handles));

    // Exactly N rows.
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM events')
      .get() as { n: number };
    expect(count.n).toBe(handles.length);

    // N seqs, unique, strictly increasing.
    expect(seqs).toHaveLength(handles.length);
    expect(new Set(seqs).size).toBe(handles.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }

    // Returned seqs correspond to rows in INPUT order (actor order by seq matches).
    const rows = db
      .prepare('SELECT seq, actor FROM events ORDER BY seq ASC')
      .all() as RawEventRow[];
    expect(rows.map((r) => r.actor)).toEqual(handles);
    expect(rows.map((r) => r.seq)).toEqual(seqs);
  });

  it('continues the monotonic sequence across separate append calls', async () => {
    db = freshDb();
    const append = createAppend(db);

    const first = await append(seenEvents(['a', 'b']));
    const second = await append(seenEvents(['c']));

    expect(second[0]).toBeGreaterThan(first[1] as number);
  });

  it('resolves to [] for an empty batch without inserting', async () => {
    db = freshDb();
    const append = createAppend(db);

    const seqs = await append([]);
    expect(seqs).toEqual([]);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM events')
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe('append — atomic multi-event append (AC2)', () => {
  it('rolls back the entire batch when one insert fails mid-batch (all-or-nothing)', async () => {
    db = freshDb();
    const append = createAppend(db);

    // A NewEvent whose actor is non-TEXT-coercible would still insert; instead force
    // a genuine constraint failure: stub a row with a NULL NOT NULL column by
    // injecting an event whose mapping yields a null. We do that by passing an
    // event the type system would reject, via an unchecked cast, to simulate a
    // mid-batch driver failure. The point is: if ANY insert throws, NONE persist.
    const bad = {
      type: 'identity.seen',
      actor: null as unknown as string,
      payload: { handle: 'x' },
    } as NewEvent;

    await expect(
      append([
        { type: 'identity.seen', actor: 'good-1', payload: { handle: 'good-1' } },
        bad,
        { type: 'identity.seen', actor: 'good-2', payload: { handle: 'good-2' } },
      ]),
    ).rejects.toThrow();

    // Atomicity: the whole transaction rolled back — zero rows.
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM events')
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe('append — created_at ISO-8601 UTC + payload round-trip (AC2)', () => {
  it('stores created_at as a valid ISO-8601 UTC string', async () => {
    db = freshDb();
    const append = createAppend(db);
    await append(seenEvents(['alice']));

    const row = db
      .prepare('SELECT created_at FROM events WHERE seq = 1')
      .get() as RawEventRow;

    // Strict ISO-8601 UTC (the exact shape `Date.prototype.toISOString` produces).
    expect(row.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    // Round-trips through Date without loss and is a real instant.
    expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
  });

  it('persists payload with snake_case keys on disk (camelCase from core)', async () => {
    db = freshDb();
    const append = createAppend(db);

    await append([
      {
        type: 'identity.registered',
        actor: 'alice',
        payload: { handle: 'alice', currentFocus: 'shipping 1.5' },
      },
    ]);

    const row = db
      .prepare('SELECT payload FROM events WHERE seq = 1')
      .get() as RawEventRow;

    // Raw on-disk JSON is snake_case.
    expect(row.payload).toContain('current_focus');
    expect(row.payload).not.toContain('currentFocus');

    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    expect(parsed).toEqual({ handle: 'alice', current_focus: 'shipping 1.5' });
  });

  it('round-trips a multi-word-keyed payload (project.announced)', async () => {
    db = freshDb();
    const append = createAppend(db);

    await append([
      {
        type: 'project.announced',
        actor: 'alice',
        payload: {
          projectId: 'agentbbs',
          title: 'AgentBBS',
          description: 'coordination',
        },
      },
    ]);

    const row = db
      .prepare('SELECT type, payload FROM events WHERE seq = 1')
      .get() as RawEventRow;
    expect(row.type).toBe('project.announced');
    expect(JSON.parse(row.payload)).toEqual({
      project_id: 'agentbbs',
      title: 'AgentBBS',
      description: 'coordination',
    });
  });
});
