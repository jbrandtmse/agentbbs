// Story 6.2 — BOUNDED delivery for MESSAGES, real-runtime evidence (AC #1, #4; skill-rules Rule 3).
//
// QA gap-fill complementing `check.bounded.integration.test.ts`. The dev's bounded test proves the
// `check` RESPONSE is bounded by NEW activity for ANNOUNCEMENTS (the per-BOARD join floor). But the
// MESSAGE delta is bounded by a DIFFERENT mechanism — the per-ROOM join floor (`roomFloors` in
// `core/src/discovery/check.ts`, lines ~197-211: a message surfaces only if
// `seq > max(cursor, roomFloor)`, where `roomFloor` is the actor's earliest participating event —
// a `room.replied` by them OR a `room.participant_added` naming them). `docs/pull-only-delivery.md`
// §2/§3 claims the bound holds for messages too, but no test seeded a LARGE room message history +
// a SMALL post-floor message delta and asserted the delta count == the small number. This file is
// that reaffirming proof, over the REAL `createDataAccess` SQLite ledger (nothing mocked).
//
// THE BOUND (for messages): a participant who joins a room LATE (via `add_participant`, so their
// per-room floor = the `participant_added` seq, ABOVE the entire prior message back-history) is NOT
// flooded with that room's pre-join history on their first `check` — they receive only the messages
// posted AFTER they were added. We use `add_participant` rather than a self-reply for the late join
// so the floor is set WITHOUT the joiner contributing a message: the returned message count is then
// EXACTLY the post-floor delta with no off-by-one from the joiner's own activation reply. This
// exercises the `room.participant_added` floor branch and the message-delta bound the announcement
// test never touches.
//
//   1. ABSOLUTE: one room with a LARGE reply back-history (hundreds of replies the late participant
//      is floored out of) + a SMALL post-add delta (k new replies); the late participant's first
//      `check` returns EXACTLY k messages for that room (NOT back-history + k), none of the back-
//      history replies leak, and the response is ≪ the ledger size.
//   2. SCALE-INVARIANCE: the same post-add delta returns the SAME message count at a small AND a
//      large room back-history (the response does not grow with the room's history).
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/** Stand up a real Client↔server pair over the in-memory transport + real ledger. */
async function connect(): Promise<{
  client: Client;
  session: SessionIdentity;
}> {
  const session = createSessionIdentity();
  const server = createBoardServer({
    dataAccess: dataAccess!,
    sessionIdentity: session,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  disposers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, session };
}

async function register(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'dialing in' },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

async function login(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'login',
    arguments: { handle },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

async function announce(client: Client, projectId: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Post a proto-room announcement; return its room_id. */
async function postAnnouncement(
  client: Client,
  projectId: string,
  subject: string,
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body: `body for ${subject}` },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

/** Reply to a room (activates a proto-room / adds a message); return the reply seq. */
async function reply(
  client: Client,
  roomId: string,
  body: string,
): Promise<number> {
  const result = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { seq: number } }).room.seq;
}

/** Pull `handle` into `roomId` as a participant (sets their per-room floor at the add seq). */
async function addParticipant(
  client: Client,
  roomId: string,
  handle: string,
): Promise<void> {
  const result = (await client.callTool({
    name: 'add_participant',
    arguments: { room_id: roomId, handle },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** Call `check` for the session's current identity; return the wire envelope. */
async function check(client: Client): Promise<{
  announcements: { room_id: string; seq: number }[];
  messages: { room_id: string; seq: number; actor: string; body: string }[];
  cursor: number;
}> {
  const result = (await client.callTool({
    name: 'check',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result.structuredContent as {
    announcements: { room_id: string; seq: number }[];
    messages: { room_id: string; seq: number; actor: string; body: string }[];
    cursor: number;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-check-bounded-msg-int-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  dataAccess = createDataAccess({ dbPath });
});

afterEach(async () => {
  while (disposers.length > 0) {
    await disposers.pop()?.();
  }
  try {
    dataAccess?.close();
  } catch {
    /* already closed */
  }
  dataAccess = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the bounded-MESSAGES scenario once and return the late participant's first-check messages for
 * the room + the back-history reply bodies + the post-add delta bodies + the real ledger maxSeq.
 * Each invocation uses its OWN poster/board/room/joiner handles, so several runs can layer on ONE
 * shared ledger without collisions (the scale-invariance test relies on this).
 *
 * Scenario: `poster` creates `projectId`, posts a proto-room, ACTIVATES it with a reply, then floods
 * it with `backHistory` MORE replies — ALL before the joiner participates (the pre-floor message
 * back-history). The `joiner` registers and is pulled into the room via `add_participant` (their
 * per-room floor = the add seq, ABOVE every back-history reply). The poster then posts `delta` NEW
 * replies AFTER the add. The joiner's first `check` must return EXACTLY the `delta` new messages for
 * that room — never the back-history.
 */
async function runBoundedMessages(args: {
  poster: string;
  joiner: string;
  projectId: string;
  backHistory: number;
  delta: number;
}): Promise<{
  roomId: string;
  messages: { room_id: string; seq: number; actor: string; body: string }[];
  backHistoryBodies: Set<string>;
  deltaBodies: Set<string>;
  maxSeq: number;
}> {
  const { poster, joiner, projectId, backHistory, delta } = args;

  // The poster creates the board, posts a proto-room, and ACTIVATES it (first reply), then floods
  // the room with `backHistory` further replies — all BEFORE the joiner is added.
  const { client: pc } = await connect();
  await register(pc, poster);
  await announce(pc, projectId);
  const roomId = await postAnnouncement(pc, projectId, 'big-negotiation');
  await reply(pc, roomId, 'activating reply'); // proto-room → active room
  const backHistoryBodies = new Set<string>();
  for (let i = 0; i < backHistory; i += 1) {
    const body = `old-msg-${i}`;
    await reply(pc, roomId, body);
    backHistoryBodies.add(body);
  }

  // The joiner registers, then the poster pulls them into the room via add_participant. The
  // joiner's per-room floor is the `participant_added` seq — ABOVE the entire reply back-history,
  // and set WITHOUT the joiner posting a message (so the post-add count is exact: no joining-reply
  // off-by-one).
  const { client: jc } = await connect();
  await register(jc, joiner);
  const { client: pcB } = await connect();
  await login(pcB, poster); // re-establish poster on a fresh connection (register → HANDLE_TAKEN)
  await addParticipant(pcB, roomId, joiner);

  // The poster posts `delta` NEW replies AFTER the add, so they ARE in the joiner's message scope
  // (above their per-room floor).
  const deltaBodies = new Set<string>();
  for (let i = 0; i < delta; i += 1) {
    const body = `new-msg-${i}`;
    await reply(pcB, roomId, body);
    deltaBodies.add(body);
  }

  // The freshly-added participant's FIRST check.
  const result = await check(jc);

  return {
    roomId,
    messages: result.messages,
    backHistoryBodies,
    deltaBodies,
    maxSeq: await dataAccess!.maxSeq(),
  };
}

describe('check MESSAGE delta is BOUNDED by new activity, not room history size (AC #1, #4)', () => {
  it('a late participant over a LARGE room reply history receives ONLY the small post-add message delta (count == delta, NOT history + delta)', async () => {
    const BACK_HISTORY = 400; // hundreds of pre-join replies the late participant is floored out of
    const DELTA = 3; // a small post-add message delta

    const { roomId, messages, backHistoryBodies, deltaBodies, maxSeq } =
      await runBoundedMessages({
        poster: 'a2',
        joiner: 'ada',
        projectId: 'release-train',
        backHistory: BACK_HISTORY,
        delta: DELTA,
      });

    // All returned messages belong to the one room the participant was added to.
    const roomMessages = messages.filter((m) => m.room_id === roomId);
    expect(roomMessages).toHaveLength(messages.length); // no other room leaked in

    // The message delta is EXACTLY the post-add new replies — NOT the room's back-history.
    expect(roomMessages).toHaveLength(DELTA);
    const returnedBodies = new Set(roomMessages.map((m) => m.body));
    expect(returnedBodies).toEqual(deltaBodies);

    // Provably bounded: NONE of the hundreds of pre-add replies (nor the activating reply) leaked
    // into the response, even though they all sit in the (now large) ledger.
    for (const body of returnedBodies)
      expect(backHistoryBodies.has(body)).toBe(false);
    expect(returnedBodies.has('activating reply')).toBe(false);

    // The ledger is genuinely LARGE (>= the back-history we seeded) — so "only DELTA returned" is a
    // real bound, not an artifact of a small ledger…
    expect(maxSeq).toBeGreaterThanOrEqual(BACK_HISTORY);
    // …yet the response carried only a handful of messages: response size ≪ ledger size.
    expect(roomMessages.length).toBeLessThan(maxSeq / 10);
  });

  it('SCALE-INVARIANCE: the same post-add message delta returns the SAME count at a small AND a large room history (the response does not grow with the room history)', async () => {
    const DELTA = 2;

    // Run the scenario twice on ONE shared ledger, each with its OWN poster/board/room/joiner. The
    // SECOND run layers a large room history ON TOP of the first run's events, so by the time the
    // second joiner checks, the total ledger is far larger — yet its message delta must STILL be
    // exactly DELTA, because its per-room floor excludes everything before its own add.
    const small = await runBoundedMessages({
      poster: 'a2',
      joiner: 'ada',
      projectId: 'board-small',
      backHistory: 10,
      delta: DELTA,
    });
    const smallRoomMsgs = small.messages.filter(
      (m) => m.room_id === small.roomId,
    );
    expect(smallRoomMsgs).toHaveLength(DELTA);
    expect(new Set(smallRoomMsgs.map((m) => m.body))).toEqual(
      small.deltaBodies,
    );

    const large = await runBoundedMessages({
      poster: 'a3',
      joiner: 'bea',
      projectId: 'board-large',
      backHistory: 400,
      delta: DELTA,
    });
    const largeRoomMsgs = large.messages.filter(
      (m) => m.room_id === large.roomId,
    );
    expect(largeRoomMsgs).toHaveLength(DELTA);
    expect(new Set(largeRoomMsgs.map((m) => m.body))).toEqual(
      large.deltaBodies,
    );

    // The two message deltas are the SAME size despite the second run sitting on a far larger
    // ledger with a far larger room history.
    expect(largeRoomMsgs.length).toBe(smallRoomMsgs.length);
    expect(large.maxSeq).toBeGreaterThan(small.maxSeq);
    // None of the second run's pre-add back-history leaked into its delta.
    const largeBodies = new Set(largeRoomMsgs.map((m) => m.body));
    for (const body of largeBodies)
      expect(large.backHistoryBodies.has(body)).toBe(false);
  });
});
