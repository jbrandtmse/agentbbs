// `postAnnouncement` board-operation tests (Story 4.1, Task 3 / AC #1–#5).
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included —
// from importing @agentbbs/data-access), so these drive `postAnnouncement` against an
// IN-MEMORY DataAccess fake. The fake models the contract the real adapter guarantees
// and this op relies on:
//   - eventsSince(0) replays the whole `seq`-ordered stream (what requireMembership reads);
//   - appendGuarded enforces EVERY guard against the AT-REST (snake_case) payload and on a
//     violation rejects with the stable `code: 'UNIQUENESS_CONFLICT'` discriminant, appending
//     NOTHING — so the disambiguator retry and "nothing appended on the gate path" both hold;
//   - eventsByActor returns that actor's events, seq-ordered (the read-back source).
// The REAL atomic cross-process guarantee is proven by the mcp-server integration test +
// the data-access appendGuarded unit tests; here we pin core's logic: member happy path,
// NOT_A_MEMBER / BOARD_NOT_FOUND (nothing appended), disambiguator on a subject collision,
// empty-subject fallback, and non-uniqueness error propagation.

import { describe, expect, it } from 'vitest';

import { BoardError } from '../errors.js';
import { MAX_BODY_BYTES } from './body-cap.js';
import { postAnnouncement } from './post-announcement.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/** A uniqueness-conflict-shaped rejection, matching the adapter's discriminant. */
class FakeUniquenessConflict extends Error {
  readonly code = 'UNIQUENESS_CONFLICT' as const;
}

/** Project the camelCase payload to the at-rest snake_case shape the guards see. */
function atRest(e: NewEvent): Record<string, unknown> {
  switch (e.type) {
    case 'project.announced':
      return {
        project_id: e.payload.projectId,
        title: e.payload.title,
        description: e.payload.description,
      };
    case 'board.joined':
      return { project_id: e.payload.projectId };
    case 'announcement.posted':
      return {
        project_id: e.payload.projectId,
        room_id: e.payload.roomId,
        subject: e.payload.subject,
        body: e.payload.body,
      };
    default:
      return { ...(e.payload as unknown as Record<string, unknown>) };
  }
}

/**
 * A minimal in-memory DataAccess modeling the bits `postAnnouncement` exercises, seeded
 * with a starting `seq`-ordered stream (the existing board + members). appendGuarded
 * checks ALL guards BEFORE appending ANY event (so a conflict appends nothing) and uses
 * the AT-REST snake_case keys — so a guard on `field: 'room_id'` matches the stored
 * `room_id`. eventsSince/eventsByActor/eventsByType read the store seq-ordered.
 */
function memoryDataAccess(seed: Event[] = []): DataAccess {
  let seq = seed.reduce((m, e) => Math.max(m, e.seq), 0);
  const store: Event[] = [...seed];
  const cursors = new Map<string, number>();

  const appendAll = (events: NewEvent[]): number[] => {
    const createdAt = new Date().toISOString();
    return events.map((e) => {
      seq += 1;
      store.push({ ...e, seq, createdAt } as Event);
      return seq;
    });
  };

  return {
    append: (events) => Promise.resolve(appendAll(events)),
    appendGuarded: (events: NewEvent[], guards: UniquenessGuard[]) => {
      for (const guard of guards) {
        const collides = store.some(
          (e) =>
            e.type === guard.type &&
            atRest(e as unknown as NewEvent)[guard.field] === guard.value,
        );
        if (collides) {
          return Promise.reject(new FakeUniquenessConflict('already exists'));
        }
      }
      return Promise.resolve(appendAll(events));
    },
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

/** A registered identity event. */
function reg(seq: number, handle: string): Event {
  return {
    seq,
    type: 'identity.registered',
    actor: handle,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { handle, currentFocus: 'x' },
  };
}
/** A project.announced event. */
function announced(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'project.announced',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, title: projectId, description: 'desc' },
  };
}
/** A board.joined event. */
function joined(seq: number, actor: string, projectId: string): Event {
  return {
    seq,
    type: 'board.joined',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId },
  };
}

/**
 * Seed: ada announces `calling-interface` (auto-joins); bob joins it; cleo only
 * registers (member of nothing). Mirrors the membership.test ledger.
 */
function ledger(): Event[] {
  return [
    reg(1, 'ada'),
    reg(2, 'bob'),
    reg(3, 'cleo'),
    announced(4, 'ada', 'calling-interface'),
    joined(5, 'ada', 'calling-interface'),
    joined(6, 'bob', 'calling-interface'),
  ];
}

describe('postAnnouncement — member happy path (AC #1)', () => {
  it('appends one announcement.posted (with projectId/roomId/subject/body) and returns the proto-room', async () => {
    const da = memoryDataAccess(ledger());

    const room = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes',
    });

    expect(room).toMatchObject({
      roomId: 'need-a-reviewer',
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes',
      postedBy: 'ada',
      active: false,
    });
    expect(room.seq).toBeGreaterThan(6);

    // Exactly one announcement.posted, correctly attributed + payloaded.
    const posted = await da.eventsByType('announcement.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.actor).toBe('ada');
    expect(posted[0]?.payload).toEqual({
      projectId: 'calling-interface',
      roomId: 'need-a-reviewer',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes',
    });
  });

  it('a joined non-announcer member can post too', async () => {
    const da = memoryDataAccess(ledger());
    const room = await postAnnouncement(da, 'bob', {
      projectId: 'calling-interface',
      subject: 'From Bob',
      body: 'bob posting',
    });
    expect(room.postedBy).toBe('bob');
    expect(room.roomId).toBe('from-bob');
  });
});

describe('postAnnouncement — membership gate (AC #2, #3)', () => {
  it('throws NOT_A_MEMBER for a registered non-member and appends NOTHING', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await postAnnouncement(da, 'cleo', {
      projectId: 'calling-interface',
      subject: 'Sneaky',
      body: 'should be rejected',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');
    // Nothing appended on the gate-rejection path.
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('announcement.posted')).toHaveLength(0);
  });

  it('throws BOARD_NOT_FOUND for an unknown board and appends NOTHING', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();

    const err = await postAnnouncement(da, 'ada', {
      projectId: 'no-such-board',
      subject: 'Orphan',
      body: 'no board',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('BOARD_NOT_FOUND');
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('announcement.posted')).toHaveLength(0);
  });
});

describe('postAnnouncement — disambiguator on subject collision (AC #4)', () => {
  it('two same-subject posts get DISTINCT roomIds (base, then base-2) with no error', async () => {
    const da = memoryDataAccess(ledger());

    const first = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: 'Calling Interface',
      body: 'first',
    });
    const second = await postAnnouncement(da, 'bob', {
      projectId: 'calling-interface',
      subject: 'Calling Interface',
      body: 'second',
    });

    expect(first.roomId).toBe('calling-interface');
    expect(second.roomId).toBe('calling-interface-2');
    expect(first.roomId).not.toBe(second.roomId);

    // Both landed — no lost write; two distinct proto-rooms.
    const posted = await da.eventsByType('announcement.posted');
    expect(posted).toHaveLength(2);
    expect(posted.map((e) => e.payload)).toEqual([
      {
        projectId: 'calling-interface',
        roomId: 'calling-interface',
        subject: 'Calling Interface',
        body: 'first',
      },
      {
        projectId: 'calling-interface',
        roomId: 'calling-interface-2',
        subject: 'Calling Interface',
        body: 'second',
      },
    ]);
  });

  it('a THIRD same-subject post continues the sequence (base-3)', async () => {
    const da = memoryDataAccess(ledger());
    for (const body of ['a', 'b', 'c']) {
      await postAnnouncement(da, 'ada', {
        projectId: 'calling-interface',
        subject: 'Calling Interface',
        body,
      });
    }
    const posted = await da.eventsByType('announcement.posted');
    expect(posted.map((e) => (e.payload as { roomId: string }).roomId)).toEqual(
      ['calling-interface', 'calling-interface-2', 'calling-interface-3'],
    );
  });
});

describe('postAnnouncement — empty-subject fallback (AC #5)', () => {
  it('a subject with no [a-z0-9] still yields a non-empty roomId via the "room" base', async () => {
    const da = memoryDataAccess(ledger());

    const room = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: '!!!',
      body: 'all punctuation subject',
    });

    expect(room.roomId).toBe('room');
    // subject/body are still stored verbatim.
    expect(room.subject).toBe('!!!');
    expect(room.body).toBe('all punctuation subject');

    // A second unsluggable subject disambiguates to room-2.
    const room2 = await postAnnouncement(da, 'bob', {
      projectId: 'calling-interface',
      subject: '???',
      body: 'another',
    });
    expect(room2.roomId).toBe('room-2');
  });
});

describe('postAnnouncement — non-uniqueness error propagation', () => {
  it('lets a non-uniqueness rejection from the port propagate unchanged (not retried, not a BoardError)', async () => {
    const da = memoryDataAccess(ledger());
    const boom = new Error('store busy or some infra fault');
    da.appendGuarded = () => Promise.reject(boom);

    const err = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: 'X',
      body: 'y',
    }).catch((e: unknown) => e);

    expect(err).toBe(boom);
    expect(err).not.toBeInstanceOf(BoardError);
  });
});

describe('postAnnouncement — body-size cap (Story 5.1 / AC #2)', () => {
  it('accepts an announcement body EXACTLY at the 256 KB cap (announcement.posted stored verbatim)', async () => {
    const da = memoryDataAccess(ledger());
    const atCap = 'a'.repeat(MAX_BODY_BYTES); // ASCII → byteLength === MAX_BODY_BYTES

    const room = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: 'Need a reviewer',
      body: atCap,
    });
    expect(room.roomId).toBe('need-a-reviewer');
    expect(room.body).toBe(atCap); // stored verbatim

    const posted = await da.eventsByType('announcement.posted');
    expect(posted).toHaveLength(1);
    expect((posted[0]?.payload as { body: string }).body).toBe(atCap);
  });

  it('throws BODY_TOO_LARGE for a member posting a body ONE byte over the cap and appends NOTHING', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();
    const overCap = 'a'.repeat(MAX_BODY_BYTES + 1);

    // ada IS a member → the gate passes; the cap is what rejects (the member-over-cap path).
    const err = await postAnnouncement(da, 'ada', {
      projectId: 'calling-interface',
      subject: 'Too big',
      body: overCap,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('BODY_TOO_LARGE');
    // Nothing appended on the over-cap path.
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('announcement.posted')).toHaveLength(0);
  });

  it('a NON-member over-cap post is rejected NOT_A_MEMBER (the gate runs BEFORE the cap), nothing appended', async () => {
    const da = memoryDataAccess(ledger());
    const before = await da.maxSeq();
    const overCap = 'a'.repeat(MAX_BODY_BYTES + 1);

    // cleo is NOT a member: the membership gate must reject FIRST (NOT_A_MEMBER), so the
    // size of the body is never reached — precedence the story pins (gate runs first).
    const err = await postAnnouncement(da, 'cleo', {
      projectId: 'calling-interface',
      subject: 'Sneaky and big',
      body: overCap,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('NOT_A_MEMBER');
    expect(await da.maxSeq()).toBe(before);
    expect(await da.eventsByType('announcement.posted')).toHaveLength(0);
  });
});
