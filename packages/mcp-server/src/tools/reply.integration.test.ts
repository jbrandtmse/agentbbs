// Integration AC #5 (Story 4.3, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the `reply` tool, core's `reply` (room lookup + room.replied
// append + conditional auto-join + read-back), the rooms projection (activation + activator),
// the members projection, and the ledger are all real.
//
// Asserts AC #5 end-to-end for `reply`:
//   - identity A announces a board + posts an announcement (a PROTO-room), then identity B
//     (NOT a member of that board) replies → the room MOVES from list_announcements to
//     list_rooms (active), B is now in the board's list_members (auto-joined), and the
//     room's derived activator is B (activated_by on the active room + on the reply result);
//   - a reply to an unknown room_id is rejected ROOM_NOT_FOUND, nothing appended;
//   - a SECOND reply by an already-member appends a room.replied but NO second board.joined
//     (the board.joined count for that actor stays 1);
//   - two replies to the same room yield two room.replied with sequential seqs and the
//     activator resolves to the lower-seq one (no error).
// plus the NO_IDENTITY (no session) path and the discovery-surface params, over the same
// real transport.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir(). The
// board.joined / room.replied counts are read out-of-band via the REAL ledger
// (eventsByType) — the better-sqlite3 import boundary (lint) forbids opening a raw
// connection from this package, so a correct read-back over the REAL ledger is the evidence.

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
    arguments: { handle, current_focus: 'shipping 4.3' },
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

/** The room_ids in a board's list_announcements (still-proto rooms). */
async function announcementRoomIds(
  client: Client,
  projectId: string,
): Promise<string[]> {
  const result = (await client.callTool({
    name: 'list_announcements',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  // list_announcements wraps its rooms under `announcements` (list_rooms uses `rooms`).
  return (
    result.structuredContent as { announcements: { room_id: string }[] }
  ).announcements.map((r) => r.room_id);
}

/** The rooms in a board's list_rooms (activated rooms), as raw wire objects. */
async function activeRooms(
  client: Client,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const result = (await client.callTool({
    name: 'list_rooms',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { rooms: Record<string, unknown>[] })
    .rooms;
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-reply-int-'));
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

describe('reply over a real MCP client + real ledger (AC #5)', () => {
  it('a NON-MEMBER reply activates the proto-room (list_announcements → list_rooms), auto-joins the replier, and the activator is them', async () => {
    // ada announces calling-interface (auto-joined) + posts a proto-room on it.
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
      // Before any reply: the room is a PROTO-room (in list_announcements, not list_rooms),
      // and the board's only member is ada.
      expect(await announcementRoomIds(client, 'calling-interface')).toEqual([
        roomId,
      ]);
      expect(await activeRooms(client, 'calling-interface')).toHaveLength(0);
      expect(await memberHandles(client, 'calling-interface')).toEqual(['ada']);
    }

    // bob registers on a fresh connection (same real ledger) but NEVER joins the board.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });

    const result = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: 'I can take a look' },
    })) as CallToolResult;

    // The reply succeeds; the returned room is now ACTIVE and activated by bob.
    expect(result.isError).toBeFalsy();
    const room = (result.structuredContent as { room: Record<string, unknown> })
      .room;
    expect(room.room_id).toBe(roomId);
    expect(room.active).toBe(true);
    expect(room.activated_by).toBe('bob');
    expect(typeof room.activated_at_seq).toBe('number');

    // The room MOVED: it is gone from list_announcements and present in list_rooms.
    expect(await announcementRoomIds(client, 'calling-interface')).toEqual([]);
    const active = await activeRooms(client, 'calling-interface');
    expect(active.map((r) => r.room_id)).toEqual([roomId]);
    expect(active[0]?.activated_by).toBe('bob');

    // bob AUTO-JOINED: he is now in the board's member directory (ada first, bob appended).
    expect(await memberHandles(client, 'calling-interface')).toEqual([
      'ada',
      'bob',
    ]);

    // Out-of-band via the REAL ledger: one room.replied (bob) + exactly one board.joined
    // for bob (the auto-join).
    const replies = await dataAccess!.eventsByType('room.replied');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.actor).toBe('bob');
    expect(replies[0]?.payload).toEqual({
      roomId,
      body: 'I can take a look',
    });
    const bobJoins = (await dataAccess!.eventsByType('board.joined')).filter(
      (e) => e.actor === 'bob',
    );
    expect(bobJoins).toHaveLength(1);
    expect(bobJoins[0]?.payload).toEqual({ projectId: 'calling-interface' });
  });

  it('a reply to an unknown room_id is rejected ROOM_NOT_FOUND, nothing appended', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'reply',
      arguments: { room_id: 'no-such-room', body: 'into the void' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    // Nothing appended on the not-found path.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('room.replied')).toHaveLength(0);
  });

  it('a second reply by an ALREADY-MEMBER appends a room.replied but NO second board.joined (count stays 1)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const roomId = await postAnnouncement(
      client,
      'calling-interface',
      'Need a reviewer',
      'first pass',
    );

    // ada is already a member (the announcer). ada replies to her own proto-room, then
    // replies again — neither reply should add a board.joined for ada.
    const baselineAdaJoins = (
      await dataAccess!.eventsByType('board.joined')
    ).filter((e) => e.actor === 'ada').length;
    expect(baselineAdaJoins).toBe(1); // the announce auto-join

    const first = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: 'ada first reply' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();

    const second = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: 'ada second reply' },
    })) as CallToolResult;
    expect(second.isError).toBeFalsy();

    // Two room.replied by ada; still exactly ONE board.joined for ada (no redundant join).
    const adaReplies = (await dataAccess!.eventsByType('room.replied')).filter(
      (e) => e.actor === 'ada',
    );
    expect(adaReplies).toHaveLength(2);

    const adaJoins = (await dataAccess!.eventsByType('board.joined')).filter(
      (e) => e.actor === 'ada',
    );
    expect(adaJoins).toHaveLength(1);
  });

  it('two replies to the same room yield two room.replied with sequential seqs and the activator is the lower-seq one', async () => {
    // ada announces + posts the proto-room.
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

    // bob replies first (activates), then cleo replies (ordinary message); both on fresh
    // identity-bearing connections against the same real ledger.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'x' },
      });
      const r = (await client.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'bob first' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
    }
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'cleo', current_focus: 'y' },
      });
      const r = (await client.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'cleo second' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
    }

    // Two room.replied on the real ledger with strictly increasing seqs (bob before cleo).
    const replies = await dataAccess!.eventsByType('room.replied');
    expect(replies).toHaveLength(2);
    expect(replies[0]?.actor).toBe('bob');
    expect(replies[1]?.actor).toBe('cleo');
    expect(replies[1]!.seq).toBeGreaterThan(replies[0]!.seq);

    // The activated room's derived activator is the LOWER-seq reply (bob), via list_rooms.
    const { client } = await connect();
    await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    });
    const active = await activeRooms(client, 'calling-interface');
    expect(active).toHaveLength(1);
    expect(active[0]?.room_id).toBe(roomId);
    expect(active[0]?.activated_by).toBe('bob');
    expect(active[0]?.activated_at_seq).toBe(replies[0]!.seq);
  });

  it('reply with NO established identity returns NO_IDENTITY and appends nothing', async () => {
    // A room must exist so the failure is the session gate, not ROOM_NOT_FOUND. Set it up
    // on a separate connection, then reply on a fresh, identity-less connection.
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
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: 'should be NO_IDENTITY' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('room.replied')).toHaveLength(0);
  });

  it("the room's history is the announcement first (message #1), then the activator reply by seq (AC #1)", async () => {
    // AC #1: "the original announcement.posted is message #1 of the room's history
    // (announcement first, replies after, by seq)". read_room (4.4) renders this history;
    // the UNDERLYING seq-ordering is assertable now over the real ledger — the announcement
    // that mints the room ALWAYS has a strictly lower seq than the reply that activates it,
    // so the room's own events in seq order are [announcement.posted, room.replied, …].
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
    }
    // bob (non-member) replies → activates. Then cleo replies → a second ordinary message.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'x' },
      });
      const r = (await client.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'bob activates' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
    }
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'cleo', current_focus: 'y' },
      });
      const r = (await client.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'cleo follows up' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
    }

    // Project the room's OWN message history from the real ledger: the announcement.posted
    // for this room + every room.replied for it, in seq order (the authoritative total
    // order every reader sees).
    const all = await dataAccess!.eventsSince(0);
    const history = all.filter(
      (e) =>
        (e.type === 'announcement.posted' &&
          (e.payload as { roomId: string }).roomId === roomId) ||
        (e.type === 'room.replied' &&
          (e.payload as { roomId: string }).roomId === roomId),
    );

    // Exactly three messages: the announcement + two replies.
    expect(history).toHaveLength(3);
    // MESSAGE #1 is the announcement (lowest seq); the rest are the replies.
    expect(history[0]?.type).toBe('announcement.posted');
    expect(history[1]?.type).toBe('room.replied');
    expect(history[2]?.type).toBe('room.replied');
    // Strictly increasing seqs — the announcement strictly precedes every reply, and the
    // replies are in append order (bob the activator, then cleo).
    expect(history[0]!.seq).toBeLessThan(history[1]!.seq);
    expect(history[1]!.seq).toBeLessThan(history[2]!.seq);
    expect(history[1]?.actor).toBe('bob');
    expect(history[2]?.actor).toBe('cleo');

    // Cross-check against the derived room (read via an identity-bearing client): the
    // activator is the FIRST reply (message #2), i.e. the min-seq room.replied — message #1
    // (the announcement) is NOT the activator.
    const { client } = await connect();
    await client.callTool({ name: 'login', arguments: { handle: 'ada' } });
    const rooms = await activeRooms(client, 'calling-interface');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.activated_by).toBe('bob');
    expect(rooms[0]?.activated_at_seq).toBe(history[1]!.seq);
  });

  it('preserves a hostile-markdown / unicode reply body byte-identical through the real ledger (NFR6)', async () => {
    // NFR6 (verbatim content): the reply body is stored and read back EXACTLY — no escaping,
    // normalization, trimming, or markdown processing. Round-trip an adversarial body through
    // the REAL reply tool → real SQLite (JSON-serialized into the payload column) → read-back.
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

    // A deliberately hostile body: markdown control chars, backticks/code fences, a SQL-ish
    // string, JSON metacharacters (quotes/braces/backslashes), a newline + tab, emoji, CJK,
    // RTL text, a combining diacritic, and a zero-width joiner. If ANY layer mangles it
    // (escaping, NFC/NFD normalization, trimming, markdown rendering) the round-trip breaks.
    const hostileBody = [
      '# Heading **bold** _italic_ `code` ~~strike~~',
      '```js\nconst x = "</script>"; // \\backslash\\ "quote" {brace}\n```',
      "Robert'); DROP TABLE events;--",
      'JSON: {"room_id":"x","body":"\\"nested\\""}',
      'tab\there\tand\ttabs',
      'emoji 🙂🚀, CJK 日本語中文, RTL مرحبا עברית',
      'combining: é (é), ZWJ: 👨‍👩‍👧',
      'trailing spaces and a newline preserved   \n',
    ].join('\n');

    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'x' },
    });
    const result = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: hostileBody },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    // Read the room.replied back through the REAL ledger: the stored body is byte-identical
    // (===) to what was sent — no transformation anywhere in reply → mapping → SQLite → read.
    const replies = await dataAccess!.eventsByType('room.replied');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.actor).toBe('bob');
    expect((replies[0]?.payload as { body: string }).body).toBe(hostileBody);
    // And the length matches exactly (guards against silent truncation/normalization).
    expect((replies[0]?.payload as { body: string }).body.length).toBe(
      hostileBody.length,
    );

    // The wire result the client received also carries the verbatim body (the same value
    // round-trips back out through roomToWire on the announcement's body, and the reply body
    // is what we asserted on the ledger above).
    const room = (result.structuredContent as { room: Record<string, unknown> })
      .room;
    expect(room.room_id).toBe(roomId);
    expect(room.active).toBe(true);
  });

  it('advertises snake_case params (room_id, body) on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'reply');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'body',
      'room_id',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['room_id', 'body']),
    );
  });
});
