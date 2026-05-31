// Integration AC #2 (Story 2.5, Task 3) — REAL-RUNTIME evidence (skill-rules
// Rule 3). The `recordSeen` presence primitive (core) is exercised against the
// REAL `createDataAccess` (better-sqlite3 behind the NFR2 seam) over a genuine
// SQLite file in an OS temp dir. NOTHING is mocked: core's recordSeen + the
// identity.seen projection fold + the actual storage engine.
//
// This story adds NO MCP tool (the first consumers are Story 6.1 `check` and the
// Epic 4 post tools), so the binding real-runtime proof is the primitive against
// the real ledger — not an MCP-client round-trip. It asserts the AC #2 outcomes:
//   - each recordSeen appends EXACTLY ONE identity.seen event;
//   - the directory-derived last_seen ADVANCES (monotonic non-regression) and
//     EQUALS the latest event's created_at, while current_focus / created_at are
//     UNCHANGED;
//   - APPEND-ONLY: the total ledger grows by exactly one per call and the prior
//     identity.registered / identity.seen rows are RETAINED;
//   - last_seen is ONLY EVER DERIVED — there is NO stored last_seen column and no
//     schema drift: the on-disk schema is the single `events` ledger (the
//     append-invariant lint guard covers the source; this asserts the runtime
//     schema directly), and no stored payload carries a `last_seen` key.
//
// This test lives in data-access (not core) because it needs BOTH @agentbbs/core
// (recordSeen + foldIdentities) AND better-sqlite3 for direct schema introspection
// — and core's lint forbids it from importing the storage adapter. data-access
// already depends on both. As of Story 3.0, the root vitest `resolve.alias` maps
// @agentbbs/core to its src/index.ts, so core's recordSeen resolves from live TS
// source — no prior `pnpm run build` is required for this cross-package suite.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import {
  foldIdentities,
  recordSeen,
  register,
  updateFocus,
} from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { DataAccessHandle } from './data-access.js';
import type { Identity } from '@agentbbs/core';

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
let da: DataAccessHandle | undefined;

/** Total event count in the real ledger (across all types). */
async function totalEvents(): Promise<number> {
  return (await da!.eventsSince(0)).length;
}

/** The directory-derived identity for `handle`, folded from its real event stream. */
async function derived(handle: string): Promise<Identity | undefined> {
  return foldIdentities(await da!.eventsByActor(handle)).get(handle);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-record-seen-int-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  da = createDataAccess({ dbPath });
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('recordSeen over a real createDataAccess ledger (AC #2)', () => {
  it('register H then recordSeen appends exactly one identity.seen, derives advanced last_seen, and RETAINS the registration (append-only)', async () => {
    const registered = await register(da!, {
      handle: 'ada',
      currentFocus: 'my focus',
    });
    expect(await totalEvents()).toBe(1); // just the registration
    const registeredAt = registered.createdAt;

    const identity = await recordSeen(da!, 'ada');

    // The returned identity: handle + current_focus + created_at pinned to the
    // registration; last_seen advanced to the seen event's created_at.
    expect(identity.handle).toBe('ada');
    expect(identity.currentFocus).toBe('my focus');
    expect(identity.createdAt).toBe(registeredAt);

    // The ledger now holds BOTH events for ada, in seq order (append-only).
    const adaEvents = (await da!.eventsByActor('ada')).sort(
      (a, b) => a.seq - b.seq,
    );
    expect(adaEvents.map((e) => e.type)).toEqual([
      'identity.registered',
      'identity.seen',
    ]);
    // The ORIGINAL registration event still carries its focus — nothing overwritten.
    expect(
      (adaEvents[0]?.payload as { currentFocus: string }).currentFocus,
    ).toBe('my focus');
    // The identity.seen payload is exactly { handle } (camelCase out of the seam).
    expect(adaEvents[1]?.payload).toEqual({ handle: 'ada' });

    // last_seen equals the seen event's created_at, and never regresses below
    // the registration time (robust to clock granularity).
    const seenEvent = adaEvents[1];
    expect(identity.lastSeen).toBe(seenEvent?.createdAt);
    expect(identity.lastSeen >= identity.createdAt).toBe(true);
    // When the two appends landed in different milliseconds, last_seen strictly
    // advanced past the registration time (it never regresses to it).
    if (seenEvent?.createdAt !== registeredAt) {
      expect(identity.lastSeen).not.toBe(registeredAt);
    }
    // The directory-derived view agrees with the returned record.
    const dirView = await derived('ada');
    expect(dirView?.lastSeen).toBe(seenEvent?.createdAt);
    expect(dirView?.currentFocus).toBe('my focus');
    expect(dirView?.createdAt).toBe(registeredAt);
  });

  it('each recordSeen appends EXACTLY ONE event: the total ledger grows by exactly one per call and the registration survives all N calls', async () => {
    await register(da!, { handle: 'ada', currentFocus: 'focus' });
    expect(await totalEvents()).toBe(1);

    const N = 5;
    let prev = 1;
    for (let i = 1; i <= N; i += 1) {
      await recordSeen(da!, 'ada');
      const after = await totalEvents();
      // Exactly one new row per call — append-only, nothing overwritten/deleted.
      expect(after).toBe(prev + 1);
      prev = after;
      // The original registration (with its focus) still exists, unchanged.
      const registrations = await da!.eventsByType('identity.registered');
      expect(registrations).toHaveLength(1);
      expect(
        (registrations[0]?.payload as { currentFocus: string }).currentFocus,
      ).toBe('focus');
    }

    // Final: 1 registration + N identity.seen = N + 1 rows.
    expect(await totalEvents()).toBe(N + 1);
    expect(await da!.eventsByType('identity.seen')).toHaveLength(N);
  });

  it('last_seen advances (never regresses) across N pings and ALWAYS equals the latest identity.seen created_at over the real ledger', async () => {
    const registered = await register(da!, {
      handle: 'ada',
      currentFocus: 'focus',
    });
    let prevLastSeen = registered.createdAt;

    for (let i = 1; i <= 4; i += 1) {
      const identity = await recordSeen(da!, 'ada');
      const lastSeen = identity.lastSeen;

      // DERIVATION (deterministic): last_seen equals the created_at of the LATEST
      // identity.seen event in the real ledger — read, never fabricated.
      const seens = (await da!.eventsByActor('ada'))
        .filter((e) => e.type === 'identity.seen')
        .sort((a, b) => a.seq - b.seq);
      const latest = seens[seens.length - 1];
      expect(lastSeen).toBe(latest?.createdAt);

      // NON-REGRESSION: last_seen is monotonic across pings (ISO-8601 UTC strings
      // sort lexicographically === chronologically). Under ms-granularity collisions
      // it may equal the previous value; it must never move earlier.
      expect(lastSeen >= prevLastSeen).toBe(true);
      expect(lastSeen >= registered.createdAt).toBe(true);
      // current_focus / created_at never change via a presence ping.
      expect(identity.currentFocus).toBe('focus');
      expect(identity.createdAt).toBe(registered.createdAt);
      prevLastSeen = lastSeen;
    }
  });

  it('a recordSeen AFTER a focus update advances last_seen past the update without reverting the focus (real ledger)', async () => {
    // Exercises the interleaving the projection fold must get right against the
    // genuine storage engine: register → recordSeen → (focus changes via its own
    // event, simulated by appending identity.focus_updated through the same port) →
    // recordSeen again. The derived current_focus is the focus value; last_seen is
    // the latest identity event's created_at regardless of which type it was.
    await register(da!, { handle: 'ada', currentFocus: 'focus-0' });
    await recordSeen(da!, 'ada');
    // A focus update is its own appended event (Story 2.4). We append it directly
    // through the port to drive the interleaving without importing the MCP tool.
    await da!.append([
      {
        type: 'identity.focus_updated',
        actor: 'ada',
        payload: { handle: 'ada', currentFocus: 'focus-1' },
      },
    ]);
    const afterPing = await recordSeen(da!, 'ada');

    // The trailing ping advanced last_seen; the focus is the updated value (the ping
    // did not revert it), and created_at is still the registration time.
    const adaEvents = (await da!.eventsByActor('ada')).sort(
      (a, b) => a.seq - b.seq,
    );
    const latest = adaEvents[adaEvents.length - 1];
    expect(latest?.type).toBe('identity.seen');
    expect(afterPing.currentFocus).toBe('focus-1');
    expect(afterPing.lastSeen).toBe(latest?.createdAt);
    const dirView = await derived('ada');
    expect(dirView?.currentFocus).toBe('focus-1');
    expect(dirView?.lastSeen).toBe(latest?.createdAt);
  });

  it('last_seen is DERIVED only — there is NO stored last_seen column and NO schema drift (the on-disk schema is the single events ledger)', async () => {
    // Drive real writes first so the DB is fully migrated and populated.
    await register(da!, { handle: 'ada', currentFocus: 'focus' });
    await recordSeen(da!, 'ada');
    await recordSeen(da!, 'ada');

    // Open a SEPARATE read-only connection to the SAME file to introspect the schema
    // directly (WAL allows a concurrent reader alongside the writer connection).
    const probe = new Database(dbPath, { readonly: true });
    try {
      // (a) The ONLY user table is `events` — no `identities` table, no derived-state
      //     table. (sqlite_* internal tables are excluded.)
      const tables = (
        probe
          .prepare(
            "SELECT type, name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as MasterRow[]
      ).map((t) => t.name);
      expect(tables).toEqual(['events']);

      // (b) The events table has EXACTLY the five append-only columns — and crucially
      //     NO `last_seen` (nor any other derived-state) column.
      const columns = (
        probe.prepare('PRAGMA table_info(events)').all() as ColumnInfo[]
      ).map((c) => c.name);
      expect(columns.sort()).toEqual(
        ['actor', 'created_at', 'payload', 'seq', 'type'].sort(),
      );
      expect(columns).not.toContain('last_seen');

      // (c) No STORED payload smuggles a last_seen either — the identity.seen rows
      //     carry only { handle } on disk (snake_case), proving presence is the
      //     EVENT, not a persisted field. (Belt-and-suspenders against a payload-
      //     level last_seen creeping in.)
      const seenPayloads = (
        probe
          .prepare("SELECT payload FROM events WHERE type = 'identity.seen'")
          .all() as { payload: string }[]
      ).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
      expect(seenPayloads).toHaveLength(2);
      for (const p of seenPayloads) {
        expect(p).toEqual({ handle: 'ada' });
        expect(p).not.toHaveProperty('last_seen');
      }
    } finally {
      probe.close();
    }

    // And the derived last_seen is still correct (computed from the stream), equal
    // to the latest identity.seen created_at — proving it is DERIVED, not stored.
    const adaEvents = (await da!.eventsByActor('ada')).sort(
      (a, b) => a.seq - b.seq,
    );
    const latest = adaEvents[adaEvents.length - 1];
    expect((await derived('ada'))?.lastSeen).toBe(latest?.createdAt);
  });
});

describe('recordSeen append-only retention of a MIXED prior stream + multi-identity isolation (QA, AC #2)', () => {
  it('RETAINS both the prior identity.registered AND identity.focus_updated across N pings (+1 row each, focus stays the updated value, last_seen = latest seen)', async () => {
    // The existing retention test seeds ONLY a registration; this strengthens the
    // append-only priority by proving a pre-existing FOCUS-UPDATED row is ALSO
    // retained unchanged across N subsequent presence pings on the real ledger.
    // After register → focus_updated, N recordSeen calls each add exactly one row,
    // BOTH prior rows survive every call, the derived current_focus stays the
    // updated value (a ping never reverts it), and last_seen equals the latest
    // identity.seen created_at.
    await register(da!, { handle: 'ada', currentFocus: 'focus-0' });
    await da!.append([
      {
        type: 'identity.focus_updated',
        actor: 'ada',
        payload: { handle: 'ada', currentFocus: 'focus-1' },
      },
    ]);
    expect(await totalEvents()).toBe(2); // registration + focus update

    const N = 4;
    let prev = 2;
    for (let i = 1; i <= N; i += 1) {
      const id = await recordSeen(da!, 'ada');
      // Exactly one new row per ping — append-only over a mixed stream.
      const after = await totalEvents();
      expect(after).toBe(prev + 1);
      prev = after;

      // BOTH prior rows are retained unchanged, every call.
      const regs = await da!.eventsByType('identity.registered');
      expect(regs).toHaveLength(1);
      expect((regs[0]?.payload as { currentFocus: string }).currentFocus).toBe(
        'focus-0',
      );
      const updates = await da!.eventsByType('identity.focus_updated');
      expect(updates).toHaveLength(1);
      expect(
        (updates[0]?.payload as { currentFocus: string }).currentFocus,
      ).toBe('focus-1');

      // Derived current_focus is the UPDATED value (the ping did not revert it);
      // last_seen equals the latest identity.seen created_at; created_at pinned.
      const seens = (await da!.eventsByActor('ada'))
        .filter((e) => e.type === 'identity.seen')
        .sort((a, b) => a.seq - b.seq);
      expect(id.currentFocus).toBe('focus-1');
      expect(id.lastSeen).toBe(seens[seens.length - 1]?.createdAt);
    }

    // Final ledger: 1 registration + 1 focus update + N seen.
    expect(await totalEvents()).toBe(2 + N);
    expect(await da!.eventsByType('identity.seen')).toHaveLength(N);
    const dirView = await derived('ada');
    expect(dirView?.currentFocus).toBe('focus-1');
  });

  it('a presence ping for one identity appends NOTHING for, and does not advance, another identity on the real ledger', async () => {
    // Multi-identity isolation over the genuine storage engine (the unit suite pins
    // this against the fake; this is the real-ledger proof). Pinging ada must not
    // touch bob's stream nor its derived last_seen — the "all prior rows retained"
    // guarantee includes OTHER identities' rows.
    await register(da!, { handle: 'ada', currentFocus: 'ada-focus' });
    const bobReg = await register(da!, {
      handle: 'bob',
      currentFocus: 'bob-focus',
    });

    await recordSeen(da!, 'ada');
    await recordSeen(da!, 'ada');

    // ada gained two identity.seen rows; bob's stream is still ONLY its registration.
    expect(await da!.eventsByActor('ada')).toHaveLength(3);
    const bobEvents = await da!.eventsByActor('bob');
    expect(bobEvents).toHaveLength(1);
    expect(bobEvents[0]?.type).toBe('identity.registered');
    // bob's derived presence is untouched — still its own registration time.
    const bobView = await derived('bob');
    expect(bobView?.lastSeen).toBe(bobReg.createdAt);
    expect(bobView?.currentFocus).toBe('bob-focus');
    // No identity.seen row anywhere carries bob as its actor.
    const seenActors = (await da!.eventsByType('identity.seen')).map(
      (e) => e.actor,
    );
    expect(seenActors).toEqual(['ada', 'ada']);
  });
});

describe('recordSeen against an UNREGISTERED handle over the real ledger (QA, AC #1/#2/#3)', () => {
  it('FAILS LOUD (throws) and mints NO phantom directory entry, and writes NO orphan identity.seen — the real ledger is UNCHANGED (guard-before-append)', async () => {
    // Story 3.0 (AC #3) reorders recordSeen to GUARD existence BEFORE appending.
    // End-to-end against real SQLite: recordSeen for a never-registered handle throws
    // its pre-append guard WITHOUT writing anything — no orphan identity.seen lands,
    // no phantom directory entry is minted, and the on-disk ledger stays empty. (Was:
    // the old append-then-throw contract left exactly one orphan ping on disk.)
    await expect(recordSeen(da!, 'ghost')).rejects.toThrow(/not registered/u);

    // NO orphan identity.seen was appended — the unregistered path writes nothing.
    const ghostEvents = await da!.eventsByActor('ghost');
    expect(ghostEvents).toHaveLength(0);
    expect(await da!.eventsByType('identity.seen')).toHaveLength(0);
    expect(await da!.eventsByType('identity.registered')).toHaveLength(0);

    // The directory has NO entry for the unregistered handle (no phantom minted).
    expect(await derived('ghost')).toBe(undefined);
    // The real ledger is entirely unchanged — zero rows written on the throw path.
    expect(await totalEvents()).toBe(0);
  });
});

describe('updateFocus against an UNREGISTERED handle over the real ledger (QA, AC #3/#4)', () => {
  it('FAILS LOUD (throws) and writes NO orphan identity.focus_updated — the real ledger is UNCHANGED (guard-before-append, symmetric with recordSeen)', async () => {
    // Story 3.0 (AC #3/#4) fixes the orphan-append wart as a CLASS via the shared
    // appendIdentityEventOrThrow helper. recordSeen has a real-ledger no-orphan proof
    // (above); this is its SYMMETRIC counterpart for updateFocus over genuine SQLite —
    // the second op delegates to the same guard, but the on-disk assertion is about
    // its OWN event type (identity.focus_updated) not landing. Without this, the
    // class fix is real-ledger-proven for only one of the two ops.
    await expect(updateFocus(da!, 'ghost', 'some focus')).rejects.toThrow(
      /not registered/u,
    );

    // NO orphan identity.focus_updated was appended — the unregistered path writes
    // nothing (was: the old append-then-throw contract left one orphan on disk).
    const ghostEvents = await da!.eventsByActor('ghost');
    expect(ghostEvents).toHaveLength(0);
    expect(await da!.eventsByType('identity.focus_updated')).toHaveLength(0);
    expect(await da!.eventsByType('identity.registered')).toHaveLength(0);

    // No phantom directory entry; the whole on-disk ledger is empty after the throw.
    expect(await derived('ghost')).toBe(undefined);
    expect(await totalEvents()).toBe(0);
  });
});
