// appendGuarded tests (Story 2.2, Task 1) — REAL-RUNTIME: a genuine SQLite file
// in an OS temp dir, migrated via the real schema, exercised through the real
// `createAppendGuarded`. Pins the single-process guarantees the cross-process
// race (register-race.test.ts) then proves hold across OS processes:
//   - guard PASSES (value unclaimed) => the events insert and return monotonic
//     seqs in input order;
//   - guard TRIPS (value already present) => UniquenessConflictError, and ZERO
//     rows were inserted (the immediate transaction rolled back);
//   - the conflict is detected on the guard's `type` + payload `field` only (a
//     same value under a different type / different field does NOT collide);
//   - the carried `guard` identifies which predicate failed;
//   - empty events resolve to [] without inserting.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppendGuarded } from './append-guarded.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { UniquenessConflictError } from '../errors.js';

import type { NewEvent, UniquenessGuard } from '@agentbbs/core';
import type { Database as DatabaseInstance } from 'better-sqlite3';

let dir: string;
let dbPath: string;
let db: DatabaseInstance | undefined;

function freshDb(): DatabaseInstance {
  const opened = openDatabase({ dbPath });
  migrate(opened);
  return opened;
}

/** A registration event for `handle` (camelCase payload, as core supplies). */
function registered(handle: string, currentFocus = 'focus'): NewEvent {
  return {
    type: 'identity.registered',
    actor: handle,
    payload: { handle, currentFocus },
  };
}

/** The handle-uniqueness guard core passes for `register`. */
function handleGuard(handle: string): UniquenessGuard {
  return { type: 'identity.registered', field: 'handle', value: handle };
}

function rowCount(database: DatabaseInstance): number {
  return (
    database.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }
  ).n;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-append-guarded-'));
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

describe('appendGuarded — guard passes (value unclaimed)', () => {
  it('inserts the event(s) and returns monotonic seqs in input order', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    const seqs = await appendGuarded([registered('ada')], [handleGuard('ada')]);

    expect(seqs).toHaveLength(1);
    expect(rowCount(db)).toBe(1);

    // A second, DIFFERENT handle is also unclaimed → also inserts, seq continues.
    const seqs2 = await appendGuarded(
      [registered('bob')],
      [handleGuard('bob')],
    );
    expect(seqs2[0]).toBeGreaterThan(seqs[0] as number);
    expect(rowCount(db)).toBe(2);
  });

  it('with no guards behaves like a plain append (multi-event, in order)', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    const seqs = await appendGuarded(
      [registered('a'), registered('b'), registered('c')],
      [],
    );
    expect(seqs).toHaveLength(3);
    expect(new Set(seqs).size).toBe(3);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
    expect(rowCount(db)).toBe(3);

    const actors = (
      db.prepare('SELECT actor FROM events ORDER BY seq ASC').all() as {
        actor: string;
      }[]
    ).map((r) => r.actor);
    expect(actors).toEqual(['a', 'b', 'c']);
  });

  it('resolves to [] for an empty batch without inserting', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    const seqs = await appendGuarded([], [handleGuard('ada')]);
    expect(seqs).toEqual([]);
    expect(rowCount(db)).toBe(0);
  });
});

describe('appendGuarded — guard trips (value already claimed): atomic rollback', () => {
  it('rejects with UniquenessConflictError and inserts ZERO rows', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    // Seed the claimed handle.
    await appendGuarded([registered('ada')], [handleGuard('ada')]);
    expect(rowCount(db)).toBe(1);

    // A second register of the SAME handle must trip the guard.
    await expect(
      appendGuarded([registered('ada', 'other')], [handleGuard('ada')]),
    ).rejects.toBeInstanceOf(UniquenessConflictError);

    // Atomicity: nothing was appended by the failed call — still exactly one row.
    expect(rowCount(db)).toBe(1);
  });

  it('carries the tripped guard (type/field/value) on the error', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);
    await appendGuarded([registered('ada')], [handleGuard('ada')]);

    const err = await appendGuarded(
      [registered('ada')],
      [handleGuard('ada')],
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniquenessConflictError);
    expect((err as UniquenessConflictError).guard).toEqual({
      type: 'identity.registered',
      field: 'handle',
      value: 'ada',
    });
    expect((err as UniquenessConflictError).code).toBe('UNIQUENESS_CONFLICT');
  });

  it('rolls back the WHOLE batch when a guard trips (no partial insert of a multi-event append)', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);
    await appendGuarded([registered('taken')], [handleGuard('taken')]);
    expect(rowCount(db)).toBe(1);

    // Batch of two fresh events, but a guard on an ALREADY-claimed value → the
    // entire batch must roll back (neither fresh event persists).
    await expect(
      appendGuarded(
        [registered('fresh-1'), registered('fresh-2')],
        [handleGuard('taken')],
      ),
    ).rejects.toBeInstanceOf(UniquenessConflictError);
    expect(rowCount(db)).toBe(1);
  });
});

describe('appendGuarded — predicate scoping (type + payload field)', () => {
  it('does NOT collide on the same value under a DIFFERENT event type', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);

    // An identity.seen carrying handle "ada" exists…
    await appendGuarded(
      [{ type: 'identity.seen', actor: 'ada', payload: { handle: 'ada' } }],
      [],
    );
    // …but the registration guard is scoped to type 'identity.registered', so
    // registering "ada" must still succeed (different type → no collision).
    const seqs = await appendGuarded([registered('ada')], [handleGuard('ada')]);
    expect(seqs).toHaveLength(1);
    expect(rowCount(db)).toBe(2);
  });

  it('detects a collision via json_extract on the guarded payload field', async () => {
    db = freshDb();
    const appendGuarded = createAppendGuarded(db);
    await appendGuarded([registered('cleo')], [handleGuard('cleo')]);

    // Same type + same payload field value → collision.
    await expect(
      appendGuarded([registered('cleo')], [handleGuard('cleo')]),
    ).rejects.toBeInstanceOf(UniquenessConflictError);
    // A different value for the same field does NOT collide.
    await expect(
      appendGuarded([registered('cleo2')], [handleGuard('cleo2')]),
    ).resolves.toHaveLength(1);
  });
});
