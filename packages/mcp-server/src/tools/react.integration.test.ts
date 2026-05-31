// Integration AC #5 (Story 5.2, Task 6) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2
// seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is mocked: the
// wire, the server, the `react`/`unreact`/`read_room` tools, core's `react`/`unreact` (message
// resolution + participation gate + idempotent append + read-back), the reactions projection
// (latest-react-wins), and the ledger are all real.
//
// Asserts AC #5 end-to-end for `react`/`unreact`, the live-set transitions observed via
// `read_room`'s per-message `reactions`:
//   - participant A reacts a message → read_room reactions [A]; participant B reacts the SAME
//     message → [A, B]; A unreacts → [B] (A's retraction left B's 👍 intact — AC #2);
//   - a react to a non-message message_seq → MESSAGE_NOT_FOUND, appending nothing;
//   - a react by a NON-participant → NOT_A_MEMBER, appending nothing;
//   - re-react / re-unreact no-ops append NO duplicate message.reacted / message.unreacted
//     (asserted on the real ledger's event counts).
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

/** One message as it appears on the read_room wire (incl. its live 👍 reactors — Story 5.2). */
interface WireMessage {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
  reactions: string[];
}

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can set the session the tools act as.
 * Returns the connected client and the very holder the server's tools read.
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
    arguments: { handle, current_focus: 'shipping 5.2' },
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

/** Register a fresh identity on a NEW connection (same real ledger) and reply to a room. */
async function registerAndReply(
  handle: string,
  roomId: string,
  body: string,
): Promise<void> {
  const { client } = await connect();
  await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'replying' },
  });
  const r = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
}

/**
 * Open a fresh connection and LOGIN as an ALREADY-REGISTERED identity (re-establishing the
 * session as that handle — a second `register` of a taken handle would fail HANDLE_TAKEN and
 * leave the session unestablished). Returns the connected, logged-in client.
 */
async function loginAs(handle: string): Promise<Client> {
  const { client } = await connect();
  const r = (await client.callTool({
    name: 'login',
    arguments: { handle },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
  return client;
}

/** Read a room's messages (the full wire history with reactions) as the given client. */
async function readMessages(
  client: Client,
  roomId: string,
): Promise<WireMessage[]> {
  const result = (await client.callTool({
    name: 'read_room',
    arguments: { room_id: roomId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { messages: WireMessage[] }).messages;
}

/** The live reactors of the message at `messageSeq`, observed via read_room. */
async function reactionsOf(
  client: Client,
  roomId: string,
  messageSeq: number,
): Promise<string[]> {
  const messages = await readMessages(client, roomId);
  const message = messages.find((m) => m.seq === messageSeq);
  expect(message).toBeDefined();
  return message!.reactions;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-react-int-'));
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

describe('react/unreact over a real MCP client + real ledger (AC #5)', () => {
  it('A reacts → [A]; B reacts → [A, B]; A unreacts → [B] (B intact), observed via read_room', async () => {
    // ada announces a board + posts a proto-room; bob and cleo each reply (they become
    // participants). The message under test is cleo's reply (a non-announcement message).
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
    await registerAndReply('bob', roomId, 'I can take a look');
    await registerAndReply('cleo', roomId, 'me too — happy to help');

    // Resolve cleo's reply seq via read_room (a non-member reader works — open read).
    let targetSeq: number;
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'reader', current_focus: 'reading' },
      });
      const messages = await readMessages(client, roomId);
      const cleoMsg = messages.find((m) => m.actor === 'cleo');
      expect(cleoMsg).toBeDefined();
      targetSeq = cleoMsg!.seq;
      // No reactions to begin with.
      expect(cleoMsg!.reactions).toEqual([]);
    }

    // bob (a participant) reacts cleo's reply on his own identity-bearing connection.
    {
      const client = await loginAs('bob');
      const r = (await client.callTool({
        name: 'react',
        arguments: { message_seq: targetSeq },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      // The react tool's own envelope reports the live reactors after the op.
      expect(
        (r.structuredContent as { message_seq: number; reactions: string[] })
          .reactions,
      ).toEqual(['bob']);
      // And read_room shows [bob].
      expect(await reactionsOf(client, roomId, targetSeq)).toEqual(['bob']);
    }

    // cleo (also a participant) reacts the SAME message → [bob, cleo].
    {
      const client = await loginAs('cleo');
      const r = (await client.callTool({
        name: 'react',
        arguments: { message_seq: targetSeq },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(await reactionsOf(client, roomId, targetSeq)).toEqual([
        'bob',
        'cleo',
      ]);
    }

    // bob unreacts → [cleo] (bob's retraction left cleo's 👍 intact — AC #2).
    {
      const client = await loginAs('bob');
      const r = (await client.callTool({
        name: 'unreact',
        arguments: { message_seq: targetSeq },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(
        (r.structuredContent as { reactions: string[] }).reactions,
      ).toEqual(['cleo']);
      expect(await reactionsOf(client, roomId, targetSeq)).toEqual(['cleo']);
    }
  });

  it('a react to a non-message message_seq is rejected MESSAGE_NOT_FOUND, appending nothing', async () => {
    // ada announces + posts; bob replies (a participant) so the failure is the message resolver,
    // not the participation gate.
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
    await registerAndReply('bob', roomId, 'I can take a look');

    const reactedBefore = (await dataAccess!.eventsByType('message.reacted'))
      .length;

    const client = await loginAs('bob');
    // 999999 is far beyond any allocated seq → not a message.
    const r = (await client.callTool({
      name: 'react',
      arguments: { message_seq: 999999 },
    })) as CallToolResult;

    expect(r.isError).toBe(true);
    expect(readErrorPayload(r)).toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    // Nothing appended.
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(
      reactedBefore,
    );
  });

  it('a react to the announcement seq works for a participant, but the announcer (never replied) gets NOT_A_MEMBER', async () => {
    // The announcement (message #1) IS a message; reacting it requires participating in its room.
    let roomId: string;
    let announcementSeq: number;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
      const messages = await readMessages(client, roomId);
      announcementSeq = messages[0]!.seq; // the announcement is message #1
    }
    // bob replies → becomes a participant.
    await registerAndReply('bob', roomId, 'I can take a look');

    // ada ANNOUNCED but never replied → NOT a participant → reacting the announcement = NOT_A_MEMBER.
    {
      const client = await loginAs('ada');
      const r = (await client.callTool({
        name: 'react',
        arguments: { message_seq: announcementSeq },
      })) as CallToolResult;
      expect(r.isError).toBe(true);
      expect(readErrorPayload(r)).toMatchObject({ code: 'NOT_A_MEMBER' });
    }

    // bob (a participant) CAN react the announcement.
    {
      const client = await loginAs('bob');
      const r = (await client.callTool({
        name: 'react',
        arguments: { message_seq: announcementSeq },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      expect(await reactionsOf(client, roomId, announcementSeq)).toEqual([
        'bob',
      ]);
    }
  });

  it('a react by a NON-participant (a registered bystander) is rejected NOT_A_MEMBER, appending nothing', async () => {
    let roomId: string;
    let targetSeq: number;
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
    await registerAndReply('bob', roomId, 'bob reply');
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'reader', current_focus: 'reading' },
      });
      const messages = await readMessages(client, roomId);
      targetSeq = messages.find((m) => m.actor === 'bob')!.seq;
    }

    const reactedBefore = (await dataAccess!.eventsByType('message.reacted'))
      .length;

    // dave registers but NEVER joins/replies → a pure non-participant.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'dave', current_focus: 'bystander' },
    });
    const r = (await client.callTool({
      name: 'react',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;

    expect(r.isError).toBe(true);
    expect(readErrorPayload(r)).toMatchObject({ code: 'NOT_A_MEMBER' });
    // Nothing appended.
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(
      reactedBefore,
    );
  });

  it('re-react / re-unreact no-ops append NO duplicate message.reacted / message.unreacted (ledger counts)', async () => {
    let roomId: string;
    let targetSeq: number;
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
    await registerAndReply('bob', roomId, 'bob reply');
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'reader', current_focus: 'reading' },
      });
      targetSeq = (await readMessages(client, roomId)).find(
        (m) => m.actor === 'bob',
      )!.seq;
    }

    const client = await loginAs('bob');

    // First react appends exactly one message.reacted.
    let r = (await client.callTool({
      name: 'react',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(1);

    // Re-react (already live) → idempotent no-op: STILL exactly one message.reacted.
    r = (await client.callTool({
      name: 'react',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(1);
    expect(await reactionsOf(client, roomId, targetSeq)).toEqual(['bob']);

    // First unreact appends exactly one message.unreacted.
    r = (await client.callTool({
      name: 'unreact',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect((await dataAccess!.eventsByType('message.unreacted')).length).toBe(
      1,
    );

    // Re-unreact (not live) → idempotent no-op: STILL exactly one message.unreacted.
    r = (await client.callTool({
      name: 'unreact',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    expect((await dataAccess!.eventsByType('message.unreacted')).length).toBe(
      1,
    );
    expect(await reactionsOf(client, roomId, targetSeq)).toEqual([]);

    // The message.reacted count is still 1 (the no-ops never appended; append-only — neither
    // event was mutated/removed).
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(1);
  });

  it('react with NO established identity returns NO_IDENTITY', async () => {
    // A message must exist so the failure is the session gate, not MESSAGE_NOT_FOUND.
    let roomId: string;
    let targetSeq: number;
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
    await registerAndReply('bob', roomId, 'bob reply');
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'reader', current_focus: 'reading' },
      });
      targetSeq = (await readMessages(client, roomId)).find(
        (m) => m.actor === 'bob',
      )!.seq;
    }

    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const r = (await client.callTool({
      name: 'react',
      arguments: { message_seq: targetSeq },
    })) as CallToolResult;
    expect(r.isError).toBe(true);
    expect(readErrorPayload(r)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('rejects a non-positive / non-integer message_seq at the Zod boundary BEFORE core — isError, NO closed code', async () => {
    // Boundary parity: message_seq is z.number().int().positive(), so 0 / negative / fractional
    // is rejected at the Zod boundary BEFORE the delegate — a Zod validation rejection (no closed
    // board code), distinct from MESSAGE_NOT_FOUND (a well-formed-but-not-a-message seq that
    // reaches core). Nothing is appended.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
    }
    const reactedBefore = (await dataAccess!.eventsByType('message.reacted'))
      .length;

    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'reacting' },
    });
    for (const badSeq of [0, -1, 1.5]) {
      const r = (await client.callTool({
        name: 'react',
        arguments: { message_seq: badSeq },
      })) as CallToolResult;
      expect(r.isError).toBe(true);
      // A Zod validation rejection, NOT a domain error — no closed board code.
      expect(readErrorPayload(r)).toBeUndefined();
    }
    expect((await dataAccess!.eventsByType('message.reacted')).length).toBe(
      reactedBefore,
    );
  });

  it('advertises the snake_case param (message_seq) on the discovery surface for react + unreact', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ['react', 'unreact']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema;
      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties ?? {})).toEqual(['message_seq']);
      expect(schema.required).toEqual(expect.arrayContaining(['message_seq']));
    }
  });
});
