// `check` discovery-op unit tests (Story 6.1, Task 3 / AC #1–#4).
//
// core depends ONLY on the DataAccess port, so these drive `check` against an IN-MEMORY
// DataAccess fake that models the contract `check` relies on: a `seq`-ordered event store
// (eventsSince(0) replays the whole stream), a Map-backed per-identity cursor
// (getCursor/setCursor round-trip), and append/eventsByActor (so the embedded `recordSeen`
// presence ping works). The real-ledger proof is check.integration.test.ts (the Integration
// AC #5 over a real MCP Client↔server↔SQLite).
//
// Coverage:
//   - first check after joining a board with OLD announcements → NOT flooded (the per-board
//     floor excludes pre-join announcements; AC #4) + cursor advances + last_seen advances;
//   - new in-scope announcement (posted AFTER I joined, after my cursor) → returned + cursor
//     advanced to its seq (AC #1);
//   - new in-scope room message (a reply in a room I participate in) → returned with its
//     roomId + cursor advanced (AC #1);
//   - empty delta (no new activity) → [] / [] and cursor UNCHANGED (AC #2);
//   - out-of-scope: an announcement in a board I'm NOT a member of → NOT returned; a message
//     in a room I do NOT participate in → NOT returned (design decision 5);
//   - the seeding announcement of a room I participate in is NOT double-surfaced as a message
//     (I joined the room after it);
//   - a concurrent message that lands with a HIGHER seq than anything returned is NOT swallowed
//     — the cursor advanced only to maxReturned, so it surfaces on the NEXT check (AC #3);
//   - recordSeen advanced last_seen on every dial-in (presence, AC #1).

import { describe, expect, it } from 'vitest';

import { check } from './check.js';
import { findIdentity, foldIdentities } from '../identity/projection.js';
import {
  MAIN_BOARD_PROJECT_ID,
  PROTOCOL_ROOM_ID,
  seedProtocolAnnouncement,
} from '../seed/protocol-announcement.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess } from '../ports.js';

/**
 * A minimal in-memory DataAccess modeling the bits `check` exercises: a `seq`-ordered event
 * store, a Map-backed per-identity cursor, and a per-append monotonically-advancing clock (so
 * recordSeen's last_seen demonstrably advances). Seeded with a starting `seq`-ordered stream.
 */
function memoryDataAccess(seed: Event[] = []): DataAccess {
  let seq = seed.reduce((m, e) => Math.max(m, e.seq), 0);
  const store: Event[] = [...seed];
  const cursors = new Map<string, number>();
  let tick = 0;
  const clock = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 4, 31, 0, 0, tick)).toISOString();
  };

  const appendAll = (events: NewEvent[]): number[] => {
    const createdAt = clock();
    return events.map((e) => {
      seq += 1;
      store.push({ ...e, seq, createdAt } as Event);
      return seq;
    });
  };

  return {
    append: (events) => Promise.resolve(appendAll(events)),
    appendGuarded: (events) => Promise.resolve(appendAll(events)),
    eventsSince: (cursor) =>
      Promise.resolve(
        store.filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq),
      ),
    eventsByType: (type) =>
      Promise.resolve(
        store.filter((e) => e.type === type).sort((a, b) => a.seq - b.seq),
      ),
    eventsByActor: (actor) =>
      Promise.resolve(
        store.filter((e) => e.actor === actor).sort((a, b) => a.seq - b.seq),
      ),
    maxSeq: () => Promise.resolve(seq),
    getCursor: (handle) => Promise.resolve(cursors.get(handle) ?? 0),
    setCursor: (handle, value) => {
      cursors.set(handle, value);
      return Promise.resolve();
    },
  };
}

// --- Event builders (hand-built, `seq`-ordered streams) ---

function reg(seq: number, handle: string): Event {
  return ev(seq, 'identity.registered', handle, { handle, currentFocus: 'x' });
}
function announced(seq: number, actor: string, projectId: string): Event {
  return ev(seq, 'project.announced', actor, {
    projectId,
    title: projectId,
    description: 'd',
  });
}
function joined(seq: number, actor: string, projectId: string): Event {
  return ev(seq, 'board.joined', actor, { projectId });
}
function posted(
  seq: number,
  actor: string,
  projectId: string,
  roomId: string,
): Event {
  return ev(seq, 'announcement.posted', actor, {
    projectId,
    roomId,
    subject: roomId,
    body: `body-${roomId}`,
  });
}
function replied(seq: number, actor: string, roomId: string): Event {
  return ev(seq, 'room.replied', actor, { roomId, body: `reply-${seq}` });
}

function ev(
  seq: number,
  type: Event['type'],
  actor: string,
  payload: unknown,
): Event {
  // The generic builder casts the whole record to the discriminated `Event` union — the typed
  // wrappers above (reg/announced/joined/posted/replied) pass the correct payload for each
  // `type`, so the at-rest shape is correct; only the compile-time discriminant correlation is
  // bypassed (the same pattern the other core test fakes use for hand-built event streams).
  return {
    seq,
    type,
    actor,
    createdAt: `2026-05-31T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
  } as unknown as Event;
}

describe('check — first dial-in after joining a board with OLD announcements (AC #4)', () => {
  it('does NOT flood me with pre-join announcements; advances my cursor and last_seen', async () => {
    // ada announces board-a (auto-joins seq 5); she posts two OLD announcements (seq 6, 7).
    // THEN bob joins board-a (seq 8) — AFTER those announcements. bob's first check must NOT
    // surface room-1 / room-2 (posted before he joined): his board floor is seq 8.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      announced(3, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'),
      posted(5, 'ada', 'board-a', 'room-1'),
      posted(6, 'ada', 'board-a', 'room-2'),
      joined(7, 'bob', 'board-a'), // bob joins AFTER room-1/room-2 were announced
    ]);

    const before = findIdentity(await da.eventsByActor('bob'), 'bob');
    const result = await check(da, 'bob');

    // No flood: the two pre-join announcements are excluded (floor = bob's join seq 7).
    expect(result.announcements).toEqual([]);
    expect(result.messages).toEqual([]);
    // Empty delta → cursor stays at bob's prior cursor (0). maxReturned = max(0, nothing) = 0.
    expect(result.cursor).toBe(0);
    // UNSEEDED board (no protocol announcement) → first check surfaces NOTHING (robust). The
    // additive `protocol` field is OMITTED, not carried as undefined.
    expect(result.protocol).toBeUndefined();
    expect('protocol' in result).toBe(false);

    // Presence advanced: recordSeen appended an identity.seen, so last_seen moved forward.
    const after = findIdentity(await da.eventsByActor('bob'), 'bob');
    expect(after?.lastSeen).toBeDefined();
    expect(after?.lastSeen).not.toBe(before?.lastSeen);
  });
});

describe('check — new in-scope announcement (AC #1)', () => {
  it('returns a NEW announcement posted after I joined and advances the cursor to its seq', async () => {
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      announced(3, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'),
      joined(5, 'bob', 'board-a'), // bob is a member from seq 5
    ]);
    // A new announcement lands AFTER bob joined (seq 6).
    await da.append([
      {
        type: 'announcement.posted',
        actor: 'ada',
        payload: {
          projectId: 'board-a',
          roomId: 'fresh-topic',
          subject: 'fresh-topic',
          body: 'b',
        },
      },
    ]);

    const result = await check(da, 'bob');

    expect(result.announcements.map((r) => r.roomId)).toEqual(['fresh-topic']);
    expect(result.messages).toEqual([]);
    // Cursor advanced to the announcement's seq (6) — maxReturned, not maxSeq.
    expect(result.cursor).toBe(6);
  });
});

describe('check — new in-scope room message (AC #1)', () => {
  it('returns a NEW reply in a room I participate in, carrying its roomId', async () => {
    // ada announces board-a + room-1; bob replies to room-1 (becomes a participant at seq 6).
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      announced(3, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'),
      posted(5, 'ada', 'board-a', 'room-1'),
      replied(6, 'bob', 'room-1'), // bob's first reply → participant, board floor seq 6 (auto-join not modeled here)
    ]);
    // bob's first check establishes his cursor (advances past his own reply) AND appends his
    // own identity.seen presence ping (seq 7), so the NEXT appended event is seq 8.
    await check(da, 'bob');
    // ada replies AFTER bob's check → seq 8 (seq 7 was bob's recordSeen ping).
    await da.append([
      {
        type: 'room.replied',
        actor: 'ada',
        payload: { roomId: 'room-1', body: 'later' },
      },
    ]);

    const result = await check(da, 'bob');

    // ada's later reply (seq 8) is new for bob (he participates in room-1), carrying roomId.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      seq: 8,
      actor: 'ada',
      roomId: 'room-1',
      kind: 'reply',
    });
    expect(result.cursor).toBe(8);
  });
});

describe('check — empty delta leaves the cursor unchanged (AC #2)', () => {
  it('a second check with no new activity returns [] / [] and the SAME cursor', async () => {
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      announced(3, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'),
      joined(5, 'bob', 'board-a'),
      posted(6, 'ada', 'board-a', 'room-1'), // new for bob on the FIRST check
    ]);

    const first = await check(da, 'bob');
    expect(first.announcements.map((r) => r.roomId)).toEqual(['room-1']);
    expect(first.cursor).toBe(6);

    // No new activity between the two checks (recordSeen's identity.seen is out of scope —
    // it is not an announcement or a room message, and is bob's own actor anyway).
    const second = await check(da, 'bob');
    expect(second.announcements).toEqual([]);
    expect(second.messages).toEqual([]);
    expect(second.cursor).toBe(6); // UNCHANGED
  });
});

describe('check — out-of-scope items are NOT returned (design decision 5)', () => {
  it('excludes an announcement in a board I am NOT a member of', async () => {
    // bob is a member of board-a only; cleo announces board-b and posts there.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      reg(3, 'cleo'),
      announced(4, 'ada', 'board-a'),
      joined(5, 'ada', 'board-a'),
      joined(6, 'bob', 'board-a'),
      announced(7, 'cleo', 'board-b'),
      joined(8, 'cleo', 'board-b'),
      posted(9, 'cleo', 'board-b', 'other-room'), // board-b is out of bob's scope
    ]);

    const result = await check(da, 'bob');

    // bob sees nothing: board-b is not his, and he participates in no rooms.
    expect(result.announcements).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe(0);
  });

  it('excludes a message in a room I do NOT participate in', async () => {
    // bob is a member of board-a (so he'd see its announcements) but does NOT participate in
    // room-1 (he never replied / was never added). ada + cleo negotiate in room-1.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      reg(3, 'cleo'),
      announced(4, 'ada', 'board-a'),
      joined(5, 'ada', 'board-a'),
      joined(6, 'bob', 'board-a'),
      posted(7, 'ada', 'board-a', 'room-1'), // announced AFTER bob joined → IS in his announcement scope
      replied(8, 'cleo', 'room-1'), // cleo participates; bob does NOT
      replied(9, 'ada', 'room-1'),
    ]);

    const result = await check(da, 'bob');

    // The announcement room-1 (seq 7) IS new to bob as a board member.
    expect(result.announcements.map((r) => r.roomId)).toEqual(['room-1']);
    // But the replies (seq 8, 9) are NOT — bob does not participate in room-1.
    expect(result.messages).toEqual([]);
    // maxReturned = the announcement seq (7), NOT the higher reply seqs (8/9) he can't see.
    expect(result.cursor).toBe(7);
  });
});

describe('check — the seeding announcement is not double-surfaced as a message', () => {
  it('a participant does NOT receive the room’s announcement (message #1) in the messages delta', async () => {
    // ada announces room-1 (seq 5); bob replies (seq 6) → participant. bob's roomJoinSeq is 6,
    // so the announcement (seq 5 < 6) is below his room floor and excluded from messages.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      announced(3, 'ada', 'board-a'),
      joined(4, 'ada', 'board-a'),
      posted(5, 'ada', 'board-a', 'room-1'),
      joined(6, 'bob', 'board-a'),
      replied(7, 'bob', 'room-1'), // bob joins room-1 at seq 7
      replied(8, 'ada', 'room-1'), // a later reply — new for bob
    ]);

    const result = await check(da, 'bob');

    // Only ada's later reply (seq 8) surfaces as a message — NOT the announcement (#1, seq 5)
    // and NOT bob's own joining reply (seq 7, == floor, strict >).
    expect(result.messages.map((m) => m.seq)).toEqual([8]);
    expect(result.messages.every((m) => m.kind === 'reply')).toBe(true);
  });
});

describe('check — concurrent higher-seq event is NOT swallowed (AC #3)', () => {
  it('advances the cursor only to maxReturned (< maxSeq), so a concurrent higher-seq in-scope event surfaces next check', async () => {
    // bob participates in room-1 (replied at seq 8). SEPARATELY, cleo+ada negotiate in room-2
    // (bob is NOT a participant) — these land at HIGHER seqs (9, 10). At bob's first check the
    // ledger maxSeq is well above what is IN bob's scope, so the cursor must advance ONLY to
    // bob's returned max, NOT to maxSeq — else a future in-scope room-1 reply that lands BELOW
    // the global max would be swallowed.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      reg(2, 'bob'),
      reg(3, 'cleo'),
      announced(4, 'ada', 'board-a'),
      joined(5, 'ada', 'board-a'),
      posted(6, 'ada', 'board-a', 'room-1'),
      posted(7, 'ada', 'board-a', 'room-2'),
      replied(8, 'bob', 'room-1'), // bob participates in room-1 (floor seq 8)
      replied(9, 'cleo', 'room-2'), // out of bob's scope, HIGHER seq
      replied(10, 'ada', 'room-2'), // out of bob's scope, HIGHER seq
    ]);

    const first = await check(da, 'bob');
    // bob's first check returns nothing new (his only room-1 content is his own joining reply,
    // seq 8, which is at his floor — strict >). maxReturned stays at his prior cursor 0…
    expect(first.messages).toEqual([]);
    expect(first.cursor).toBe(0);
    // …but the ledger maxSeq is far higher (cleo/ada's room-2 replies + bob's own recordSeen
    // ping). Proves the cursor is maxReturned, NOT maxSeq.
    expect(await da.maxSeq()).toBeGreaterThan(first.cursor);

    // A concurrent reply now lands in room-1 (bob's room). Its seq is the new max, but crucially
    // it is > bob's cursor (0), so it is NOT swallowed — it surfaces on bob's next check.
    await da.append([
      {
        type: 'room.replied',
        actor: 'ada',
        payload: { roomId: 'room-1', body: 'concurrent' },
      },
    ]);
    const concurrentSeq = await da.maxSeq();
    const second = await check(da, 'bob');

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toMatchObject({
      roomId: 'room-1',
      actor: 'ada',
    });
    expect(second.messages[0]?.seq).toBe(concurrentSeq);
    expect(second.cursor).toBe(concurrentSeq);
  });
});

describe('check — presence (recordSeen) advances last_seen on every dial-in (AC #1)', () => {
  it('appends an identity.seen each call so last_seen moves forward', async () => {
    const da = memoryDataAccess([reg(1, 'ada')]);

    await check(da, 'ada');
    const afterFirst = foldIdentities(await da.eventsSince(0)).get('ada');
    await check(da, 'ada');
    const afterSecond = foldIdentities(await da.eventsSince(0)).get('ada');

    expect(afterFirst?.lastSeen).toBeDefined();
    expect(afterSecond?.lastSeen).toBeDefined();
    // The second dial-in's last_seen is strictly later (the clock advances per append).
    expect(afterSecond?.lastSeen).not.toBe(afterFirst?.lastSeen);
    // Exactly two identity.seen events were appended (one per check).
    const seens = (await da.eventsSince(0)).filter(
      (e) => e.type === 'identity.seen',
    );
    expect(seens).toHaveLength(2);
  });
});

describe('check — first-check protocol surface (Story 7.2 / AC #3)', () => {
  it('surfaces the seeded protocol on the FIRST check, even though it predates the actor’s join floor', async () => {
    // Seed the protocol FIRST (so its announcement.posted sits at a LOW seq), then a fresh
    // identity registers and joins a board AFTER it — so the protocol is below every floor the
    // actor has and would never surface via the scoped delta. It must STILL surface on first check.
    const da = memoryDataAccess();
    await seedProtocolAnnouncement(da); // protocol announcement now at a low seq
    await da.append([
      {
        type: 'identity.registered',
        actor: 'ada',
        payload: { handle: 'ada', currentFocus: 'x' },
      },
    ]);

    const first = await check(da, 'ada');

    // The protocol is surfaced on the first check — regardless of floors/cursor.
    expect(first.protocol).toBeDefined();
    expect(first.protocol?.roomId).toBe(PROTOCOL_ROOM_ID);
    expect(first.protocol?.projectId).toBe(MAIN_BOARD_PROJECT_ID);
    // It is ADDITIVE — NOT injected into the scoped delta, and does NOT advance the cursor (the
    // actor is a member of no board and participates in no room, so the delta is empty and the
    // cursor stays at her prior 0; the low-seq protocol announcement does not move it).
    expect(first.announcements).toEqual([]);
    expect(first.messages).toEqual([]);
    expect(first.cursor).toBe(0);
  });

  it('does NOT re-surface the protocol on a SUBSEQUENT check (the actor now has an identity.seen)', async () => {
    const da = memoryDataAccess();
    await seedProtocolAnnouncement(da);
    await da.append([
      {
        type: 'identity.registered',
        actor: 'ada',
        payload: { handle: 'ada', currentFocus: 'x' },
      },
    ]);

    const first = await check(da, 'ada');
    expect(first.protocol).toBeDefined(); // surfaced once

    const second = await check(da, 'ada');
    // Not re-surfaced — the actor's first check appended an identity.seen, so this is not a
    // first-check; the additive field is OMITTED.
    expect(second.protocol).toBeUndefined();
    expect('protocol' in second).toBe(false);
  });

  it('surfaces NOTHING on a first check of an UNSEEDED board (robust)', async () => {
    const da = memoryDataAccess([reg(1, 'ada')]);

    const result = await check(da, 'ada');

    expect(result.protocol).toBeUndefined();
    expect('protocol' in result).toBe(false);
  });

  it('surfaces the protocol independently per identity (each agent meets it on THEIR first check)', async () => {
    const da = memoryDataAccess();
    await seedProtocolAnnouncement(da);
    await da.append([
      {
        type: 'identity.registered',
        actor: 'ada',
        payload: { handle: 'ada', currentFocus: 'x' },
      },
      {
        type: 'identity.registered',
        actor: 'bob',
        payload: { handle: 'bob', currentFocus: 'y' },
      },
    ]);

    // ada checks first (surfaced), then again (not). bob's FIRST check still surfaces it — ada's
    // identity.seen does not consume bob's first-check.
    expect((await check(da, 'ada')).protocol).toBeDefined();
    expect((await check(da, 'ada')).protocol).toBeUndefined();
    expect((await check(da, 'bob')).protocol).toBeDefined();
  });

  it('surfaces on a first check even when the actor REGISTERED + JOINED a board BEFORE the protocol was seeded (floor/cursor-independent, the late-bootstrap ordering)', async () => {
    // The REVERSE of the "seed first, join after" case above: here the actor establishes her
    // board membership FIRST (so she holds a board join floor at a LOW seq), and the protocol is
    // seeded AFTER — so its announcement sits at a HIGHER seq than her floor and her prior cursor.
    // The surfacing is detected by "no prior identity.seen", NOT by any floor/cursor, so it must
    // STILL surface on her first check (and a DIFFERENT identity's first check too) — proving the
    // surface is genuinely per-identity and floor/cursor-independent in BOTH orderings.
    const da = memoryDataAccess([
      reg(1, 'ada'),
      announced(2, 'ada', 'board-a'), // ada announces + auto-joins board-a (her board floor)
      joined(3, 'ada', 'board-a'),
      posted(4, 'ada', 'board-a', 'kickoff'), // an in-scope announcement she will ALSO see
    ]);
    // The protocol is seeded LATER (at higher seqs than ada's join floor 3 and her cursor 0).
    await seedProtocolAnnouncement(da);
    const seededAt = await da.maxSeq();
    expect(seededAt).toBeGreaterThan(3); // the protocol announcement is ABOVE ada's board floor

    // A SECOND identity registers AFTER the seed too (its first check must also surface it).
    await da.append([
      {
        type: 'identity.registered',
        actor: 'bob',
        payload: { handle: 'bob', currentFocus: 'y' },
      },
    ]);

    const first = await check(da, 'ada');

    // The protocol surfaces on ada's first check despite being seeded AFTER she joined — the
    // detection is "no prior identity.seen", not a floor/cursor comparison.
    expect(first.protocol).toBeDefined();
    expect(first.protocol?.roomId).toBe(PROTOCOL_ROOM_ID);
    expect(first.protocol?.projectId).toBe(MAIN_BOARD_PROJECT_ID);
    // It is ADDITIVE: the protocol (on the reserved `main` board, which ada is NOT a member of)
    // is NOT injected into her scoped `announcements` — only HER board-a announcement is — and it
    // does NOT advance the cursor past her real in-scope delta. Her cursor reflects the kickoff
    // announcement (seq 4), NOT the higher-seq protocol announcement.
    expect(first.announcements.map((r) => r.roomId)).toEqual(['kickoff']);
    expect(first.announcements.map((r) => r.roomId)).not.toContain(
      PROTOCOL_ROOM_ID,
    );
    expect(first.cursor).toBe(4);
    expect(first.cursor).toBeLessThan(seededAt); // the protocol announcement did not move it

    // Subsequent check: not re-surfaced (ada now has an identity.seen).
    expect((await check(da, 'ada')).protocol).toBeUndefined();
    // A different identity that registered AFTER the seed STILL meets it on ITS first check.
    expect((await check(da, 'bob')).protocol).toBeDefined();
  });
});
