// Read-query tests (Story 1.6, AC1) — REAL-RUNTIME: a genuine SQLite file in an OS
// temp dir, migrated via the real schema, exercised through the REAL composed
// `createDataAccess` (append from 1.5 + reads from 1.6). This is the append->read
// round-trip the whole ledger depends on and that Story 1.7 will stress
// concurrently, so the single-process read guarantees are pinned here:
//   - reads return `seq`-ordered camelCase Events (never created_at order);
//   - payloads round-trip (snake_case on disk -> camelCase out), snake_case keys
//     confirmed on disk via a raw read and NEVER surfaced to the reader;
//   - eventsSince(k) returns only seq > k; eventsByType/eventsByActor filter
//     correctly and stay seq-ordered; maxSeq() is correct INCLUDING the empty DB.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataAccess, fromConnection } from '../data-access.js';
import { migrate } from './migrate.js';

import type { DataAccessHandle } from '../data-access.js';
import type { EventType, NewEvent } from '@agentbbs/core';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

function fresh(): DataAccessHandle {
  return createDataAccess({ dbPath });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-queries-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
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

/** A mixed, deterministic set of events spanning several types/actors. */
function mixedEvents(): NewEvent[] {
  return [
    {
      type: 'identity.registered',
      actor: 'alice',
      payload: { handle: 'alice', currentFocus: 'shipping 1.6' },
    },
    {
      type: 'project.announced',
      actor: 'alice',
      payload: { projectId: 'agentbbs', title: 'AgentBBS', description: 'd' },
    },
    { type: 'board.joined', actor: 'bob', payload: { projectId: 'agentbbs' } },
    {
      type: 'announcement.posted',
      actor: 'bob',
      payload: { roomId: 'calling-interface', subject: 'Subj', body: 'Body' },
    },
    {
      type: 'room.replied',
      actor: 'alice',
      payload: { roomId: 'calling-interface', body: 'first reply' },
    },
    { type: 'message.reacted', actor: 'bob', payload: { messageSeq: 5 } },
  ];
}

describe('eventsSince — seq-ordered camelCase delta (AC1)', () => {
  it('returns all events from cursor 0 in seq order as camelCase Events', async () => {
    da = fresh();
    const seqs = await da.append(mixedEvents());

    const events = await da.eventsSince(0);

    expect(events.map((e) => e.seq)).toEqual(seqs);
    // Strictly ascending by seq.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
    }
    // camelCase payloads surfaced to core (the first event).
    expect(events[0]!.type).toBe('identity.registered');
    expect(events[0]!.payload).toEqual({
      handle: 'alice',
      currentFocus: 'shipping 1.6',
    });
    // No snake_case key ever reaches the reader.
    for (const e of events) {
      for (const key of Object.keys(e.payload)) {
        expect(key, `key "${key}" on ${e.type}`).not.toMatch(/_/u);
      }
    }
  });

  it('returns ONLY events with seq > cursor', async () => {
    da = fresh();
    const seqs = await da.append(mixedEvents());
    const cutoff = seqs[2]!; // exclude the first three

    const events = await da.eventsSince(cutoff);

    expect(events.length).toBe(seqs.length - 3);
    for (const e of events) {
      expect(e.seq).toBeGreaterThan(cutoff);
    }
    expect(events.map((e) => e.seq)).toEqual(seqs.slice(3));
  });

  it('returns [] when the cursor is at or beyond the max seq', async () => {
    da = fresh();
    const seqs = await da.append(mixedEvents());
    const max = seqs.at(-1)!;
    expect(await da.eventsSince(max)).toEqual([]);
    expect(await da.eventsSince(max + 100)).toEqual([]);
  });
});

describe('eventsByType / eventsByActor — filtered + seq-ordered (AC1)', () => {
  it('filters by type and stays seq-ordered', async () => {
    da = fresh();
    await da.append([
      { type: 'identity.seen', actor: 'alice', payload: { handle: 'alice' } },
      { type: 'identity.seen', actor: 'bob', payload: { handle: 'bob' } },
      {
        type: 'board.joined',
        actor: 'alice',
        payload: { projectId: 'agentbbs' },
      },
      { type: 'identity.seen', actor: 'carol', payload: { handle: 'carol' } },
    ]);

    const seen = await da.eventsByType('identity.seen');
    expect(seen.map((e) => e.actor)).toEqual(['alice', 'bob', 'carol']);
    expect(seen.every((e) => e.type === 'identity.seen')).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.seq).toBeGreaterThan(seen[i - 1]!.seq);
    }
  });

  it('filters by actor and stays seq-ordered', async () => {
    da = fresh();
    await da.append(mixedEvents());

    const aliceEvents = await da.eventsByActor('alice');
    expect(aliceEvents.every((e) => e.actor === 'alice')).toBe(true);
    expect(aliceEvents.map((e) => e.type)).toEqual([
      'identity.registered',
      'project.announced',
      'room.replied',
    ]);
    for (let i = 1; i < aliceEvents.length; i++) {
      expect(aliceEvents[i]!.seq).toBeGreaterThan(aliceEvents[i - 1]!.seq);
    }
  });

  it('returns [] for a type/actor with no events', async () => {
    da = fresh();
    await da.append(mixedEvents());
    expect(await da.eventsByType('message.unreacted')).toEqual([]);
    expect(await da.eventsByActor('nobody')).toEqual([]);
  });
});

describe('maxSeq — highest seq incl. empty ledger (AC1)', () => {
  it('returns 0 on an empty ledger', async () => {
    da = fresh();
    expect(await da.maxSeq()).toBe(0);
  });

  it('returns the highest assigned seq and advances with appends', async () => {
    da = fresh();
    const first = await da.append(mixedEvents());
    expect(await da.maxSeq()).toBe(first.at(-1));

    const more = await da.append([
      { type: 'identity.seen', actor: 'alice', payload: { handle: 'alice' } },
    ]);
    expect(await da.maxSeq()).toBe(more[0]);
    expect(await da.maxSeq()).toBeGreaterThan(first.at(-1)!);
  });
});

describe('round-trip — snake_case on disk only, camelCase out (AC1)', () => {
  it('stores snake_case on disk yet the reader only sees camelCase', async () => {
    da = fresh();
    await da.append([
      {
        type: 'project.announced',
        actor: 'alice',
        payload: { projectId: 'agentbbs', title: 'AgentBBS', description: 'd' },
      },
    ]);

    // RAW read via a separate connection: the on-disk payload is snake_case.
    const raw = new Database(dbPath, { readonly: true });
    try {
      const row = raw
        .prepare('SELECT payload FROM events WHERE seq = 1')
        .get() as { payload: string };
      expect(row.payload).toContain('project_id');
      expect(row.payload).not.toContain('projectId');
    } finally {
      raw.close();
    }

    // Through the seam: camelCase only.
    const [event] = await da.eventsByType('project.announced');
    expect(event!.payload).toEqual({
      projectId: 'agentbbs',
      title: 'AgentBBS',
      description: 'd',
    });
  });
});

describe('ordering is by seq, NEVER created_at (AC1, THE APPEND INVARIANT)', () => {
  // GAP: every other test appends in natural order, where seq and created_at
  // agree, so "ORDER BY seq" and "ORDER BY created_at" would be indistinguishable.
  // Here we INSERT raw rows whose created_at is strictly DESCENDING while seq
  // ascends, then read through the real composed DataAccess. If a query ever
  // ordered by created_at the result would come back reversed — this pins the
  // load-bearing invariant against the real runtime, not just the lint guard.
  it('returns seq-ascending even when created_at is descending vs seq', async () => {
    mkdirSync(dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    try {
      migrate(raw);
      const insert = raw.prepare(
        'INSERT INTO events (type, actor, created_at, payload) VALUES (?, ?, ?, ?)',
      );
      // seq 1,2,3 (assigned in insert order) carry DECREASING timestamps.
      const rows = [
        { actor: 'first', createdAt: '2026-05-30T03:00:00.000Z' },
        { actor: 'second', createdAt: '2026-05-30T02:00:00.000Z' },
        { actor: 'third', createdAt: '2026-05-30T01:00:00.000Z' },
      ];
      for (const r of rows) {
        insert.run(
          'identity.seen',
          r.actor,
          r.createdAt,
          JSON.stringify({ handle: r.actor }),
        );
      }
    } finally {
      raw.close();
    }

    // Read through the real port (a fresh connection over the same file).
    da = fromConnection(new Database(dbPath));

    const since = await da.eventsSince(0);
    // seq order (insert order), NOT created_at order (which would be reversed).
    expect(since.map((e) => e.actor)).toEqual(['first', 'second', 'third']);
    expect(since.map((e) => e.seq)).toEqual([1, 2, 3]);
    // created_at is genuinely descending — proving the two orders differ here.
    expect(since.map((e) => e.createdAt)).toEqual([
      '2026-05-30T03:00:00.000Z',
      '2026-05-30T02:00:00.000Z',
      '2026-05-30T01:00:00.000Z',
    ]);

    // The same holds for the filtered read path.
    const byType = await da.eventsByType('identity.seen');
    expect(byType.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('real-runtime write->read round-trip for ALL 10 event types (AC1)', () => {
  // GAP: the mapping.test.ts all-10 round-trip runs over a SIMULATED row; the
  // real-runtime round-trip here covers only a few types. This drives every one
  // of the 10 closed-vocabulary payloads through the FULL SQLite path
  // (append -> JSON-on-disk -> SELECT -> rowToEvent) and asserts the camelCase
  // payload survives, with snake_case confirmed on disk and never surfaced.
  it('every type round-trips its camelCase payload through real SQLite', async () => {
    da = fresh();

    // One representative NewEvent per type; payloads chosen so the camelCase
    // multi-word keys (currentFocus/projectId/roomId/messageSeq) are exercised.
    const samples: NewEvent[] = [
      {
        type: 'identity.registered',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f' },
      },
      {
        type: 'identity.focus_updated',
        actor: 'a',
        payload: { handle: 'a', currentFocus: 'f2' },
      },
      { type: 'identity.seen', actor: 'a', payload: { handle: 'a' } },
      {
        type: 'project.announced',
        actor: 'a',
        payload: { projectId: 'p', title: 't', description: 'd' },
      },
      { type: 'board.joined', actor: 'a', payload: { projectId: 'p' } },
      {
        type: 'announcement.posted',
        actor: 'a',
        payload: { roomId: 'r', subject: 's', body: 'b' },
      },
      { type: 'room.replied', actor: 'a', payload: { roomId: 'r', body: 'b' } },
      {
        type: 'room.participant_added',
        actor: 'a',
        payload: { roomId: 'r', handle: 'h' },
      },
      { type: 'message.reacted', actor: 'a', payload: { messageSeq: 9 } },
      { type: 'message.unreacted', actor: 'a', payload: { messageSeq: 9 } },
    ];

    const seqs = await da.append(samples);
    expect(seqs).toHaveLength(10);

    const events = await da.eventsSince(0);
    expect(events).toHaveLength(10);

    // Each read-back Event matches its source: type/actor and the EXACT camelCase
    // payload, with no snake_case key ever surfaced through the seam.
    for (let i = 0; i < samples.length; i++) {
      const src = samples[i]!;
      const got = events[i]!;
      expect(got.type).toBe(src.type);
      expect(got.actor).toBe(src.actor);
      expect(got.seq).toBe(seqs[i]);
      expect(got.payload).toEqual(src.payload);
      for (const key of Object.keys(got.payload)) {
        expect(key, `key "${key}" on ${got.type}`).not.toMatch(/_/u);
      }
    }

    // And each type is independently retrievable via the filtered read path,
    // confirming the on-disk JSON is snake_case for the multi-word payloads.
    const raw = new Database(dbPath, { readonly: true });
    try {
      for (const src of samples) {
        const [event] = await da.eventsByType(src.type as EventType);
        expect(event!.type).toBe(src.type);
        expect(event!.payload).toEqual(src.payload);
      }
      // Spot-check disk casing for the multi-word keys.
      const projRow = raw
        .prepare("SELECT payload FROM events WHERE type = 'project.announced'")
        .get() as { payload: string };
      expect(projRow.payload).toContain('project_id');
      expect(projRow.payload).not.toContain('projectId');

      const focusRow = raw
        .prepare(
          "SELECT payload FROM events WHERE type = 'identity.registered'",
        )
        .get() as { payload: string };
      expect(focusRow.payload).toContain('current_focus');
      expect(focusRow.payload).not.toContain('currentFocus');

      const reactRow = raw
        .prepare("SELECT payload FROM events WHERE type = 'message.reacted'")
        .get() as { payload: string };
      expect(reactRow.payload).toContain('message_seq');
      expect(reactRow.payload).not.toContain('messageSeq');
    } finally {
      raw.close();
    }
  });
});
