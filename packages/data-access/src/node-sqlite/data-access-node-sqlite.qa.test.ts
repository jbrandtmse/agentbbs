// QA-added parity coverage for the node:sqlite adapter (Story 10.2, AC3) — REAL-RUNTIME, a
// genuine SQLite file in an OS temp dir, driven through the REAL `createDataAccessNodeSqlite`.
//
// The dev's data-access-node-sqlite.test.ts pins the happy path + the single-guard
// appendGuarded surface. This file closes the PARITY GAPS the better-sqlite3 QA suite
// (sqlite/append.qa.test.ts, append-guarded.qa.test.ts) asserts but the node:sqlite happy
// path skips — the SECOND NFR2 driver must satisfy the SAME contract, edge cases included:
//
//   - appendGuarded MULTI-guard: all-pass inserts the whole batch (input order); the LAST
//     guard tripping carries THAT guard + rolls the WHOLE batch back; a trip on guard[0]
//     inserts NONE of a multi-event batch (all guards gate before any insert);
//   - empty `guards` makes appendGuarded behave EXACTLY like append even for a value that
//     WOULD collide under a guard (it is the GUARDS that gate, not the events);
//   - sequence integrity across rollback (NFR10 / "never reused"): a rolled-back batch never
//     corrupts the monotonic continuation, and the AUTOINCREMENT high-water mark only ADVANCES
//     — the property the cross-process race (node-sqlite-register-race.test.ts) leans on;
//   - THE APPEND INVARIANT: total order is `seq`, NEVER `created_at` (rows stamped with
//     descending timestamps still read back in insertion order under the adapter's seq-ASC).
//
// Discoverable by the ROOT `pnpm test` (co-located packages/*/src/**/*.test.ts → node
// project; Rule 8). Never touches the repo's real `.agentbbs/`: every DB lives under tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDataAccessNodeSqlite,
  fromNodeSqliteConnection,
} from './data-access-node-sqlite.js';
import { openNodeSqliteDatabase } from './connection.js';
import { migrateNodeSqlite } from './migrate.js';
import { newEventToRow } from '../mapping.js';
import { UniquenessConflictError } from '../errors.js';

import type { DataAccessHandle } from '../data-access.js';
import type { NewEvent, UniquenessGuard } from '@agentbbs/core';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

function freshDataAccess(): DataAccessHandle {
  return createDataAccessNodeSqlite({ dbPath });
}

function registered(handle: string, currentFocus = 'focus'): NewEvent {
  return {
    type: 'identity.registered',
    actor: handle,
    payload: { handle, currentFocus },
  };
}

function handleGuard(handle: string): UniquenessGuard {
  return { type: 'identity.registered', field: 'handle', value: handle };
}

function seen(handle: string): NewEvent {
  return { type: 'identity.seen', actor: handle, payload: { handle } };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-node-sqlite-qa-'));
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

describe('node:sqlite appendGuarded — MULTI-guard parity (all gate before any insert)', () => {
  it('all guards pass → the whole MULTI-event batch inserts, seqs monotonic in INPUT order', async () => {
    da = freshDataAccess();
    const seqs = await da.appendGuarded(
      [registered('ada'), registered('bob'), registered('cleo')],
      [handleGuard('ada'), handleGuard('bob'), handleGuard('cleo')],
    );
    expect(seqs).toHaveLength(3);
    expect(new Set(seqs).size).toBe(3);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
    const events = await da.eventsByType('identity.registered');
    expect(events.map((e) => e.actor)).toEqual(['ada', 'bob', 'cleo']);
  });

  it('the LAST guard trips → the conflict carries THAT guard and the WHOLE batch rolls back', async () => {
    da = freshDataAccess();
    await da.appendGuarded([registered('taken')], [handleGuard('taken')]);

    const err = await da
      .appendGuarded(
        [registered('fresh-1'), registered('fresh-2')],
        [handleGuard('fresh-1'), handleGuard('taken')],
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniquenessConflictError);
    expect((err as UniquenessConflictError).guard).toEqual({
      type: 'identity.registered',
      field: 'handle',
      value: 'taken',
    });
    // Atomic: neither fresh event persisted — still just the seeded "taken" row.
    const events = await da.eventsByType('identity.registered');
    expect(events.map((e) => e.actor)).toEqual(['taken']);
  });

  it('a trip on the FIRST guard inserts NONE of a multi-event batch', async () => {
    da = freshDataAccess();
    await da.appendGuarded([registered('first-taken')], [handleGuard('first-taken')]);

    await expect(
      da.appendGuarded(
        [registered('x'), registered('y'), registered('z')],
        [handleGuard('first-taken'), handleGuard('y')],
      ),
    ).rejects.toBeInstanceOf(UniquenessConflictError);

    // Exactly the one seeded row — the three-event batch rolled back entirely.
    const events = await da.eventsByType('identity.registered');
    expect(events.map((e) => e.actor)).toEqual(['first-taken']);
  });

  it('EMPTY guards behaves exactly like append — inserts a value that WOULD collide under a guard', async () => {
    da = freshDataAccess();
    await da.appendGuarded([registered('dup')], [handleGuard('dup')]);

    // Append "dup" AGAIN but with an EMPTY guard array: no precondition is asserted,
    // so it inserts a second identity.registered for the same handle (the GUARDS gate,
    // not the event content).
    const seqs = await da.appendGuarded([registered('dup', 'again')], []);
    expect(seqs).toHaveLength(1);
    const dup = (await da.eventsByType('identity.registered')).filter(
      (e) => e.actor === 'dup',
    );
    expect(dup).toHaveLength(2);
  });
});

describe('node:sqlite append — sequence integrity across rollback (NFR10 / never reused)', () => {
  it('a rolled-back batch leaves a clean strictly-monotonic continuation (no seq reuse)', async () => {
    da = freshDataAccess();
    const committed = await da.append([seen('a'), seen('b')]);
    expect(committed).toHaveLength(2);

    // A batch that fails mid-flight (NULL into NOT NULL actor) must roll back.
    const bad = {
      type: 'identity.seen',
      actor: null as unknown as string,
      payload: { handle: 'x' },
    } as NewEvent;
    await expect(da.append([seen('c'), bad, seen('d')])).rejects.toThrow();

    // A subsequent good append continues STRICTLY ABOVE the last COMMITTED seq, and the
    // whole persisted ledger is strictly increasing with no reused seq.
    const after = await da.append([seen('e')]);
    expect(after[0]).toBeGreaterThan(committed[committed.length - 1] as number);

    const all = await da.eventsSince(0);
    const seqs = all.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
    }
    // Exactly the three committed rows (a, b, e); the failed batch persisted nothing.
    expect(all.map((e) => e.actor)).toEqual(['a', 'b', 'e']);
  });
});

describe('node:sqlite reads — total order is seq, NEVER created_at (THE APPEND INVARIANT)', () => {
  it('orders by seq independently of the display-only created_at timestamp', async () => {
    // Stamp rows with created_at that sorts OPPOSITE to insertion order, going through the
    // real mapping + a raw insert on the SAME schema, then read back via the adapter's
    // seq-ASC eventsSince. (Raw insert is the only way to control created_at, since
    // insertBatch stamps `now`.) The authoritative order must remain insertion order.
    const db = openNodeSqliteDatabase({ dbPath });
    migrateNodeSqlite(db);
    const insert = db.prepare(
      'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
    );
    const descending = [
      '2026-05-30T03:00:00.000Z', // inserted 1st, LATEST timestamp
      '2026-05-30T02:00:00.000Z',
      '2026-05-30T01:00:00.000Z', // inserted 3rd, EARLIEST timestamp
    ];
    ['first', 'second', 'third'].forEach((actor, i) => {
      const row = newEventToRow(seen(actor), descending[i] as string);
      insert.run(row.type, row.actor, row.created_at, row.payload);
    });

    // Read back through the adapter over the SAME open connection — seq-ASC == insertion order.
    da = fromNodeSqliteConnection(db);
    const bySeq = (await da.eventsSince(0)).map((e) => e.actor);
    expect(bySeq).toEqual(['first', 'second', 'third']);
  });
});
