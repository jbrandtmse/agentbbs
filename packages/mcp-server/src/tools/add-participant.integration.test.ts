// Integration AC #6 (Story 4.5, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2
// seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is mocked: the
// wire, the server, the `add_participant` tool, core's `addParticipant` (room lookup +
// participation gate + target resolution + room.participant_added append + conditional target
// auto-join + read-back), the participants projection, the rooms projection, the members
// projection, and the ledger are all real.
//
// Asserts AC #6 end-to-end for `add_participant`:
//   - identity A announces a board + posts an announcement (a PROTO-room); identity B replies
//     (B is now a participant + a board member); B calls add_participant to pull in C (a
//     registered NON-member) by handle → C becomes a participant + a board MEMBER (C appears
//     in list_members), C can read_room the FULL history, and a room.participant_added for C is
//     in the ledger (actor = B, payload.handle = C) + exactly one board.joined for C;
//   - add_participant with an UNREGISTERED handle → HANDLE_NOT_FOUND (nothing appended);
//   - add_participant to an unknown room_id → ROOM_NOT_FOUND (nothing appended);
//   - a NON-participant (A, who announced but never replied) → NOT_A_MEMBER (nothing appended);
//     and a registered BYSTANDER who never engaged the room → NOT_A_MEMBER;
//   - an idempotent RE-ADD of an existing participant → no-op (no second participant_added).
// plus the NO_IDENTITY (no session) path and the discovery-surface params, over the same real
// transport.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir(). The
// room.participant_added / board.joined counts are read out-of-band via the REAL ledger
// (eventsByType) — the better-sqlite3 import boundary (lint) forbids opening a raw connection
// from this package, so a correct read-back over the REAL ledger is the evidence.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set the session the
 * tools act as. Returns the connected client and the very holder the server's tools read.
 */
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

/** Register an identity AND announce a sub-board (making the announcer its first member). */
async function registerAndAnnounce(
  client: Client,
  handle: string,
  projectId: string,
): Promise<void> {
  await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'shipping 4.5' },
  });
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Post an announcement (proto-room) as the session's current identity; return its room_id. */
async function postAnnouncement(
  client: Client,
  projectId: string,
  subject: string,
  body: string,
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

/** Register a fresh identity on a NEW connection (same real ledger); return its client. */
async function registerOnFreshConnection(handle: string): Promise<Client> {
  const { client } = await connect();
  await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: `${handle} focus` },
  });
  return client;
}

/** Reply to a room as the session's current identity (asserts success). */
async function reply(
  client: Client,
  roomId: string,
  body: string,
): Promise<void> {
  const r = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
}

/** The member handles in a board's list_members directory. */
async function memberHandles(
  client: Client,
  projectId: string,
): Promise<string[]> {
  const result = (await client.callTool({
    name: 'list_members',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (
    result.structuredContent as { members: { handle: string }[] }
  ).members.map((m) => m.handle);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-addpart-int-'));
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

describe('add_participant over a real MCP client + real ledger (AC #6)', () => {
  it('B (a participant) pulls in C (a registered non-member): C becomes a member (list_members), can read_room the full history, and a room.participant_added for C is in the ledger', async () => {
    // A announces calling-interface (auto-joined) + posts a proto-room.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'looking for a second pair of eyes',
      );
      // Before any reply: the only board member is ada.
      expect(await memberHandles(client, 'calling-interface')).toEqual(['ada']);
    }

    // B (bob) registers on a fresh connection and REPLIES — now a participant + member.
    const bob = await registerOnFreshConnection('bob');
    await reply(bob, roomId, 'I can take a look');
    expect(await memberHandles(bob, 'calling-interface')).toEqual([
      'ada',
      'bob',
    ]);

    // C (cleo) registers but NEVER joins the board / room.
    await registerOnFreshConnection('cleo');

    // B pulls C into the room.
    const result = (await bob.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'cleo' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    // The result envelope carries the room + participants (B then C).
    const envelope = result.structuredContent as {
      room: { room_id: string };
      participants: string[];
    };
    expect(envelope.room.room_id).toBe(roomId);
    expect(envelope.participants).toEqual(['bob', 'cleo']);

    // C is now a board MEMBER (appears in list_members, appended after ada + bob).
    expect(await memberHandles(bob, 'calling-interface')).toEqual([
      'ada',
      'bob',
      'cleo',
    ]);

    // C can read_room the FULL history on demand (open read). cleo reads it on her own
    // identity-bearing connection (login, since she registered above on another connection).
    {
      const { client } = await connect();
      await client.callTool({ name: 'login', arguments: { handle: 'cleo' } });
      const read = (await client.callTool({
        name: 'read_room',
        arguments: { room_id: roomId },
      })) as CallToolResult;
      expect(read.isError).toBeFalsy();
      const history = read.structuredContent as {
        room: { room_id: string };
        messages: { kind: string; actor: string; body: string }[];
      };
      expect(history.room.room_id).toBe(roomId);
      // The full history: announcement #1 (ada) + bob's reply.
      expect(history.messages.map((m) => m.kind)).toEqual([
        'announcement',
        'reply',
      ]);
      expect(history.messages[0]?.actor).toBe('ada');
      expect(history.messages[1]?.actor).toBe('bob');
    }

    // Out-of-band via the REAL ledger: exactly one room.participant_added for cleo (actor =
    // bob, the adder) + exactly one board.joined for cleo (the target's auto-join, actor =
    // cleo herself).
    const added = await dataAccess!.eventsByType('room.participant_added');
    expect(added).toHaveLength(1);
    expect(added[0]?.actor).toBe('bob');
    expect(added[0]?.payload).toEqual({ roomId, handle: 'cleo' });

    const cleoJoins = (await dataAccess!.eventsByType('board.joined')).filter(
      (e) => e.actor === 'cleo',
    );
    expect(cleoJoins).toHaveLength(1);
    expect(cleoJoins[0]?.payload).toEqual({ projectId: 'calling-interface' });
  });

  it('add_participant with an UNREGISTERED handle → HANDLE_NOT_FOUND (nothing appended)', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
    }
    // B replies (becomes a participant who is allowed to add).
    const bob = await registerOnFreshConnection('bob');
    await reply(bob, roomId, 'on it');
    const before = await dataAccess!.maxSeq();

    const result = (await bob.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'ghost' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({
      code: 'HANDLE_NOT_FOUND',
    });
    // Nothing appended on the not-found path.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(0);
  });

  it('add_participant to an unknown room_id → ROOM_NOT_FOUND (nothing appended)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'add_participant',
      arguments: { room_id: 'no-such-room', handle: 'ada' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(0);
  });

  it('rejects a malformed room_id OR a malformed handle at the Zod boundary BEFORE core — nothing appended, the real room.participant_added is untouched (closes deferred-work 4.3-a)', async () => {
    // Establish a REAL room with a genuine participant_added first: A announces + posts,
    // B replies (becomes a participant + the legitimate adder), B pulls in C → exactly one
    // room.participant_added exists. Then prove each malformed call leaves that count
    // UNCHANGED (stronger than asserting 0 — a valid add DID append, malformed ones do NOT).
    // add_participant validates BOTH params at the boundary: room_id via roomIdSchema
    // (`.min(1).max(200)` + slug regex) and handle via the shared handleSchema
    // (identity-shared.ts: `.min(1).max(128)` + `^[a-z0-9._@-]+$`). The SDK rejects an empty /
    // out-of-charset value for EITHER before the delegate runs — a Zod validation rejection
    // (isError, NOT a closed board code), distinct from ROOM_NOT_FOUND / HANDLE_NOT_FOUND
    // (those are well-formed-but-unknown ids that reach core).
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
    }
    const bob = await registerOnFreshConnection('bob');
    await reply(bob, roomId, 'on it'); // bob is now a participant (allowed to add)
    await registerOnFreshConnection('cleo'); // a valid, registered target
    const firstAdd = (await bob.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'cleo' },
    })) as CallToolResult;
    expect(firstAdd.isError).toBeFalsy();
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(1);

    // Malformed room_id (handle 'cleo' is valid) — rejected at the boundary, never reaches
    // the room lookup. Malformed handle (room_id valid) — rejected before the target lookup.
    const malformedRoomIds = [
      '',
      '   ',
      'Bad Room!',
      'UPPER',
      '--leading',
      'a..b',
    ];
    const malformedHandles = ['', '   ', 'Bad Handle!', 'has space', 'UPPER!'];
    for (const badRoomId of malformedRoomIds) {
      const before = await dataAccess!.maxSeq();
      const result = (await bob.callTool({
        name: 'add_participant',
        arguments: { room_id: badRoomId, handle: 'cleo' },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(readErrorPayload(result)).toBeUndefined(); // Zod rejection, no closed code
      expect(await dataAccess!.maxSeq()).toBe(before);
      expect(
        await dataAccess!.eventsByType('room.participant_added'),
      ).toHaveLength(1);
    }
    for (const badHandle of malformedHandles) {
      const before = await dataAccess!.maxSeq();
      const result = (await bob.callTool({
        name: 'add_participant',
        arguments: { room_id: roomId, handle: badHandle },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(readErrorPayload(result)).toBeUndefined(); // Zod rejection, no closed code
      expect(await dataAccess!.maxSeq()).toBe(before);
      expect(
        await dataAccess!.eventsByType('room.participant_added'),
      ).toHaveLength(1);
    }
  });

  it('a NON-participant (A, who announced but never replied) calling add_participant → NOT_A_MEMBER (nothing appended)', async () => {
    const { client: ada } = await connect();
    await registerAndAnnounce(ada, 'ada', 'calling-interface');
    const roomId = await postAnnouncement(
      ada,
      'calling-interface',
      'Need a reviewer',
      'seed',
    );
    // bob must exist as a valid target so the rejection is the participation gate, not
    // HANDLE_NOT_FOUND. (Order: room check → participation gate → target check.)
    await registerOnFreshConnection('bob');
    const before = await dataAccess!.maxSeq();

    // ada ANNOUNCED the room but never replied → she is NOT a participant → NOT_A_MEMBER.
    const result = (await ada.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'bob' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NOT_A_MEMBER' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(0);
  });

  it('a registered BYSTANDER who never engaged the room → NOT_A_MEMBER', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
      // bob replies so the room has a participant (and is a valid add target later).
      const bob = await registerOnFreshConnection('bob');
      await reply(bob, roomId, 'on it');
    }
    // dave registers but never touches the room — a bystander. He tries to add bob.
    const dave = await registerOnFreshConnection('dave');
    const result = (await dave.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'bob' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NOT_A_MEMBER' });
  });

  it('an idempotent RE-ADD of an existing participant is a no-op (no second room.participant_added)', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
    }
    const bob = await registerOnFreshConnection('bob');
    await reply(bob, roomId, 'on it');
    await registerOnFreshConnection('cleo');

    // First add: bob pulls in cleo.
    const first = (await bob.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'cleo' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();
    const afterFirst = await dataAccess!.maxSeq();

    // Re-add cleo: idempotent no-op — NOTHING appended.
    const second = (await bob.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'cleo' },
    })) as CallToolResult;
    expect(second.isError).toBeFalsy();
    const envelope = second.structuredContent as { participants: string[] };
    expect(envelope.participants).toEqual(['bob', 'cleo']);
    expect(await dataAccess!.maxSeq()).toBe(afterFirst);

    // Still exactly one room.participant_added + one cleo board.joined.
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(1);
    expect(
      (await dataAccess!.eventsByType('board.joined')).filter(
        (e) => e.actor === 'cleo',
      ),
    ).toHaveLength(1);
  });

  it('add_participant with NO established identity returns NO_IDENTITY and appends nothing', async () => {
    // A room + a participant must exist so the failure is the session gate, not another code.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
      const bob = await registerOnFreshConnection('bob');
      await reply(bob, roomId, 'on it');
    }
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'add_participant',
      arguments: { room_id: roomId, handle: 'bob' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(
      await dataAccess!.eventsByType('room.participant_added'),
    ).toHaveLength(0);
  });

  it('advertises snake_case params (room_id, handle) on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'add_participant');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'handle',
      'room_id',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['room_id', 'handle']),
    );
  });
});
