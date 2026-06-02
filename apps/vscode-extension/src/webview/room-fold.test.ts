// Webview live-fold reducer + optimistic-echo tests (Story 10.6, AC1).
//
// Node tier (no DOM): the pure CAMELCASE fold reducer over a RoomViewModel — the VS Code analogue of
// apps/web's foldRoomDelta tests, keyed on the RAW CORE Event shape the host bridge pushes (camelCase
// payload.roomId/messageSeq/body, top-level actor/seq/type) rather than the web's snake_case wire.
// Discoverable by ROOT `pnpm test` (co-located .test.ts → node project; Rule 8).
//
// MUTATION-TESTED (Rule 7): the marquee semantics — (a) the agreed-mark MOVES to the highest-seq
// live-👍'd post (FR21), and (b) the delta de-dup/idempotent re-fold — each carry a comment marking
// the production line a wrong implementation would break; the asserting test goes RED on the mutation.

import { describe, expect, it } from 'vitest';

import {
  appendPendingPost,
  deriveAgreedSeq,
  foldRoomDelta,
  makePendingPost,
  markPendingPostFailed,
  reconcileReread,
  removePendingPost,
  type DeltaEvent,
} from './room-fold.js';

import type { MessagePostModel, RoomViewModel } from '@agentbbs/ui-shared';

/** A baseline open-room model: the announcement (#5) + one reply (#7), operator is a peer. */
function baseModel(): RoomViewModel {
  const messages: MessagePostModel[] = [
    {
      seq: 5,
      actor: 'alice',
      body: 'Should we use REST?',
      kind: 'announcement',
      reactions: [],
    },
    {
      seq: 7,
      actor: 'bob',
      body: 'gRPC is faster',
      kind: 'reply',
      reactions: [],
    },
  ];
  return {
    roomId: 'calling-interface',
    projectId: 'acme',
    subject: 'Calling interface',
    participants: ['alice', 'bob'],
    messages,
    operatorPosture: { kind: 'peer', handle: 'operator' },
    agreedSeq: null,
    operatorHandle: 'operator',
  };
}

/** A raw camelCase core-event delta entry (the host bridge pushes these as `unknown`). */
function ev(
  partial: Partial<DeltaEvent> & { type: string; seq: number },
): DeltaEvent {
  return {
    actor: 'someone',
    createdAt: '2026-06-02T00:00:00.000Z',
    payload: {},
    ...partial,
  };
}

describe('foldRoomDelta — room.replied append (AC1)', () => {
  it('appends a new reply (camelCase payload.roomId/body) in seq order, NEW model (immutable)', () => {
    const m = baseModel();
    const next = foldRoomDelta(
      m,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'carol',
        payload: { roomId: 'calling-interface', body: 'I disagree' },
      }),
    );
    expect(next).not.toBe(m); // immutable — a new model
    expect(m.messages).toHaveLength(2); // prior untouched
    expect(next.messages.map((p) => p.seq)).toEqual([5, 7, 9]);
    expect(next.messages[2]).toMatchObject({
      actor: 'carol',
      body: 'I disagree',
      kind: 'reply',
    });
  });

  it('an announcement.posted folds as an announcement-kind post', () => {
    const m = baseModel();
    const next = foldRoomDelta(
      m,
      ev({
        type: 'announcement.posted',
        seq: 9,
        actor: 'alice',
        payload: { roomId: 'calling-interface', body: 'New topic' },
      }),
    );
    expect(next.messages[2]).toMatchObject({
      kind: 'announcement',
      body: 'New topic',
    });
  });

  it('a delta for a DIFFERENT room is a no-op (same reference)', () => {
    const m = baseModel();
    const next = foldRoomDelta(
      m,
      ev({
        type: 'room.replied',
        seq: 9,
        payload: { roomId: 'other-room', body: 'nope' },
      }),
    );
    expect(next).toBe(m);
  });

  it('an unhandled type / malformed frame is a no-op (never throws)', () => {
    const m = baseModel();
    expect(
      foldRoomDelta(m, ev({ type: 'identity.seen', seq: 9, payload: {} })),
    ).toBe(m);
    expect(foldRoomDelta(m, null)).toBe(m);
    expect(foldRoomDelta(m, { seq: 'bad' })).toBe(m);
  });
});

describe('foldRoomDelta — IDEMPOTENT re-fold / de-dup (AC1, Rule 7 marquee)', () => {
  it('a delta whose seq is already present (confirmed) does NOT double-append', () => {
    const m = baseModel();
    // Fold seq 9 once.
    const once = foldRoomDelta(
      m,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'carol',
        payload: { roomId: 'calling-interface', body: 'I disagree' },
      }),
    );
    expect(once.messages.map((p) => p.seq)).toEqual([5, 7, 9]);
    // Re-fold the SAME seq (a re-poll / redelivery) — IDEMPOTENT, no duplicate.
    // MUTATION (Rule 7): deleting the `model.messages.some(...seq === event.seq...)` guard in
    // foldReplied makes this RED (the thread becomes [5,7,9,9]).
    const twice = foldRoomDelta(
      once,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'carol',
        payload: { roomId: 'calling-interface', body: 'I disagree' },
      }),
    );
    expect(twice).toBe(once); // no-op, same reference
    expect(twice.messages.map((p) => p.seq)).toEqual([5, 7, 9]);
  });
});

describe('foldRoomDelta — reactions + agreed-mark MOVES (AC1, FR21, Rule 7 marquee)', () => {
  it('message.reacted adds the actor + the agreed mark MOVES to the highest-seq live-👍 post', () => {
    const m = baseModel();
    // 👍 on the LOWER-seq announcement (#5) first → agreed = 5.
    const r5 = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 100,
        actor: 'bob',
        payload: { messageSeq: 5 },
      }),
    );
    expect(r5.messages[0]?.reactions).toContain('bob');
    expect(r5.agreedSeq).toBe(5);
    // 👍 on the HIGHER-seq reply (#7) → the mark MOVES UP to 7 (highest-seq live-👍'd, NOT most reactors).
    // MUTATION (Rule 7): changing deriveAgreedSeq to pick "most reactors" (or `m.seq < agreed`) makes
    // this assertion RED — #5 has the same single reactor, so a most-reactors/min-seq selector would
    // stay at 5 instead of moving to 7.
    const r7 = foldRoomDelta(
      r5,
      ev({
        type: 'message.reacted',
        seq: 101,
        actor: 'carol',
        payload: { messageSeq: 7 },
      }),
    );
    expect(r7.agreedSeq).toBe(7);
  });

  it('message.unreacted removes the actor + the agreed mark REVERTS to the next-highest live-👍 post', () => {
    let m = baseModel();
    m = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 100,
        actor: 'bob',
        payload: { messageSeq: 5 },
      }),
    );
    m = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 101,
        actor: 'carol',
        payload: { messageSeq: 7 },
      }),
    );
    expect(m.agreedSeq).toBe(7);
    // Retract the 👍 on #7 → the mark REVERTS to #5 (the next-highest still holding a live 👍).
    const reverted = foldRoomDelta(
      m,
      ev({
        type: 'message.unreacted',
        seq: 102,
        actor: 'carol',
        payload: { messageSeq: 7 },
      }),
    );
    expect(reverted.messages[1]?.reactions).not.toContain('carol');
    expect(reverted.agreedSeq).toBe(5);
  });

  it('a redundant reaction (already-reacted) is a no-op (same reference, no count drift)', () => {
    let m = baseModel();
    m = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 100,
        actor: 'bob',
        payload: { messageSeq: 5 },
      }),
    );
    const again = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 101,
        actor: 'bob',
        payload: { messageSeq: 5 },
      }),
    );
    expect(again).toBe(m);
  });
});

// =============================================================================
// QA seam coverage (Story 10.6, AC1) — the SEAMS the dev's happy-path fold tests do not pin:
// out-of-order delta arrival (a higher seq then a lower one), a reaction netting to ZERO live 👍
// (the agreed mark must DISAPPEAR, not just step down), a reaction for a NOT-YET-PRESENT target
// (an out-of-order reaction-before-its-message), and the FOLD-PATH concurrent-pending survival
// (distinct from the reconcileReread re-read path the dev covered). All are pure-reducer assertions.
// =============================================================================

describe('foldRoomDelta — OUT-OF-ORDER delta arrival (QA seam, AC1)', () => {
  it('a HIGHER-seq delta then a LOWER-seq delta: BOTH fold (the reducer is order-agnostic; seq is the order key, not arrival order)', () => {
    const m = baseModel();
    // The higher seq (#11) arrives FIRST (e.g. the poll batched it ahead).
    const afterHigh = foldRoomDelta(
      m,
      ev({
        type: 'room.replied',
        seq: 11,
        actor: 'carol',
        payload: { roomId: 'calling-interface', body: 'late but higher' },
      }),
    );
    // Then a LOWER seq (#9) arrives (it was appended to the ledger earlier but delivered after).
    const afterLow = foldRoomDelta(
      afterHigh,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'dave',
        payload: { roomId: 'calling-interface', body: 'earlier but lower' },
      }),
    );
    // BOTH are present (neither is dropped); the render layer (MessageThread) sorts by seq, so the
    // reducer need not — but it must not LOSE the lower-seq message just because a higher one landed.
    const seqs = afterLow.messages.map((p) => p.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([5, 7, 9, 11]);
    expect(afterLow.messages.find((p) => p.seq === 9)?.body).toBe(
      'earlier but lower',
    );
  });
});

describe('foldRoomDelta — reaction NETS TO ZERO → agreed mark DISAPPEARS (QA seam, FR21)', () => {
  it('the LAST live 👍 retracted reverts the agreed mark to null (the contract is dropped, not stepped down)', () => {
    let m = baseModel();
    // A single 👍 on #7 → agreed = 7.
    m = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 100,
        actor: 'bob',
        payload: { messageSeq: 7 },
      }),
    );
    expect(m.agreedSeq).toBe(7);
    // Retract the ONLY live 👍 → NO message holds a live 👍 → the agreed mark must DISAPPEAR (null),
    // not stay at 7 and not fall back to a non-existent next-highest.
    const cleared = foldRoomDelta(
      m,
      ev({
        type: 'message.unreacted',
        seq: 101,
        actor: 'bob',
        payload: { messageSeq: 7 },
      }),
    );
    expect(cleared.messages[1]?.reactions).not.toContain('bob');
    expect(cleared.agreedSeq).toBeNull();
  });
});

describe('foldRoomDelta — reaction for a NOT-YET-PRESENT message seq (QA seam, out-of-order)', () => {
  it('a message.reacted whose targetSeq is not in the thread is a SAFE no-op (same reference, no throw)', () => {
    const m = baseModel();
    // A reaction delta for seq #99 — its room.replied has not folded yet (out-of-order delivery).
    const next = foldRoomDelta(
      m,
      ev({
        type: 'message.reacted',
        seq: 200,
        actor: 'carol',
        payload: { messageSeq: 99 },
      }),
    );
    // No matching message → nothing changes; the agreed mark is untouched; same reference.
    expect(next).toBe(m);
    expect(next.agreedSeq).toBeNull();
  });
});

describe('foldRoomDelta — FOLD-PATH concurrent pending survival (QA seam, AC1)', () => {
  it('a folded confirmed delta reconciles ONLY the matching echo; a DIFFERENT in-flight pending survives', () => {
    const m = baseModel();
    // Two concurrent operator sends in flight (distinct bodies, distinct tokens).
    const echoA = makePendingPost('operator', 'decision A', 'tok-A');
    const echoB = makePendingPost('operator', 'decision B', 'tok-B');
    const withBoth = appendPendingPost(appendPendingPost(m, echoA), echoB);
    expect(withBoth.messages.filter((p) => p.pending === true)).toHaveLength(2);

    // Only A's confirmed reply arrives via the delta poll (same actor + body) → replace echo A only.
    const reconciled = foldRoomDelta(
      withBoth,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'operator',
        payload: { roomId: 'calling-interface', body: 'decision A' },
      }),
    );
    // A reconciled to the confirmed post (no longer pending); B is still in flight (untouched).
    const a = reconciled.messages.find((p) => p.body === 'decision A');
    const b = reconciled.messages.find((p) => p.body === 'decision B');
    expect(a).toMatchObject({ seq: 9 });
    expect(a?.pending).toBeUndefined();
    expect(b).toMatchObject({ pending: true, clientToken: 'tok-B' });
    // Exactly one 'decision A' (no duplicate echo+confirmed).
    expect(
      reconciled.messages.filter((p) => p.body === 'decision A'),
    ).toHaveLength(1);
  });
});

describe('deriveAgreedSeq — FR21 selection (Rule 7 marquee)', () => {
  it('picks the HIGHEST-seq message holding a live 👍 (not the most-reacted)', () => {
    const messages: MessagePostModel[] = [
      {
        seq: 5,
        actor: 'a',
        body: '',
        kind: 'announcement',
        reactions: ['x', 'y', 'z'],
      }, // 3 reactors
      { seq: 7, actor: 'b', body: '', kind: 'reply', reactions: ['x'] }, // 1 reactor, higher seq
    ];
    // MUTATION (Rule 7): a "most reactors wins" selector would return 5; the correct FR21 selector
    // returns 7 (highest seq with ANY live 👍).
    expect(deriveAgreedSeq(messages)).toBe(7);
  });

  it('ignores optimistic (pending/failed) echoes and returns null when no live 👍', () => {
    const messages: MessagePostModel[] = [
      { seq: 5, actor: 'a', body: '', kind: 'announcement', reactions: [] },
      {
        seq: 1e15 + 1,
        actor: 'op',
        body: 'sending',
        kind: 'reply',
        reactions: ['op'],
        pending: true,
      },
    ];
    expect(deriveAgreedSeq(messages)).toBeNull();
  });
});

describe('optimistic echo → reconcile (AC1, mirrors web 9.9)', () => {
  it('appends a pending echo (sorts last), then a folded delta REPLACES it (reconcile, no duplicate)', () => {
    const m = baseModel();
    const token = 'tok-1';
    const echo = makePendingPost('operator', 'Let us go with gRPC.', token);
    const withEcho = appendPendingPost(m, echo);
    expect(withEcho.messages.at(-1)).toMatchObject({
      pending: true,
      body: 'Let us go with gRPC.',
    });

    // The confirmed reply arrives via the delta poll (same actor + body) → REPLACE the echo.
    const reconciled = foldRoomDelta(
      withEcho,
      ev({
        type: 'room.replied',
        seq: 9,
        actor: 'operator',
        payload: { roomId: 'calling-interface', body: 'Let us go with gRPC.' },
      }),
    );
    const operatorPosts = reconciled.messages.filter(
      (p) => p.body === 'Let us go with gRPC.',
    );
    expect(operatorPosts).toHaveLength(1); // de-duped — NOT echo + confirmed
    expect(operatorPosts[0]?.seq).toBe(9);
    expect(operatorPosts[0]?.pending).toBeUndefined();
    expect(reconciled.messages.some((p) => p.pending === true)).toBe(false);
  });

  it('markPendingPostFailed preserves the body (retry source); removePendingPost drops it', () => {
    const m = baseModel();
    const token = 'tok-2';
    const withEcho = appendPendingPost(
      m,
      makePendingPost('operator', 'draft body', token),
    );
    const failed = markPendingPostFailed(withEcho, token);
    const failedPost = failed.messages.find((p) => p.clientToken === token);
    expect(failedPost).toMatchObject({
      failed: true,
      pending: false,
      body: 'draft body',
    });
    const removed = removePendingPost(failed, token);
    expect(removed.messages.some((p) => p.clientToken === token)).toBe(false);
  });

  it('reconcileReread keeps OTHER in-flight echoes but drops the reconciled one', () => {
    const m = baseModel();
    const echoA = makePendingPost('operator', 'post A', 'tok-A');
    const echoB = makePendingPost('operator', 'post B', 'tok-B');
    const priorMessages = [...m.messages, echoA, echoB];
    // Authoritative re-read: has the confirmed post A at seq 9 (NOT the echoes).
    const authoritative: RoomViewModel = {
      ...m,
      messages: [
        ...m.messages,
        {
          seq: 9,
          actor: 'operator',
          body: 'post A',
          kind: 'reply',
          reactions: [],
        },
      ],
    };
    const reconciled = reconcileReread(authoritative, priorMessages, 'tok-A');
    // Echo A dropped (the re-read has it); echo B survives (still in flight); no duplicate post A.
    expect(reconciled.messages.filter((p) => p.body === 'post A')).toHaveLength(
      1,
    );
    expect(reconciled.messages.some((p) => p.clientToken === 'tok-B')).toBe(
      true,
    );
    expect(reconciled.messages.some((p) => p.clientToken === 'tok-A')).toBe(
      false,
    );
  });
});
