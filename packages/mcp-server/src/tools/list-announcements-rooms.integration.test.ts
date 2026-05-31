// Integration AC #4 (Story 4.2, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the `list_announcements`/`list_rooms` tools, core's
// `listAnnouncements`/`listRooms` + the rooms projection's activation read-model, and the
// ledger are all real.
//
// SEEDING NOTE (story Design decision 4): one room is activated by appending a
// `room.replied` DIRECTLY through the `DataAccess` port — the `reply` TOOL is Story 4.3, so
// it does not exist yet. This is legitimate for a READ-tool test: the READ is what is under
// test, and the ledger is seeded through the very port the 4.3 op will use. It is NOT a
// missing-consumer gap.
//
// Asserts AC #4 end-to-end:
//   - an agent registers, announces a sub-board, posts TWO announcements (two proto-rooms),
//     then ONE is activated by a port-seeded room.replied →
//       list_announcements(project_id) returns EXACTLY the one still-proto room,
//       list_rooms(project_id) returns EXACTLY the one activated room, both seq-ordered;
//   - a SECOND identity that registered but did NOT join the board gets the SAME results
//     (board-wide open read, FR9 — membership never required to READ);
//   - list_announcements / list_rooms on an unknown project_id are rejected BOARD_NOT_FOUND;
//   - the NO_IDENTITY (no session) precondition path, over the same real transport;
//   - the discovery-surface params (project_id, snake_case).
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
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/** A wire room object (snake_case) as it appears inside the list envelopes. */
interface WireRoom {
  room_id: string;
  project_id: string;
  subject: string;
  body: string;
  posted_by: string;
  seq: number;
  active: boolean;
}

/**
 * Stand up a real Client↔server pair over the in-memory transport + real ledger, with a
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
    arguments: { handle, current_focus: 'shipping 4.2' },
  });
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Post an announcement (open a proto-room) as the connected identity; return its room_id. */
async function post(
  client: Client,
  projectId: string,
  subject: string,
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body: `${subject} body` },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

/**
 * Seed an ACTIVATING reply for a room by appending a `room.replied` DIRECTLY through the
 * real DataAccess port — the reply TOOL is Story 4.3 (Design decision 4). The read under
 * test (list_rooms) then sees the room as activated via the projection's read-model.
 */
async function seedReply(roomId: string, actor: string): Promise<void> {
  await dataAccess!.append([
    { type: 'room.replied', actor, payload: { roomId, body: 'on it' } },
  ]);
}

/** Read the `{ announcements: WireRoom[] }` envelope off a successful list_announcements call. */
function announcementsOf(result: CallToolResult): WireRoom[] {
  return (result.structuredContent as { announcements: WireRoom[] })
    .announcements;
}

/** Read the `{ rooms: WireRoom[] }` envelope off a successful list_rooms call. */
function roomsOf(result: CallToolResult): WireRoom[] {
  return (result.structuredContent as { rooms: WireRoom[] }).rooms;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-list-rooms-int-'));
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

describe('list_announcements / list_rooms over a real MCP client + real ledger (AC #4)', () => {
  it('splits proto vs activated: list_announcements returns the still-proto room, list_rooms the activated one, both seq-ordered', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    // Two proto-rooms (seq order = post order).
    const firstRoom = await post(
      client,
      'calling-interface',
      'Need a reviewer',
    );
    const secondRoom = await post(client, 'calling-interface', 'Wire mapping');
    expect(firstRoom).toBe('need-a-reviewer');
    expect(secondRoom).toBe('wire-mapping');

    // Activate the FIRST room via a port-seeded reply (the reply tool is Story 4.3).
    await seedReply('need-a-reviewer', 'ada');

    // list_announcements → only the still-proto room (wire-mapping), active=false.
    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(ann.isError).toBeFalsy();
    const announcements = announcementsOf(ann);
    expect(announcements.map((r) => r.room_id)).toEqual(['wire-mapping']);
    expect(announcements[0]?.active).toBe(false);
    expect(announcements[0]?.project_id).toBe('calling-interface');
    expect(announcements[0]?.posted_by).toBe('ada');
    expect(announcements[0]?.subject).toBe('Wire mapping');

    // list_rooms → only the activated room (need-a-reviewer), active=true.
    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(rms.isError).toBeFalsy();
    const rooms = roomsOf(rms);
    expect(rooms.map((r) => r.room_id)).toEqual(['need-a-reviewer']);
    expect(rooms[0]?.active).toBe(true);
    expect(rooms[0]?.subject).toBe('Need a reviewer');

    // The JSON text block mirrors structuredContent (the envelope shapes).
    const annText = (ann.content as { type: string; text?: string }[]).find(
      (b) => b.type === 'text',
    );
    expect(JSON.parse(annText?.text ?? '{}')).toMatchObject({
      announcements: [{ room_id: 'wire-mapping', active: false }],
    });
    const rmsText = (rms.content as { type: string; text?: string }[]).find(
      (b) => b.type === 'text',
    );
    expect(JSON.parse(rmsText?.text ?? '{}')).toMatchObject({
      rooms: [{ room_id: 'need-a-reviewer', active: true }],
    });
  });

  it('lists are ordered by seq (announcement order), independent of reply order', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'board');

    // Three proto-rooms in post (=seq) order.
    await post(client, 'board', 'Alpha');
    await post(client, 'board', 'Beta');
    await post(client, 'board', 'Gamma');
    // Activate all three, in a DIFFERENT order than they were posted.
    await seedReply('gamma', 'ada');
    await seedReply('alpha', 'ada');
    await seedReply('beta', 'ada');

    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'board' },
    })) as CallToolResult;
    const rooms = roomsOf(rms);
    // Ordered by the announcement seq, NOT by the reply order.
    expect(rooms.map((r) => r.room_id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rooms.map((r) => r.seq)).toEqual(
      [...rooms.map((r) => r.seq)].sort((a, b) => a - b),
    );
    // Nothing left in announcements (all activated).
    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'board' },
    })) as CallToolResult;
    expect(announcementsOf(ann)).toEqual([]);
  });

  it('scopes each list to its own board: rooms of board A never leak into board B (real MCP surface)', async () => {
    // QA gap (cross-board scoping at the TOOL layer): core's list-rooms.test.ts proves
    // isolation against the in-memory fake; this proves it END-TO-END over the real
    // Client↔McpServer↔SQLite, where every room of both boards lives in ONE shared ledger.
    // A filter bug (forgetting the projectId predicate) would surface here as cross-board
    // leakage even though the core unit test passed.
    const { client } = await connect();
    // ada announces TWO boards (announcing only requires an established identity, not
    // membership of the other board) and seeds a proto + an activated room in EACH.
    await registerAndAnnounce(client, 'ada', 'board-a');
    await client.callTool({
      name: 'announce_project',
      arguments: { title: 'board-b', description: 'the board-b board' },
    });

    await post(client, 'board-a', 'A reviewer'); // a-reviewer (proto on A)
    await post(client, 'board-a', 'A wiring'); // a-wiring (will activate on A)
    await post(client, 'board-b', 'B reviewer'); // b-reviewer (proto on B)
    await post(client, 'board-b', 'B wiring'); // b-wiring (will activate on B)
    await seedReply('a-wiring', 'ada');
    await seedReply('b-wiring', 'ada');

    // Board A's lists contain ONLY board-A rooms.
    const annA = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'board-a' },
    })) as CallToolResult;
    expect(annA.isError).toBeFalsy();
    expect(announcementsOf(annA).map((r) => r.room_id)).toEqual(['a-reviewer']);
    expect(announcementsOf(annA).every((r) => r.project_id === 'board-a')).toBe(
      true,
    );
    const rmsA = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'board-a' },
    })) as CallToolResult;
    expect(roomsOf(rmsA).map((r) => r.room_id)).toEqual(['a-wiring']);
    expect(roomsOf(rmsA).every((r) => r.project_id === 'board-a')).toBe(true);

    // Board B's lists contain ONLY board-B rooms — A's rooms never leak across the wire.
    const annB = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'board-b' },
    })) as CallToolResult;
    expect(announcementsOf(annB).map((r) => r.room_id)).toEqual(['b-reviewer']);
    expect(announcementsOf(annB).every((r) => r.project_id === 'board-b')).toBe(
      true,
    );
    const rmsB = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'board-b' },
    })) as CallToolResult;
    expect(roomsOf(rmsB).map((r) => r.room_id)).toEqual(['b-wiring']);
    expect(roomsOf(rmsB).every((r) => r.project_id === 'board-b')).toBe(true);
  });

  it('an announced board with ZERO announcements returns EMPTY lists (not BOARD_NOT_FOUND) over the real surface', async () => {
    // QA gap (empty-but-existing board at the TOOL layer): distinguishes "board exists but
    // has no rooms" (→ empty arrays, success) from "board never announced" (→ BOARD_NOT_FOUND,
    // covered separately). The existing real-surface empty assertion only fires after all
    // rooms were activated; this proves the existence-vs-emptiness split for a board that
    // never received a single announcement, end-to-end.
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'empty-board'); // announced, never posted to

    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'empty-board' },
    })) as CallToolResult;
    expect(ann.isError).toBeFalsy(); // NOT BOARD_NOT_FOUND — the board exists
    expect(announcementsOf(ann)).toEqual([]);

    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'empty-board' },
    })) as CallToolResult;
    expect(rms.isError).toBeFalsy();
    expect(roomsOf(rms)).toEqual([]);
  });

  it('a SECOND identity that did NOT join the board gets the SAME results (open read, FR9)', async () => {
    // ada announces the board (auto-joined), posts two, activates one — on one connection.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      await post(client, 'calling-interface', 'Need a reviewer');
      await post(client, 'calling-interface', 'Wire mapping');
      await seedReply('need-a-reviewer', 'ada');
    }

    // bob registers on a fresh connection (same real ledger) but never joins the board.
    const { client, session } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });
    expect(session.handle).toBe('bob');

    // A non-member sees the FULL split — identical to what the member would see.
    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(ann.isError).toBeFalsy();
    expect(announcementsOf(ann).map((r) => r.room_id)).toEqual([
      'wire-mapping',
    ]);

    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(rms.isError).toBeFalsy();
    expect(roomsOf(rms).map((r) => r.room_id)).toEqual(['need-a-reviewer']);
  });

  it('list_announcements / list_rooms on an unknown project_id are rejected BOARD_NOT_FOUND', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'no-such-board' },
    })) as CallToolResult;
    expect(ann.isError).toBe(true);
    expect(readErrorPayload(ann)).toMatchObject({ code: 'BOARD_NOT_FOUND' });

    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'no-such-board' },
    })) as CallToolResult;
    expect(rms.isError).toBe(true);
    expect(readErrorPayload(rms)).toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });

  it('with NO established identity, both browse tools return NO_IDENTITY', async () => {
    // A board must exist so the failure is the session gate, not BOARD_NOT_FOUND. Set it up
    // on a separate connection, then browse on a fresh, identity-less connection.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
    }
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const ann = (await client.callTool({
      name: 'list_announcements',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(ann.isError).toBe(true);
    expect(readErrorPayload(ann)).toMatchObject({ code: 'NO_IDENTITY' });

    const rms = (await client.callTool({
      name: 'list_rooms',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(rms.isError).toBe(true);
    expect(readErrorPayload(rms)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('both browse tools advertise the snake_case project_id param on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const name of ['list_announcements', 'list_rooms']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} should be advertised`).toBeDefined();
      const schema = tool!.inputSchema;
      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties ?? {})).toEqual(['project_id']);
      expect(schema.required).toEqual(expect.arrayContaining(['project_id']));
    }
  });
});
