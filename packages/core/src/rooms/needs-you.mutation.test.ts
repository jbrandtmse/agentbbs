// AC3 mutation-test guard (Story 9.4, Task 4 — Rule 7: prove the marquee semantic is not
// vacuous). The load-bearing semantic of NEEDS YOU is "EXPLICIT-ESCALATION-ONLY, never
// time-based": a room appears in the queue ONLY because an agent ran add_participant(@op),
// and a quiet/old room the operator was never added to must NEVER appear (quiet = healthy,
// EXPERIENCE.md's inversion of the old time-based FR30).
//
// MUTATION-TEST PERFORMED (Rule 7, documented so the next agent need not re-derive it):
// the `needsYouRooms` derivation was temporarily mutated from the explicit-escalation scan
//   if (event.type === 'room.participant_added' && event.payload.handle === operator)
// to a NON-escalation derivation that enrols EVERY announced room regardless of any
// participant-add (a stand-in for a time/age/"every room" inference):
//   if (event.type === 'announcement.posted')
// With that mutation, THIS test went RED (the quiet, never-escalated room wrongly entered
// NEEDS YOU — exactly the failure AC3 forbids: actual `["old-and-quiet","genuinely-needs-
// ops"]` vs expected `["genuinely-needs-ops"]`), proving the assertion discriminates. The
// production code was then restored and the test is green again. A green test that fails on
// a wrong (time-based / every-room) implementation guards the real semantic — not vacuous.
//
// core depends ONLY on the DataAccess port (the lint forbids importing @agentbbs/data-access
// from core, tests included), so this drives the real core write ops against an IN-MEMORY
// DataAccess fake (the add-participant.test.ts pattern).

import { describe, expect, it, beforeEach } from 'vitest';

import { register } from '../identity/register.js';
import { announceProject } from '../projects/announce-project.js';
import { postAnnouncement } from './post-announcement.js';
import { reply } from './reply.js';
import { addParticipant } from './add-participant.js';
import { needsYouRooms } from './needs-you.js';

import type { Event, NewEvent } from '../events/event.js';
import type { DataAccess, UniquenessGuard } from '../ports.js';

/** A minimal in-memory DataAccess (uniqueness-guard-aware) for the seed write ops. */
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
          const err = new Error(`uniqueness conflict`) as Error & {
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

describe('AC3 — NEEDS YOU is explicit-escalation-only, never time-based (mutation-guarded)', () => {
  it('a quiet, OLD, never-escalated room is ABSENT even though escalated rooms exist', async () => {
    // A quiet room announced FIRST (lowest seq = "oldest"), never escalated to ops.
    const quietOld = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Old and quiet',
      body: 'Announced first; ops is never pulled in.',
    });

    // A DIFFERENT room, announced later, where ops IS explicitly add_participant-ed.
    const escalated = await postAnnouncement(dataAccess, 'alice', {
      projectId: 'calling-interface',
      subject: 'Genuinely needs ops',
      body: 'ops is explicitly pulled in here.',
    });
    await reply(dataAccess, 'alice', {
      roomId: escalated.roomId,
      body: 'starting',
    });
    await addParticipant(dataAccess, 'alice', {
      roomId: escalated.roomId,
      handle: 'ops',
    });

    const rooms = await needsYouRooms(dataAccess, 'ops');
    const ids = rooms.map((r) => r.roomId);

    // ONLY the explicitly-escalated room is present. The quiet/old one is absent — the
    // assertion that goes RED under the "every announced room" (non-escalation) mutation.
    expect(ids).toEqual([escalated.roomId]);
    expect(ids).not.toContain(quietOld.roomId);
  });
});
