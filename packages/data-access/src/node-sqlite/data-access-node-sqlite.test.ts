// node:sqlite DataAccess adapter — contract parity tests (Story 10.2, AC3).
//
// REAL-RUNTIME: a genuine SQLite file in an OS temp dir, migrated via the SHARED schema,
// driven through the REAL `createDataAccessNodeSqlite` node:sqlite adapter (the same driver
// the VS Code extension host uses). These mirror the better-sqlite3 contract tests
// (sqlite/append.test.ts, append-guarded.test.ts, queries.test.ts, cursors.test.ts) so the
// SECOND NFR2 driver is proven to satisfy the IDENTICAL `@agentbbs/core` `DataAccess` port:
//   - append → exactly N rows, unique strictly-monotonic seqs in INPUT order; multi-event
//     append is ATOMIC (a forced mid-batch failure leaves zero rows);
//   - appendGuarded → a tripped uniqueness guard rolls back (nothing persists) + a passing
//     guard inserts; the check-then-insert shares ONE BEGIN IMMEDIATE transaction (FR1);
//   - eventsSince / eventsByType / eventsByActor are seq-ASC; maxSeq is 0 on empty;
//   - cursors getCursor/setCursor UPSERT (0 sentinel when unset, overwrite on re-set);
//   - WAL + busy_timeout took effect.
//
// Discoverable by the ROOT `pnpm test` (co-located packages/*/src/**/*.test.ts → node
// project; Rule 8). The marquee semantics (append monotonicity, appendGuarded atomicity) are
// mutation-tested non-vacuous in the sibling .mutation.test.ts (Rule 7).
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BoardError, register } from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataAccessNodeSqlite } from './data-access-node-sqlite.js';
import {
  getBusyTimeout,
  getJournalMode,
  openNodeSqliteDatabase,
} from './connection.js';
import { migrateNodeSqlite } from './migrate.js';
import { UNIQUENESS_CONFLICT, UniquenessConflictError } from '../errors.js';

import type { DataAccessHandle } from '../data-access.js';
import type { NewEvent } from '@agentbbs/core';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

function freshDataAccess(): DataAccessHandle {
  return createDataAccessNodeSqlite({ dbPath });
}

function seenEvents(handles: string[]): NewEvent[] {
  return handles.map((handle) => ({
    type: 'identity.seen' as const,
    actor: handle,
    payload: { handle },
  }));
}

const registeredGuard = (handle: string) => ({
  type: 'identity.registered' as const,
  field: 'handle',
  value: handle,
});

function registeredEvent(handle: string, focus = 'focus'): NewEvent {
  return {
    type: 'identity.registered',
    actor: handle,
    payload: { handle, currentFocus: focus },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-node-sqlite-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

describe('node:sqlite adapter — connection (WAL + busy_timeout took effect)', () => {
  it('opens a file DB in WAL with the bounded busy_timeout', () => {
    const db = openNodeSqliteDatabase({ dbPath });
    try {
      migrateNodeSqlite(db);
      expect(getJournalMode(db)).toBe('wal');
      expect(getBusyTimeout(db)).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe('node:sqlite adapter — append (N rows, monotonic seq in input order)', () => {
  it('appends exactly N rows, returning unique strictly-monotonic seqs in input order', async () => {
    da = freshDataAccess();
    const handles = Array.from({ length: 25 }, (_, i) => `agent-${i}`);
    const seqs = await da.append(seenEvents(handles));

    expect(seqs).toHaveLength(handles.length);
    expect(new Set(seqs).size).toBe(handles.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }

    // Read back through the real read path: actor order by seq matches input order.
    const events = await da.eventsByType('identity.seen');
    expect(events.map((e) => e.actor)).toEqual(handles);
    expect(events.map((e) => e.seq)).toEqual(seqs);
  });

  it('continues the monotonic sequence across separate append calls', async () => {
    da = freshDataAccess();
    const first = await da.append(seenEvents(['a', 'b']));
    const second = await da.append(seenEvents(['c']));
    expect(second[0]).toBeGreaterThan(first[1] as number);
  });

  it('resolves to [] for an empty batch without inserting', async () => {
    da = freshDataAccess();
    const seqs = await da.append([]);
    expect(seqs).toEqual([]);
    expect(await da.maxSeq()).toBe(0);
  });

  it('rolls back the ENTIRE batch when one insert fails mid-batch (all-or-nothing)', async () => {
    da = freshDataAccess();
    const bad = {
      type: 'identity.seen',
      actor: null as unknown as string, // NOT NULL violation mid-batch
      payload: { handle: 'x' },
    } as NewEvent;

    await expect(
      da.append([
        {
          type: 'identity.seen',
          actor: 'good-1',
          payload: { handle: 'good-1' },
        },
        bad,
        {
          type: 'identity.seen',
          actor: 'good-2',
          payload: { handle: 'good-2' },
        },
      ]),
    ).rejects.toThrow();

    // Atomicity: the whole BEGIN IMMEDIATE transaction rolled back — zero rows.
    expect(await da.maxSeq()).toBe(0);
  });

  it('round-trips a multi-word-keyed payload (camelCase ⇄ snake_case at rest)', async () => {
    da = freshDataAccess();
    await da.append([
      {
        type: 'project.announced',
        actor: 'alice',
        payload: { projectId: 'agentbbs', title: 'AgentBBS', description: 'x' },
      },
    ]);
    const [evt] = await da.eventsByType('project.announced');
    expect(evt?.payload).toEqual({
      projectId: 'agentbbs',
      title: 'AgentBBS',
      description: 'x',
    });
  });
});

describe('node:sqlite adapter — appendGuarded (atomic check-then-insert, FR1)', () => {
  it('inserts when the guard passes', async () => {
    da = freshDataAccess();
    const seqs = await da.appendGuarded(
      [registeredEvent('alice')],
      [registeredGuard('alice')],
    );
    expect(seqs).toHaveLength(1);
    const events = await da.eventsByType('identity.registered');
    expect(events.map((e) => e.actor)).toEqual(['alice']);
  });

  it('rejects with UniquenessConflictError + inserts NOTHING when the guard trips', async () => {
    da = freshDataAccess();
    await da.appendGuarded(
      [registeredEvent('alice')],
      [registeredGuard('alice')],
    );

    // A second guarded append for the SAME handle must trip the guard and roll back.
    await expect(
      da.appendGuarded([registeredEvent('alice')], [registeredGuard('alice')]),
    ).rejects.toBeInstanceOf(UniquenessConflictError);

    // Only ONE identity.registered persists (the tripped append rolled back atomically).
    const events = await da.eventsByType('identity.registered');
    expect(events).toHaveLength(1);
  });

  it('carries the tripped guard + the UNIQUENESS_CONFLICT code on the rejection', async () => {
    da = freshDataAccess();
    await da.appendGuarded([registeredEvent('bob')], [registeredGuard('bob')]);
    await expect(
      da.appendGuarded([registeredEvent('bob')], [registeredGuard('bob')]),
    ).rejects.toMatchObject({
      code: UNIQUENESS_CONFLICT,
      guard: { type: 'identity.registered', field: 'handle', value: 'bob' },
    });
  });

  it('drives the real core.register op end-to-end over the node:sqlite adapter', async () => {
    da = freshDataAccess();
    const identity = await register(da, { handle: 'carol', currentFocus: 'x' });
    expect(identity.handle).toBe('carol');
    // A duplicate registration maps the adapter conflict → the core HANDLE_TAKEN BoardError.
    await expect(
      register(da, { handle: 'carol', currentFocus: 'y' }),
    ).rejects.toMatchObject({ code: 'HANDLE_TAKEN' });
    await expect(
      register(da, { handle: 'carol', currentFocus: 'y' }),
    ).rejects.toBeInstanceOf(BoardError);
  });
});

describe('node:sqlite adapter — reads are seq-ASC; maxSeq + cursors', () => {
  it('eventsSince(cursor) returns only seq > cursor, seq-ASC', async () => {
    da = freshDataAccess();
    const seqs = await da.append(seenEvents(['a', 'b', 'c', 'd']));
    const fromSecond = await da.eventsSince(seqs[1] as number);
    expect(fromSecond.map((e) => e.actor)).toEqual(['c', 'd']);
    for (let i = 1; i < fromSecond.length; i++) {
      expect(fromSecond[i]!.seq).toBeGreaterThan(fromSecond[i - 1]!.seq);
    }
  });

  it('eventsByActor returns that actor seq-ASC', async () => {
    da = freshDataAccess();
    await da.append([
      { type: 'identity.seen', actor: 'a', payload: { handle: 'a' } },
      { type: 'identity.seen', actor: 'b', payload: { handle: 'b' } },
      { type: 'identity.seen', actor: 'a', payload: { handle: 'a' } },
    ]);
    const a = await da.eventsByActor('a');
    expect(a).toHaveLength(2);
    expect(a[0]!.seq).toBeLessThan(a[1]!.seq);
  });

  it('maxSeq is 0 on empty and the highest seq otherwise', async () => {
    da = freshDataAccess();
    expect(await da.maxSeq()).toBe(0);
    const seqs = await da.append(seenEvents(['a', 'b', 'c']));
    expect(await da.maxSeq()).toBe(Math.max(...seqs));
  });

  it('cursors: unset → 0; setCursor UPSERTs (insert then overwrite), one row per handle', async () => {
    da = freshDataAccess();
    expect(await da.getCursor('alice')).toBe(0); // unset sentinel
    await da.setCursor('alice', 5);
    expect(await da.getCursor('alice')).toBe(5);
    await da.setCursor('alice', 9); // overwrite, not a second row
    expect(await da.getCursor('alice')).toBe(9);
    // A different handle is independent.
    expect(await da.getCursor('bob')).toBe(0);
  });
});
