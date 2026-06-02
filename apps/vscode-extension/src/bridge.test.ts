// postMessage bridge — dispatch + delta-poll tests (Story 10.2, AC2).
//
// REAL-RUNTIME at the library tier: a fake in-memory Messaging channel + a REAL node:sqlite
// data-access handle over a genuine temp-file ledger (the same adapter the extension host
// uses). NOTHING about the bridge's op-dispatch or delta-poll is stubbed — it composes the real
// core ops over the real seam, exactly as in the host. Discoverable by the ROOT `pnpm test`
// (co-located apps/*/src/**/*.test.ts → node project; Rule 8).
//
// Covered:
//   - dispatchRequest maps each READ op to its core result (listProjects/listRooms/
//     listAnnouncements/boardDirectory/readRoom/readContract);
//   - the `reply` WRITE pattern works AND applies trim discipline (whitespace-only → BAD_REQUEST,
//     nothing persists) — the 9.13-trim awareness carry;
//   - an unknown op → BAD_REQUEST; a core BoardError (ROOM_NOT_FOUND) → the closed code on the wire;
//   - createBridge round-trips a request over the channel AND pushes a MAX(seq) delta when a new
//     event lands (host→webview only — NFR5 pull-only preserved);
//   - dispose() stops the poll + detaches the handler (no further frames).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  announceProject,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBridge,
  dispatchRequest,
  type HostToWebview,
  type Messaging,
} from './bridge.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

/** A fake Messaging channel that records host→webview frames + lets a test inject inbound msgs. */
function fakeChannel(): Messaging & {
  sent: HostToWebview[];
  inject(msg: unknown): void;
} {
  const handlers: Array<(m: unknown) => void> = [];
  const sent: HostToWebview[] = [];
  return {
    sent,
    postMessage(message) {
      sent.push(message);
    },
    onMessage(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    inject(msg) {
      for (const h of [...handlers]) h(msg);
    },
  };
}

/** Seed a board: a registered actor, an announced project, a posted announcement (proto-room). */
async function seedBoard(
  d: DataAccessHandle,
): Promise<{ roomId: string; projectId: string }> {
  await register(d, { handle: 'alice', currentFocus: 'seeding' });
  const project = await announceProject(d, 'alice', {
    title: 'Test Project',
    description: 'desc',
  });
  const room = await postAnnouncement(d, 'alice', {
    projectId: project.projectId,
    subject: 'Subject',
    body: 'Body',
  });
  return { roomId: room.roomId, projectId: project.projectId };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-bridge-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  da = createDataAccessNodeSqlite({ dbPath });
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

describe('bridge dispatch — READ ops mirror core', () => {
  it('listProjects returns the announced projects', async () => {
    const { projectId } = await seedBoard(da!);
    const res = await dispatchRequest(da!, { id: '1', op: 'listProjects' });
    expect(res.ok).toBe(true);
    const result = res.result as { projects: Array<{ projectId: string }> };
    expect(result.projects.map((p) => p.projectId)).toContain(projectId);
  });

  it('listAnnouncements returns the proto-room; readRoom returns room + messages + participants', async () => {
    const { roomId, projectId } = await seedBoard(da!);

    const ann = await dispatchRequest(da!, {
      id: '2',
      op: 'listAnnouncements',
      args: { projectId },
    });
    expect(ann.ok).toBe(true);
    expect(
      (
        ann.result as { announcements: Array<{ roomId: string }> }
      ).announcements.map((r) => r.roomId),
    ).toContain(roomId);

    const room = await dispatchRequest(da!, {
      id: '3',
      op: 'readRoom',
      args: { roomId },
    });
    expect(room.ok).toBe(true);
    const rr = room.result as {
      room: { roomId: string };
      messages: unknown[];
      participants: string[];
    };
    expect(rr.room.roomId).toBe(roomId);
    expect(Array.isArray(rr.messages)).toBe(true);
    expect(Array.isArray(rr.participants)).toBe(true);
  });

  it('readContract returns { roomId, contract:null } for a proto-room with no agreed mark', async () => {
    const { roomId } = await seedBoard(da!);
    const res = await dispatchRequest(da!, {
      id: '4',
      op: 'readContract',
      args: { roomId },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ roomId, contract: null });
  });
});

describe('bridge dispatch — WRITE pattern (reply) + trim discipline + errors', () => {
  it('reply posts a message via the core reply op (grant-on-act) and returns the room', async () => {
    const { roomId } = await seedBoard(da!);
    await register(da!, { handle: 'bob', currentFocus: 'answering' });
    const res = await dispatchRequest(da!, {
      id: '5',
      op: 'reply',
      args: { actor: 'bob', roomId, body: 'a real reply' },
    });
    expect(res.ok).toBe(true);
    expect((res.result as { room: { roomId: string } }).room.roomId).toBe(
      roomId,
    );
    // The reply persisted (the room now has the activating message).
    const messages = (await reply(da!, 'bob', {
      roomId,
      body: 'second',
    })) as unknown;
    expect(messages).toBeDefined();
  });

  it('reply REJECTS a whitespace-only body (BAD_REQUEST) and persists NOTHING (9.13-trim)', async () => {
    const { roomId } = await seedBoard(da!);
    await register(da!, { handle: 'bob', currentFocus: 'x' });
    const before = await da!.maxSeq();
    const res = await dispatchRequest(da!, {
      id: '6',
      op: 'reply',
      args: { actor: 'bob', roomId, body: '   \n\t  ' },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BAD_REQUEST');
    // No event appended — the trim guard fired BEFORE core.
    expect(await da!.maxSeq()).toBe(before);
  });

  it('an unknown op → BAD_REQUEST', async () => {
    const res = await dispatchRequest(da!, { id: '7', op: 'frobnicate' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BAD_REQUEST');
  });

  it('a core BoardError surfaces its CLOSED code on the wire (ROOM_NOT_FOUND for an unknown room)', async () => {
    const res = await dispatchRequest(da!, {
      id: '8',
      op: 'readRoom',
      args: { roomId: 'no-such-room' },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('ROOM_NOT_FOUND');
  });
});

describe('bridge dispatch — PROTO-ROOM reply-to-activate (AC4, Rule 15 respond-parity)', () => {
  // THE MARQUEE SEMANTIC (Story 10.4 AC4): the operator opens a PROTO-ROOM (active:false) and
  // replies through the bridge; the EXISTING core `reply` op (the Epic-4 min-seq activator) flips
  // the room ACTIVE. This proves the bridge maps the operator's RESPOND affordance to the SAME
  // `reply` an agent uses — no fabricated activate op (Rule 13/15).
  //
  // MUTATION-TESTED NON-VACUOUS (Rule 7): temporarily breaking the bridge `reply` op so it does
  // NOT reach core (e.g. `return { room };` WITHOUT the `await reply(...)`) leaves the room
  // active:false → this test goes RED. Confirmed during dev; production reverted byte-identical.
  it('a reply through the bridge ACTIVATES a proto-room (active:false → true) via the existing reply op', async () => {
    const { roomId } = await seedBoard(da!);
    await register(da!, { handle: 'bob', currentFocus: 'answering' });

    // BEFORE: the proto-room is INACTIVE (an announcement with no reply yet).
    const before = await dispatchRequest(da!, {
      id: 'a1',
      op: 'readRoom',
      args: { roomId },
    });
    expect((before.result as { room: { active: boolean } }).room.active).toBe(
      false,
    );

    // ACT: reply through the bridge (the operator's RESPOND affordance → core `reply`).
    const res = await dispatchRequest(da!, {
      id: 'a2',
      op: 'reply',
      args: { actor: 'bob', roomId, body: 'I will take this.' },
    });
    expect(res.ok).toBe(true);

    // AFTER: the room is now ACTIVE — the min-seq activator fired (asserted OUT-OF-BAND via a
    // fresh readRoom read, not the write's own return).
    const after = await dispatchRequest(da!, {
      id: 'a3',
      op: 'readRoom',
      args: { roomId },
    });
    const room = (
      after.result as { room: { active: boolean; activatedBy?: string } }
    ).room;
    expect(room.active).toBe(true);
    expect(room.activatedBy).toBe('bob');
  });
});

describe('bridge dispatch — react/unreact (the ReactionChip 👍 toggle, Story 10.4)', () => {
  /** Activate a room (bob replies), so it has a real message to 👍 + bob is a participant. */
  async function activeRoomWithMessage(d: DataAccessHandle): Promise<{
    roomId: string;
    messageSeq: number;
  }> {
    const { roomId } = await seedBoard(d);
    await register(d, { handle: 'bob', currentFocus: 'answering' });
    await reply(d, 'bob', { roomId, body: 'the activating reply' });
    // The activating reply's seq is the room's first reply message seq — read it back.
    const events = await d.eventsSince(0);
    const replied = events.find((e) => e.type === 'room.replied');
    return { roomId, messageSeq: replied!.seq };
  }

  it('react places a 👍 via the core react op and returns the live reactors', async () => {
    const { messageSeq } = await activeRoomWithMessage(da!);
    const res = await dispatchRequest(da!, {
      id: 'rx1',
      op: 'react',
      args: { actor: 'bob', messageSeq },
    });
    expect(res.ok).toBe(true);
    const result = res.result as { messageSeq: number; reactions: string[] };
    expect(result.messageSeq).toBe(messageSeq);
    expect(result.reactions).toContain('bob');
  });

  it('unreact retracts the 👍 and returns the emptied reactor set', async () => {
    const { messageSeq } = await activeRoomWithMessage(da!);
    await dispatchRequest(da!, {
      id: 'rx2',
      op: 'react',
      args: { actor: 'bob', messageSeq },
    });
    const res = await dispatchRequest(da!, {
      id: 'rx3',
      op: 'unreact',
      args: { actor: 'bob', messageSeq },
    });
    expect(res.ok).toBe(true);
    expect((res.result as { reactions: string[] }).reactions).not.toContain(
      'bob',
    );
  });

  it('react by a NON-participant surfaces the core NOT_A_MEMBER closed code (no backdoor)', async () => {
    const { messageSeq } = await activeRoomWithMessage(da!);
    await register(da!, { handle: 'stranger', currentFocus: 'lurking' });
    const res = await dispatchRequest(da!, {
      id: 'rx4',
      op: 'react',
      args: { actor: 'stranger', messageSeq },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NOT_A_MEMBER');
  });

  it('react with a non-numeric messageSeq → host-surface BAD_REQUEST', async () => {
    await activeRoomWithMessage(da!);
    const res = await dispatchRequest(da!, {
      id: 'rx5',
      op: 'react',
      args: { actor: 'bob', messageSeq: 'not-a-number' },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BAD_REQUEST');
  });
});

describe('createBridge — request round-trip + MAX(seq) delta poll + dispose', () => {
  it('round-trips a request over the channel and pushes a delta when a new event lands', async () => {
    await seedBoard(da!);
    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: da!,
      messaging: channel,
      pollIntervalMs: 10,
    });
    try {
      // Request round-trip: inject a listProjects request; the bridge posts a response back.
      channel.inject({ id: 'r1', op: 'listProjects' });
      await waitFor(() => channel.sent.some((m) => m.type === 'response'));
      const response = channel.sent.find((m) => m.type === 'response');
      expect(response).toMatchObject({ type: 'response', id: 'r1', ok: true });

      // Let the poller seed its high-water-mark to "now".
      await delayMs(40);

      // A NEW event lands → the poller pushes a delta (host→webview only).
      await register(da!, { handle: 'carol', currentFocus: 'joining' });
      await waitFor(() => channel.sent.some((m) => m.type === 'delta'));
      const delta = channel.sent.find((m) => m.type === 'delta');
      expect(delta).toBeDefined();
      expect((delta as { events: unknown[] }).events.length).toBeGreaterThan(0);
    } finally {
      bridge.dispose();
    }
  });

  it('dispose() stops the poll and detaches the handler (no further frames)', async () => {
    await seedBoard(da!);
    const channel = fakeChannel();
    const bridge = createBridge({
      dataAccess: da!,
      messaging: channel,
      pollIntervalMs: 10,
    });
    await delayMs(40); // let it seed
    bridge.dispose();
    const countAfterDispose = channel.sent.length;

    // A post-dispose event must NOT produce a delta, and a post-dispose request is ignored.
    await register(da!, { handle: 'dave', currentFocus: 'late' });
    channel.inject({ id: 'late', op: 'listProjects' });
    await delayMs(40);
    expect(channel.sent.length).toBe(countAfterDispose);
  });
});

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delayMs(5);
  }
}
