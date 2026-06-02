// Tests for the NEEDS YOU derivation (Story 9.4, Task 1 / AC #3).
//
// NEEDS YOU is DETERMINISTIC board state: the rooms an operator was EXPLICITLY pulled
// into via `add_participant(@operator)` — a `room.participant_added` event naming the
// operator handle. It is NEVER time-based: a quiet/old room the operator was never added
// to must NOT appear. These tests pin that semantic.
//
// core depends ONLY on the DataAccess port (the lint forbids core — tests included — from
// importing @agentbbs/data-access), so these drive the real core write ops against an
// IN-MEMORY DataAccess fake (the same pattern as add-participant.test.ts), then assert the
// `needsYouRooms` read derives the right set.

import { describe, expect, it, beforeEach } from 'vitest';

import { register } from '../identity/register.js';
import { announceProject } from '../projects/announce-project.js';
import { postAnnouncement } from './post-announcement.js';
import { reply } from './reply.js';
import { addParticipant } from './add-participant.js';
import { needsYouRooms } from './needs-you.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/**
 * A minimal in-memory DataAccess: `append`/`appendGuarded` stamp a monotonic `seq` +
 * `createdAt`; `appendGuarded` enforces the uniqueness guards (handle / project_id /
 * room_id) the seed write ops rely on; reads return the store `seq`-ordered.
 */
function memoryDataAccess(): DataAccess {
  let seq = 0;
  const store: Event[] = [];

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
    appendGuarded: (events, guards: UniquenessGuard[]) => {
      for (const guard of guards) {
        const clash = store.some(
          (e) =>
            e.type === guard.type &&
            (e.payload as unknown as Record<string, unknown>)[guard.field] ===
              guard.value,
        );
        if (clash) {
          // Mirror the adapter's UniquenessConflictError shape core detects (a `code`
          // of 'UNIQUENESS_CONFLICT'); the seed flow uses unique ids so this never fires.
          const err = new Error(
            `uniqueness conflict on ${guard.field}`,
          ) as Error & {
            code: string;
          };
          err.code = 'UNIQUENESS_CONFLICT';
          throw err;
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
    getCursor: () => Promise.resolve(0),
    setCursor: () => Promise.resolve(),
  };
}

let dataAccess: DataAccess;

beforeEach(async () => {
  dataAccess = memoryDataAccess();
  await register(dataAccess, { handle: 'alice', currentFocus: 'init' });
  await register(dataAccess, { handle: 'bob', currentFocus: 'init' });
  await register(dataAccess, { handle: 'ops', currentFocus: 'watching' });
  await announceProject(dataAccess, 'alice', {
    title: 'Calling Interface',
    description: 'How agents dial in.',
  });
});

describe('needsYouRooms — explicit-escalation-only (AC3)', () => {
  it('returns a room the operator was add_participant-ed into', async () => {
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a decision',
      body: 'Pulling ops in.',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'starting' });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    expect(rooms.map((r) => r.roomId)).toEqual([room.roomId]);
    expect(rooms[0].subject).toBe('Need a decision');
    expect(rooms[0].projectId).toBe('calling-interface');
  });

  it('does NOT include a quiet/old room the operator was never added to', async () => {
    await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Quiet announcement',
      body: 'No one pulled ops in.',
    });
    const active = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Active but not escalated',
      body: 'alice and bob talk; ops is not added.',
    });
    await reply(dataAccess, 'alice', { roomId: active.roomId, body: 'hi' });
    await reply(dataAccess, 'bob', { roomId: active.roomId, body: 'hey' });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    expect(rooms).toEqual([]);
  });

  it('a reply by the operator alone does NOT make a room NEEDS YOU (only an explicit add does)', async () => {
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Ops self-joins',
      body: 'ops replies on its own initiative.',
    });
    await reply(dataAccess, 'ops', { roomId: room.roomId, body: 'I am here' });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    expect(rooms).toEqual([]);
  });

  it('returns [] when the operator handle is null/empty (watching-only posture)', async () => {
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Some room',
      body: 'body',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'x' });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });

    expect(await needsYouRooms(dataAccess, null)).toEqual([]);
    expect(await needsYouRooms(dataAccess, '')).toEqual([]);
  });

  it('returns multiple escalated rooms in seq (announcement) order, not add order', async () => {
    // Two rooms; the operator is added to the LATER-announced one FIRST. The queue must be
    // ordered by the rooms' own `seq` (announcement order), not by the order the adds landed
    // — pinning the `.sort((a, b) => a.seq - b.seq)` comparator (a regression that drops or
    // flips the sort would order by add/insertion order and fail this).
    const first = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Announced first',
      body: 'lower seq',
    });
    await reply(dataAccess, 'alice', { roomId: first.roomId, body: 'x' });
    const second = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Announced second',
      body: 'higher seq',
    });
    await reply(dataAccess, 'alice', { roomId: second.roomId, body: 'y' });

    // Add ops to the SECOND room first, then the FIRST — add order is reversed vs seq order.
    await addParticipant(dataAccess, 'alice', {
      roomId: second.roomId,
      handle: 'ops',
    });
    await addParticipant(dataAccess, 'alice', {
      roomId: first.roomId,
      handle: 'ops',
    });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    // seq-ordered (first announced → second announced), NOT add-ordered (second → first).
    expect(rooms.map((r) => r.roomId)).toEqual([first.roomId, second.roomId]);
    expect(rooms[0].seq).toBeLessThan(rooms[1].seq);
  });

  it('dedups multiple adds of the same operator into one room (one row)', async () => {
    const room = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Double add',
      body: 'body',
    });
    await reply(dataAccess, 'alice', { roomId: room.roomId, body: 'x' });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });
    await addParticipant(dataAccess, 'alice', {
      roomId: room.roomId,
      handle: 'ops',
    });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    expect(rooms.map((r) => r.roomId)).toEqual([room.roomId]);
  });
});
