// Integration AC #4 (Story 5.1, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the `reply` / `post_announcement` / `read_room` tools,
// core's body-cap (`assertBodyWithinCap` / `MAX_BODY_BYTES`), the rooms + message-history
// projections, and the ledger are all real.
//
// Asserts the FORMAL 256 KB body cap + verbatim storage end-to-end (AC #1/#2/#3/#4):
//   - a member posts a `reply` AND a `post_announcement` with an AT-CAP (262144-byte)
//     multi-paragraph Markdown/unicode body → each is stored VERBATIM: `read_room` returns
//     the body `===` byte-for-byte with the EXACT same UTF-8 byte length (the strongest
//     near-cap evidence — the largest legal body, unmodified);
//   - a `reply` AND a `post_announcement` with a body just OVER the cap (one byte past) are
//     EACH rejected with the closed `BODY_TOO_LARGE` code (NOT a Zod rejection — the closed
//     code proves the check is core's, not the dropped Zod `.max`), and append NOTHING
//     (the room.replied / announcement.posted event counts are unchanged);
//   - a NON-member's `post_announcement` is rejected `NOT_A_MEMBER` (the Story 4.1 sub-board
//     posting gate reaffirmed — "the Epic 3/4 gating"; `reply` has no NOT_A_MEMBER path by
//     design, "acting = joining", so the gate lives on the membership-GATED post surface).
//
// Bodies are built PROGRAMMATICALLY (a unicode/Markdown prefix padded with ASCII to an exact
// byte length) so the at-cap / over-cap boundary is precise. Never touches the repo's real
// `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { MAX_BODY_BYTES } from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** One message as it appears on the read_room wire (snake_case is a no-op for these fields). */
interface WireMessage {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
}

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/**
 * A multi-paragraph Markdown + unicode body whose UTF-8 byte length is EXACTLY
 * `byteTarget`. A fixed unicode/Markdown prefix (code fences, emoji, CJK, RTL, combining
 * marks, control whitespace — the verbatim-fidelity surface) is padded with ASCII `a` so the
 * total UTF-8 byte length lands precisely on the target (the prefix is multi-byte, so the
 * pad count is `byteTarget − prefixByteLength`, each pad char being one byte).
 */
function bodyOfExactBytes(byteTarget: number): string {
  const prefix = [
    '# Proposal **bold** _italic_ `code`',
    '',
    'A multi-paragraph negotiation body with a fenced block:',
    '',
    '```ts',
    'const x: Record<string, unknown> = { "k": [1, 2, 3], a: "b\\\\c" };',
    '```',
    '',
    'Unicode: café — 日本語中文 — RTL مرحبا עברית — emoji 🚀🛰️ — combining é — ZWJ 👨‍👩‍👧',
    'Trailing whitespace + tab kept:\tend.   ',
    '',
    '---',
    'Padding follows to reach the exact byte target: ',
  ].join('\n');
  const prefixBytes = Buffer.byteLength(prefix, 'utf8');
  const pad = 'a'.repeat(byteTarget - prefixBytes); // ASCII → 1 byte each
  const body = prefix + pad;
  // Guard: the helper must hit the target exactly (the tests rely on the precise boundary).
  if (Buffer.byteLength(body, 'utf8') !== byteTarget) {
    throw new Error(
      `bodyOfExactBytes: built ${Buffer.byteLength(body, 'utf8')} bytes, wanted ${byteTarget}`,
    );
  }
  return body;
}

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
    arguments: { handle, current_focus: 'shipping 5.1' },
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
): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body },
  })) as CallToolResult;
}

/** Read a room's full ordered message history via the real read_room tool. */
async function readRoomMessages(
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-bodycap-int-'));
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

describe('body cap + verbatim storage over a real MCP client + real ledger (AC #4)', () => {
  it('an AT-CAP (256 KB) reply body is stored VERBATIM — read_room returns it byte-for-byte (=== + exact UTF-8 byte length)', async () => {
    // ada announces + posts a proto-room; bob replies with an at-cap multi-paragraph body.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      const posted = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
      expect(posted.isError).toBeFalsy();
      roomId = (posted.structuredContent as { room: { room_id: string } }).room
        .room_id;
    }

    const atCapBody = bodyOfExactBytes(MAX_BODY_BYTES);
    expect(Buffer.byteLength(atCapBody, 'utf8')).toBe(MAX_BODY_BYTES);

    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'replying' },
    });
    const replyResult = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: atCapBody },
    })) as CallToolResult;
    expect(replyResult.isError).toBeFalsy();

    // read_room returns the reply body BYTE-FOR-BYTE — no escaping, normalization, trim,
    // markdown processing, or truncation anywhere in reply → mapping → SQLite → read.
    const messages = await readRoomMessages(client, roomId);
    const replyMsg = messages.find(
      (m) => m.actor === 'bob' && m.kind === 'reply',
    );
    expect(replyMsg).toBeDefined();
    expect(replyMsg!.body).toBe(atCapBody); // === byte-for-byte
    expect(Buffer.byteLength(replyMsg!.body, 'utf8')).toBe(MAX_BODY_BYTES); // exact byte length
    expect(replyMsg!.body.length).toBe(atCapBody.length); // exact code-unit length too

    // And the durable room.replied carries the identical body (the ledger source of truth).
    const replies = await dataAccess!.eventsByType('room.replied');
    expect(replies).toHaveLength(1);
    expect((replies[0]?.payload as { body: string }).body).toBe(atCapBody);
  });

  it('an AT-CAP (256 KB) announcement body is stored VERBATIM — read_room message #1 returns it byte-for-byte', async () => {
    const atCapBody = bodyOfExactBytes(MAX_BODY_BYTES);
    expect(Buffer.byteLength(atCapBody, 'utf8')).toBe(MAX_BODY_BYTES);

    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const posted = await postAnnouncement(
      client,
      'calling-interface',
      'Big proposal',
      atCapBody,
    );
    expect(posted.isError).toBeFalsy();
    const roomId = (posted.structuredContent as { room: { room_id: string } })
      .room.room_id;

    // The seeding announcement is message #1 of the room's history; its body is verbatim.
    const messages = await readRoomMessages(client, roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe('announcement');
    expect(messages[0]?.body).toBe(atCapBody); // === byte-for-byte
    expect(Buffer.byteLength(messages[0]!.body, 'utf8')).toBe(MAX_BODY_BYTES);

    // The returned proto-room ALSO carries the verbatim body, and the durable event matches.
    expect(
      (posted.structuredContent as { room: { body: string } }).room.body,
    ).toBe(atCapBody);
    const announcements = await dataAccess!.eventsByType('announcement.posted');
    expect(announcements).toHaveLength(1);
    expect((announcements[0]?.payload as { body: string }).body).toBe(
      atCapBody,
    );
  });

  it('a reply body just OVER the cap is rejected BODY_TOO_LARGE (closed code) and appends NOTHING', async () => {
    // Establish a real, active room so the failure is the cap, not ROOM_NOT_FOUND, and so
    // there is an existing room.replied whose count must stay UNCHANGED by the over-cap call.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      const posted = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed',
      );
      roomId = (posted.structuredContent as { room: { room_id: string } }).room
        .room_id;
    }
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'replying' },
    });
    // A valid reply activates the room → exactly one room.replied exists from here.
    const ok = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: 'I can take a look' },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    expect(await dataAccess!.eventsByType('room.replied')).toHaveLength(1);

    const overCapBody = bodyOfExactBytes(MAX_BODY_BYTES + 1);
    expect(Buffer.byteLength(overCapBody, 'utf8')).toBe(MAX_BODY_BYTES + 1);
    const before = await dataAccess!.maxSeq();

    const rejected = (await client.callTool({
      name: 'reply',
      arguments: { room_id: roomId, body: overCapBody },
    })) as CallToolResult;

    expect(rejected.isError).toBe(true);
    // The CLOSED board code — proving the check is core's, not the dropped Zod `.max` (a Zod
    // rejection would yield readErrorPayload === undefined, per Story 5.0).
    expect(readErrorPayload(rejected)).toMatchObject({
      code: 'BODY_TOO_LARGE',
    });
    // NOTHING appended: the ledger did not grow and the room.replied count is unchanged.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('room.replied')).toHaveLength(1);
  });

  it('an announcement body just OVER the cap is rejected BODY_TOO_LARGE (closed code) and appends NOTHING', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const before = await dataAccess!.maxSeq();

    const overCapBody = bodyOfExactBytes(MAX_BODY_BYTES + 1);
    expect(Buffer.byteLength(overCapBody, 'utf8')).toBe(MAX_BODY_BYTES + 1);

    const rejected = await postAnnouncement(
      client,
      'calling-interface',
      'Too big',
      overCapBody,
    );

    expect(rejected.isError).toBe(true);
    expect(readErrorPayload(rejected)).toMatchObject({
      code: 'BODY_TOO_LARGE',
    });
    // Nothing appended — no announcement.posted, ledger unchanged (the proto-room never opened).
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });

  it("a NON-member's post_announcement is rejected NOT_A_MEMBER (Epic 3/4 sub-board posting gate reaffirmed)", async () => {
    // ada announces the board (auto-joined) on one connection.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
    }
    // bob registers on a fresh connection (same real ledger) but NEVER joins the board.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });
    const before = await dataAccess!.maxSeq();

    // A within-cap body — so the rejection is unambiguously the membership gate, not the cap.
    const rejected = await postAnnouncement(
      client,
      'calling-interface',
      'Broadcasting a need',
      'a normal-sized body — should be rejected for membership, not size',
    );

    expect(rejected.isError).toBe(true);
    expect(readErrorPayload(rejected)).toMatchObject({ code: 'NOT_A_MEMBER' });
    // Nothing appended on the gate rejection.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });
});
