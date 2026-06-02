// Current-contract projection unit tests (Story 5.3, Task 1 / AC #1, #2, #3).
//
// Pins the pure query of a room's CURRENT AGREED CONTRACT (FR21): of the room's messages
// (`roomMessages`, which carry their LIVE 👍 `reactions` via Story 5.2), the one with the
// HIGHEST `seq` whose `reactions` is non-empty; `null` if none. No I/O — a pure fold over a
// hand-built, `seq`-ordered Event stream (mirrors room-history.test.ts / reactions.test.ts).
//
// The contract is COMPUTED, never stored (THE APPEND INVARIANT): every call is a fresh query
// over the current live-👍 state. Reversion-on-retract (AC #2) therefore needs NO special
// logic — recomputing after a retraction naturally yields the next-highest live-👍'd message
// (or `null`). There is no stored `contract` flag / column / event.
//
// What is proven here:
//   - no reactions anywhere → `null` (never reacted / a room with messages but no 👍);
//   - one live-👍'd message → that message;
//   - two live-👍'd messages → the HIGHER-`seq` one (most-recent agreement wins);
//   - after the higher loses its last live 👍 → REVERTS to the lower (AC #2);
//   - after the lower also loses it → `null` (AC #2 / AC #3);
//   - a message that was 👍'd then un-👍'd is NOT the contract (latest-react-wins);
//   - a message with one of two reactors retracted is STILL the contract (≥1 live 👍 remains);
//   - cross-room isolation: room A's contract ignores room B's reactions entirely;
//   - the ANNOUNCEMENT (message #1) CAN be the contract when it is the highest-`seq` live-👍'd
//     (incl. a proto-room whose only message — the announcement — holds a live 👍).

import { describe, expect, it } from 'vitest';

import { currentContract } from './contract.js';

import type { Event } from '../events/event.js';

/** Build an announcement.posted Event (mints a proto-room — message #1 of its history). */
function posted(
  seq: number,
  actor: string,
  projectId: string,
  roomId: string,
  subject: string,
  body: string,
): Event {
  return {
    seq,
    type: 'announcement.posted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { projectId, roomId, subject, body },
  };
}

/** Build a room.replied Event (a reply IS a message — kind='reply' in the history). */
function replied(
  seq: number,
  actor: string,
  roomId: string,
  body: string,
): Event {
  return {
    seq,
    type: 'room.replied',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { roomId, body },
  };
}

/** Build a message.reacted Event (a live 👍 on the message at messageSeq, by actor). */
function reacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.reacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

/** Build a message.unreacted Event (retracts actor's 👍 from the message at messageSeq). */
function unreacted(seq: number, actor: string, messageSeq: number): Event {
  return {
    seq,
    type: 'message.unreacted',
    actor,
    createdAt: `2026-05-31T00:00:0${seq}.000Z`,
    payload: { messageSeq },
  };
}

/**
 * A small room with an announcement (#1, seq 1) and one reply (#2, seq 2) on the same room,
 * with no reactions yet. The base most tests extend with reactions. ada announces, bob replies.
 */
function baseRoom(): Event[] {
  return [
    posted(
      1,
      'ada',
      'calling-interface',
      'need-a-reviewer',
      'Need a reviewer',
      'seed',
    ),
    replied(2, 'bob', 'need-a-reviewer', 'on it'),
  ];
}

describe('currentContract — no live 👍 → null (AC #3)', () => {
  it('a room whose messages have NO reactions → null (no contract yet)', () => {
    expect(currentContract(baseRoom(), 'need-a-reviewer')).toBeNull();
  });

  it('an unknown room (no announcement) → null', () => {
    // currentContract does not assert existence (the TOOL does findRoom → ROOM_NOT_FOUND);
    // an unknown room simply has no messages, hence no contract.
    expect(currentContract(baseRoom(), 'no-such-room')).toBeNull();
  });

  it('an empty stream → null', () => {
    expect(currentContract([], 'need-a-reviewer')).toBeNull();
  });
});

describe('currentContract — the highest-seq live-👍’d message (AC #1)', () => {
  it('one live-👍’d message → that message (incl. its body + the live reactors)', () => {
    const events: Event[] = [...baseRoom(), reacted(3, 'cleo', 2)];
    expect(currentContract(events, 'need-a-reviewer')).toEqual({
      seq: 2,
      actor: 'bob',
      body: 'on it',
      kind: 'reply',
      reactions: ['cleo'],
    });
  });

  it('two live-👍’d messages → the HIGHER-seq one (most-recent agreement wins)', () => {
    // Both message #1 (seq 1) and message #2 (seq 2) hold a live 👍; the contract is the
    // higher-seq message (#2), NOT the first-reacted one.
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'cleo', 2), // 👍 the reply (seq 2) first
      reacted(4, 'dan', 1), // then 👍 the announcement (seq 1)
    ];
    const contract = currentContract(events, 'need-a-reviewer');
    expect(contract?.seq).toBe(2);
    expect(contract?.body).toBe('on it');
  });

  it('the contract is the max-seq live-👍’d message even across three messages', () => {
    const events: Event[] = [
      posted(1, 'ada', 'p', 'r', 'S', 'announce'),
      replied(2, 'bob', 'r', 'reply two'),
      replied(3, 'cleo', 'r', 'reply three'),
      reacted(4, 'dan', 1), // 👍 #1
      reacted(5, 'eve', 2), // 👍 #2
      // #3 (seq 3) is NOT reacted → not the contract despite being the latest message.
    ];
    const contract = currentContract(events, 'r');
    expect(contract?.seq).toBe(2); // the highest LIVE-👍'd, not the highest message
    expect(contract?.body).toBe('reply two');
  });
});

describe('currentContract — reversion on retract (AC #2)', () => {
  it('after the higher message loses its LAST live 👍 → reverts to the lower live-👍’d message', () => {
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'dan', 1), // 👍 #1 (announcement)
      reacted(4, 'cleo', 2), // 👍 #2 (reply) — now the contract
      unreacted(5, 'cleo', 2), // retract #2's only 👍 → reverts
    ];
    const contract = currentContract(events, 'need-a-reviewer');
    expect(contract?.seq).toBe(1); // reverted to the announcement (still live-👍'd by dan)
    expect(contract?.kind).toBe('announcement');
  });

  it('after the lower message ALSO loses its 👍 → null (no contract remains)', () => {
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'dan', 1),
      reacted(4, 'cleo', 2),
      unreacted(5, 'cleo', 2), // #2 reverts to #1
      unreacted(6, 'dan', 1), // #1's last 👍 gone too → null
    ];
    expect(currentContract(events, 'need-a-reviewer')).toBeNull();
  });

  it('a message 👍’d then un-👍’d (no other reactors) is NOT the contract (latest-react-wins)', () => {
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'cleo', 2), // 👍 the reply
      unreacted(4, 'cleo', 2), // immediately retract → the reply holds no live 👍
    ];
    expect(currentContract(events, 'need-a-reviewer')).toBeNull();
  });

  it('a message keeps the contract while ≥1 of multiple reactors stays live (one retracts)', () => {
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'cleo', 2), // two reactors on the reply (seq 2)
      reacted(4, 'dan', 2),
      unreacted(5, 'cleo', 2), // cleo retracts, dan still live → still the contract
    ];
    const contract = currentContract(events, 'need-a-reviewer');
    expect(contract?.seq).toBe(2);
    expect(contract?.reactions).toEqual(['dan']); // only the still-live reactor remains
  });

  it('a re-react after a retract re-instates the message as the contract', () => {
    const events: Event[] = [
      ...baseRoom(),
      reacted(3, 'cleo', 2),
      unreacted(4, 'cleo', 2), // contract → null
      reacted(5, 'cleo', 2), // re-react → contract back to the reply (latest event is a react)
    ];
    const contract = currentContract(events, 'need-a-reviewer');
    expect(contract?.seq).toBe(2);
    expect(contract?.reactions).toEqual(['cleo']);
  });
});

describe('currentContract — cross-room isolation (AC #1)', () => {
  it('room A’s contract ignores room B’s reactions entirely', () => {
    // Two rooms interleaved on one stream. A 👍 on B's message must NOT become A's contract,
    // and A's own (unreacted) messages must NOT be shadowed by B's live 👍.
    const events: Event[] = [
      posted(1, 'ada', 'p', 'room-a', 'A', 'A announce'),
      posted(2, 'ada', 'p', 'room-b', 'B', 'B announce'),
      replied(3, 'bob', 'room-a', 'A reply'),
      replied(4, 'cleo', 'room-b', 'B reply'),
      reacted(5, 'dan', 4), // 👍 a message in room B (seq 4) ONLY
    ];
    // Room A has NO live 👍 on any of ITS messages → null (B's 👍 does not leak in).
    expect(currentContract(events, 'room-a')).toBeNull();
    // Room B's contract is its reply (seq 4) — the only live-👍'd message, in B.
    const bContract = currentContract(events, 'room-b');
    expect(bContract?.seq).toBe(4);
    expect(bContract?.body).toBe('B reply');
  });

  it('each room resolves its OWN highest live-👍’d message when BOTH have one', () => {
    const events: Event[] = [
      posted(1, 'ada', 'p', 'room-a', 'A', 'A announce'),
      posted(2, 'ada', 'p', 'room-b', 'B', 'B announce'),
      replied(3, 'bob', 'room-a', 'A reply'),
      replied(4, 'cleo', 'room-b', 'B reply'),
      reacted(5, 'dan', 3), // 👍 A's reply (seq 3)
      reacted(6, 'eve', 4), // 👍 B's reply (seq 4)
    ];
    expect(currentContract(events, 'room-a')?.seq).toBe(3);
    expect(currentContract(events, 'room-b')?.seq).toBe(4);
  });
});

describe('currentContract — the announcement (message #1) can be the contract', () => {
  it('a live-👍’d announcement is the contract when it is the highest-seq live-👍’d message', () => {
    // #1 (seq 1) is reacted; #2 (seq 2) is NOT → the announcement is the contract.
    const events: Event[] = [...baseRoom(), reacted(3, 'cleo', 1)];
    const contract = currentContract(events, 'need-a-reviewer');
    expect(contract?.seq).toBe(1);
    expect(contract?.kind).toBe('announcement');
    expect(contract?.body).toBe('seed');
    expect(contract?.reactions).toEqual(['cleo']);
  });

  it('a PROTO-room whose only message (the announcement) holds a live 👍 → that announcement', () => {
    const events: Event[] = [
      posted(1, 'ada', 'p', 'proto', 'S', 'proto seed'),
      reacted(2, 'bob', 1), // the announcer's own room, a participant 👍s message #1
    ];
    const contract = currentContract(events, 'proto');
    expect(contract).toEqual({
      seq: 1,
      actor: 'ada',
      body: 'proto seed',
      kind: 'announcement',
      reactions: ['bob'],
    });
  });
});

describe('currentContract — order-independence of the input stream', () => {
  it('resolves the max-seq live-👍’d message even when events are NOT seq-sorted', () => {
    // roomMessages sorts by seq, and the reaction fold is seq-comparison based, so an unsorted
    // input must not change the answer (defensive — every DataAccess read is seq-ordered).
    const events: Event[] = [
      reacted(5, 'eve', 2),
      replied(2, 'bob', 'r', 'reply two'),
      reacted(4, 'dan', 1),
      posted(1, 'ada', 'p', 'r', 'S', 'announce'),
      replied(3, 'cleo', 'r', 'reply three'), // not reacted
    ];
    const contract = currentContract(events, 'r');
    expect(contract?.seq).toBe(2); // highest LIVE-👍'd
    expect(contract?.body).toBe('reply two');
  });
});

// --- QA-added (Story 5.3): two FR21 guarantees the dev's suite implies but does not PIN. ---
//   (1) Multi-level (3-deep) downward reversion — the projection's loop must walk DOWN past
//       MULTIPLE now-dead messages, not merely pop one level. The dev's reversion tests only ever
//       step down one live message at a time (the message just below the retracted top is already
//       the next live one), so they never exercise the scan past >1 consecutive dead message.
//   (2) "Highest seq wins, NOT most reactors" — the contract is the max-seq message with ≥1 LIVE
//       👍, where the live-reactor COUNT is irrelevant. The dev's "two live-👍'd → higher seq"
//       cases have exactly one reactor each, so a mistaken popularity metric (most live reactors)
//       would not be caught there. This pins seq-as-tiebreak against reactor count explicitly.
describe('currentContract — multi-level (≥3) reversion walks DOWN past dead messages (AC #2)', () => {
  it('M1,M2,M3 all live-👍’d → M3; retract M3 → M2; retract M2 → M1; retract M1 → null', () => {
    // Three messages in one room, each with its OWN live 👍 (distinct reactors so a retraction of
    // the top message's 👍 cannot accidentally touch a lower message's liveness).
    const base: Event[] = [
      posted(1, 'ada', 'p', 'r', 'S', 'announce body'), // M1 (seq 1)
      replied(2, 'bob', 'r', 'reply two body'), // M2 (seq 2)
      replied(3, 'cleo', 'r', 'reply three body'), // M3 (seq 3)
      reacted(4, 'dan', 1), // 👍 M1
      reacted(5, 'eve', 2), // 👍 M2
      reacted(6, 'fin', 3), // 👍 M3
    ];

    // All three live → the highest-seq message (M3) is the contract.
    expect(currentContract(base, 'r')?.seq).toBe(3);
    expect(currentContract(base, 'r')?.body).toBe('reply three body');

    // Retract M3's only 👍 → step DOWN one level to M2 (M1 is still live but lower-seq).
    const afterM3 = [...base, unreacted(7, 'fin', 3)];
    expect(currentContract(afterM3, 'r')?.seq).toBe(2);
    expect(currentContract(afterM3, 'r')?.body).toBe('reply two body');

    // Retract M2's only 👍 → step DOWN again to M1. With both M3 and M2 now dead, the loop must
    // SKIP PAST two consecutive now-dead messages (seq 3 then seq 2) to reach the live M1 — the
    // multi-level walk the 2-level test never exercises.
    const afterM2 = [...afterM3, unreacted(8, 'eve', 2)];
    expect(currentContract(afterM2, 'r')?.seq).toBe(1);
    expect(currentContract(afterM2, 'r')?.kind).toBe('announcement');
    expect(currentContract(afterM2, 'r')?.body).toBe('announce body');

    // Retract M1's only 👍 → no message holds a live 👍 → null (the bottom of the walk).
    const afterM1 = [...afterM2, unreacted(9, 'dan', 1)];
    expect(currentContract(afterM1, 'r')).toBeNull();
  });
});

describe('currentContract — highest seq wins, NOT most reactors (AC #1, FR21)', () => {
  it('a LOWER-seq message with MANY live 👍s loses to a HIGHER-seq message with ONE live 👍', () => {
    // The lower-seq reply (seq 2) is 👍'd by THREE distinct live reactors; the higher-seq reply
    // (seq 3) is 👍'd by exactly ONE. The contract MUST be seq 3 — the most-recent ratified
    // message — because FR21 is "highest seq holding ≥1 live 👍", NEVER "most live reactors".
    const events: Event[] = [
      posted(1, 'ada', 'p', 'r', 'S', 'announce'),
      replied(2, 'bob', 'r', 'popular but older'), // seq 2 — the crowd-favourite
      replied(3, 'cleo', 'r', 'lonely but newer'), // seq 3 — a single 👍
      reacted(4, 'dan', 2), // 👍 #1 on seq 2
      reacted(5, 'eve', 2), // 👍 #2 on seq 2
      reacted(6, 'gus', 2), // 👍 #3 on seq 2  → seq 2 now has 3 live reactors
      reacted(7, 'hal', 3), // the ONLY 👍 on seq 3
    ];
    const contract = currentContract(events, 'r');
    expect(contract?.seq).toBe(3); // seq, not popularity
    expect(contract?.body).toBe('lonely but newer');
    expect(contract?.reactions).toEqual(['hal']); // exactly the single live reactor
  });

  it('when the higher-seq message’s lone 👍 is retracted, the contract drops to the popular lower-seq one', () => {
    // Same shape, then retract seq 3's only 👍: seq 3 goes dead, so the contract reverts to the
    // 3-reactor seq 2 — confirming the count was never the selector (seq 2 wins now only because
    // it is the highest-seq message STILL holding a live 👍, with all three reactors intact).
    const events: Event[] = [
      posted(1, 'ada', 'p', 'r', 'S', 'announce'),
      replied(2, 'bob', 'r', 'popular but older'),
      replied(3, 'cleo', 'r', 'lonely but newer'),
      reacted(4, 'dan', 2),
      reacted(5, 'eve', 2),
      reacted(6, 'gus', 2),
      reacted(7, 'hal', 3),
      unreacted(8, 'hal', 3), // seq 3's lone 👍 gone → seq 3 dead
    ];
    const contract = currentContract(events, 'r');
    expect(contract?.seq).toBe(2);
    expect(contract?.body).toBe('popular but older');
    expect(contract?.reactions).toEqual(['dan', 'eve', 'gus']); // all three still live, in react order
  });
});
