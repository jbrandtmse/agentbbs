// Integration AC #6 (Story 4.4, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the `read_room` tool, core's `readRoom` (room lookup +
// roomMessages history fold), the rooms projection, the message-history projection, and the
// ledger are all real.
//
// Asserts AC #6 end-to-end for `read_room`:
//   - identity A announces a board + posts an announcement (a PROTO-room), then two
//     identities B and C reply, and a THIRD identity D (NOT a member, NEVER replied) calls
//     read_room → D receives [announcement(#1), reply, reply] in seq order with byte-identical
//     bodies (the OPEN read works WITHOUT membership, FR9);
//   - read_room on an unknown room_id is rejected ROOM_NOT_FOUND;
//   - re-reading the SAME room after an additional reply returns the SAME earlier messages
//     plus the new one appended at the end (NO truncation — AC #4);
//   - a PROTO-room (announcement, no reply) → a single announcement message, active=false (AC #5);
// plus the NO_IDENTITY (no session) precondition and the discovery-surface params (room_id),
// over the same real transport.
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

/** One message as it appears on the read_room wire (snake_case is a no-op for these fields). */
interface WireMessage {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
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
    arguments: { handle, current_focus: 'shipping 4.4' },
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-readroom-int-'));
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

describe('read_room over a real MCP client + real ledger (AC #6)', () => {
  it('a NON-MEMBER third identity reads [announcement(#1), reply, reply] in seq order, bodies byte-identical (open read, FR9)', async () => {
    const announcementBody = 'looking for a second pair of eyes';
    const bobBody = 'I can take a look';
    const cleoBody = 'me too — happy to help';

    // ada announces calling-interface (auto-joined) + posts a proto-room on it.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        announcementBody,
      );
    }
    // bob then cleo reply (each a fresh identity-bearing connection on the same ledger).
    await registerAndReply('bob', roomId, bobBody);
    await registerAndReply('cleo', roomId, cleoBody);

    // dan registers but NEVER joins the board and NEVER replies — a pure non-member reader.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'dan', current_focus: 'just reading' },
    });

    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;

    // The OPEN read succeeds for the non-member.
    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      room: Record<string, unknown>;
      messages: WireMessage[];
    };

    // Room metadata accompanies the history: subject is the room's (carried once), active,
    // activated by the min-seq reply (bob).
    expect(envelope.room.room_id).toBe(roomId);
    expect(envelope.room.subject).toBe('Need a reviewer');
    expect(envelope.room.active).toBe(true);
    expect(envelope.room.activated_by).toBe('bob');

    // The COMPLETE ordered history: announcement (#1), then the two replies — by seq.
    const messages = envelope.messages;
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.kind)).toEqual([
      'announcement',
      'reply',
      'reply',
    ]);
    expect(messages.map((m) => m.actor)).toEqual(['ada', 'bob', 'cleo']);
    // Bodies are BYTE-IDENTICAL to what was posted (no transformation through the stack).
    expect(messages.map((m) => m.body)).toEqual([
      announcementBody,
      bobBody,
      cleoBody,
    ]);
    // Strictly increasing seqs — message #1 (the announcement) strictly precedes both replies.
    expect(messages[0]!.seq).toBeLessThan(messages[1]!.seq);
    expect(messages[1]!.seq).toBeLessThan(messages[2]!.seq);
    // Message #1's seq IS the room's announcement seq (the room metadata's seq).
    expect(messages[0]!.seq).toBe(envelope.room.seq);
    // The activator's reply is message #2 — its seq equals the room's activated_at_seq.
    expect(messages[1]!.seq).toBe(envelope.room.activated_at_seq);
  });

  it('read_room on an unknown room_id is rejected ROOM_NOT_FOUND', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: 'no-such-room' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('rejects a malformed room_id (empty / non-slug charset) at the Zod boundary BEFORE core — isError, NOT ROOM_NOT_FOUND (READ-side parity, deferred-work 4.3-a)', async () => {
    // READ-tool parity for the family-wide boundary-rejection coverage: read_room reuses the
    // SAME roomIdSchema as reply / add_participant, so an empty / non-slug room_id is rejected
    // at the Zod boundary BEFORE core — a Zod validation rejection (no closed board code),
    // distinct from the ROOM_NOT_FOUND case above (a well-formed-but-unknown id that reaches
    // core's existence check). read_room is a pure read (it never appends), so the boundary
    // guarantee here is "rejected, no closed code" rather than a ledger delta.
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    for (const badRoomId of ['', '   ', 'Bad Room!', 'UPPER', 'a..b']) {
      const result = (await client.callTool({
        name: 'read_room',
        arguments: { room_id: badRoomId },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      // A Zod validation rejection, NOT a domain error — no closed board code (contrast the
      // ROOM_NOT_FOUND case above).
      expect(readErrorPayload(result)).toBeUndefined();
    }
  });

  it('re-reading after an additional reply returns the SAME earlier messages plus the new one appended (no truncation, AC #4)', async () => {
    // ada announces + posts; bob replies (activates).
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'seed body',
      );
    }
    await registerAndReply('bob', roomId, 'bob first');

    // First read (as a non-member reader, dan) — captures the history so far.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'dan', current_focus: 'reading' },
    });
    const firstResult = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(firstResult.isError).toBeFalsy();
    const firstMessages = (
      firstResult.structuredContent as { messages: WireMessage[] }
    ).messages;
    expect(firstMessages.map((m) => m.body)).toEqual([
      'seed body',
      'bob first',
    ]);

    // Another reply lands on the real ledger (append-only).
    await registerAndReply('cleo', roomId, 'cleo second');

    // Re-read on the SAME connection/identity — the history GREW, nothing truncated.
    const secondResult = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(secondResult.isError).toBeFalsy();
    const secondMessages = (
      secondResult.structuredContent as { messages: WireMessage[] }
    ).messages;

    // The re-read STARTS WITH the earlier messages verbatim (same order, same seqs, same
    // bodies), then the new message appended at the end — monotonic growth, no truncation.
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(
      firstMessages,
    );
    expect(secondMessages).toHaveLength(firstMessages.length + 1);
    expect(secondMessages[secondMessages.length - 1]).toMatchObject({
      actor: 'cleo',
      body: 'cleo second',
      kind: 'reply',
    });
  });

  it('a PROTO-room (announcement, no reply) reads as a single announcement message, active=false (AC #5)', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'proto seed body',
      );
    }

    // bob (non-member, never replied) reads the still-proto room — it is readable (FR9).
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'reading' },
    });
    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    const envelope = result.structuredContent as {
      room: Record<string, unknown>;
      messages: WireMessage[];
    };
    // Proto-room metadata: active=false, no activator key on the wire.
    expect(envelope.room.active).toBe(false);
    expect(envelope.room.activated_by).toBeUndefined();
    expect(envelope.room.activated_at_seq).toBeUndefined();

    // Exactly one message — the seeding announcement (its body, kind=announcement).
    expect(envelope.messages).toHaveLength(1);
    expect(envelope.messages[0]).toMatchObject({
      actor: 'ada',
      body: 'proto seed body',
      kind: 'announcement',
    });
    expect(envelope.messages[0]!.seq).toBe(envelope.room.seq);
  });

  it('read_room with NO established identity returns NO_IDENTITY', async () => {
    // A room must exist so the failure is the session gate, not ROOM_NOT_FOUND. Set it up on
    // a separate connection, then read on a fresh, identity-less connection.
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

    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('preserves a hostile-markdown / unicode body byte-identical through read_room (NFR6)', async () => {
    // NFR6 (verbatim content): the announcement + reply bodies are stored and read back
    // EXACTLY through read_room — no escaping, normalization, trimming, or markdown
    // processing. Round-trip adversarial bodies through the REAL tools → real SQLite →
    // read_room.
    const hostileAnnouncement = [
      '# Heading **bold** `code` ~~strike~~',
      '```js\nconst x = "</script>"; // \\backslash\\ {brace}\n```',
      "Robert'); DROP TABLE events;--",
      'emoji 🙂🚀, CJK 日本語中文, RTL مرحبا עברית, ZWJ 👨‍👩‍👧',
      'trailing spaces   \n',
    ].join('\n');
    const hostileReply = 'reply: {"k":"\\"v\\""}\ttab\némoji 🌍 中文';

    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        hostileAnnouncement,
      );
    }
    await registerAndReply('bob', roomId, hostileReply);

    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'cleo', current_focus: 'reading' },
    });
    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    const messages = (result.structuredContent as { messages: WireMessage[] })
      .messages;
    expect(messages).toHaveLength(2);
    // Byte-identical (===) round-trip of both the announcement (#1) and the reply.
    expect(messages[0]!.body).toBe(hostileAnnouncement);
    expect(messages[0]!.body.length).toBe(hostileAnnouncement.length);
    expect(messages[1]!.body).toBe(hostileReply);
    expect(messages[1]!.body.length).toBe(hostileReply.length);
  });

  it('advertises the snake_case param (room_id) on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'read_room');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(['room_id']);
    expect(schema.required).toEqual(expect.arrayContaining(['room_id']));
  });

  // QA addition (AC #1): cross-room isolation is proven at the projection + op layers
  // (room-history.test.ts / read-room.test.ts) against in-memory fakes, but NOT over the
  // REAL MCP surface where the REAL SQLite seq allocator interleaves two rooms' appends.
  // This pins that read_room(A) returns ONLY A's messages, strictly seq-ordered (the
  // announcement #1 then A's replies), with EVERY one of B's messages absent — and the
  // reciprocal for B — when replies to A and B are physically interleaved on one ledger.
  it('read_room(A) returns ONLY room A’s messages (seq-ordered) when replies to A and B are interleaved on one real ledger (AC #1)', async () => {
    // Two proto-rooms on the SAME board, posted by the same member.
    let roomA: string;
    let roomB: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomA = await postAnnouncement(
        client,
        'calling-interface',
        'Room A subject',
        'A seed',
      );
      roomB = await postAnnouncement(
        client,
        'calling-interface',
        'Room B subject',
        'B seed',
      );
      // Distinct ids — the two announcements must mint two separate rooms.
      expect(roomA).not.toBe(roomB);
    }

    // Interleave replies across the two rooms on the real ledger, so their seqs are woven
    // together (A, B, A, B, A): a per-room read must NOT pick up the other room's seqs.
    await registerAndReply('bob', roomA, 'A reply one'); // → A
    await registerAndReply('cleo', roomB, 'B reply one'); // → B
    await registerAndReply('dan', roomA, 'A reply two'); // → A
    await registerAndReply('eve', roomB, 'B reply two'); // → B
    await registerAndReply('fay', roomA, 'A reply three'); // → A

    // A pure non-member reader reads each room.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'gil', current_focus: 'just reading' },
    });

    const readA = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomA },
    })) as CallToolResult;
    expect(readA.isError).toBeFalsy();
    const aMessages = (readA.structuredContent as { messages: WireMessage[] })
      .messages;

    const readB = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomB },
    })) as CallToolResult;
    expect(readB.isError).toBeFalsy();
    const bMessages = (readB.structuredContent as { messages: WireMessage[] })
      .messages;

    // Room A: announcement #1 then its three replies, in seq order, ONLY A's bodies/actors.
    expect(aMessages.map((m) => m.kind)).toEqual([
      'announcement',
      'reply',
      'reply',
      'reply',
    ]);
    expect(aMessages.map((m) => m.body)).toEqual([
      'A seed',
      'A reply one',
      'A reply two',
      'A reply three',
    ]);
    expect(aMessages.map((m) => m.actor)).toEqual(['ada', 'bob', 'dan', 'fay']);

    // Room B: announcement #1 then its two replies — ONLY B's.
    expect(bMessages.map((m) => m.kind)).toEqual([
      'announcement',
      'reply',
      'reply',
    ]);
    expect(bMessages.map((m) => m.body)).toEqual([
      'B seed',
      'B reply one',
      'B reply two',
    ]);
    expect(bMessages.map((m) => m.actor)).toEqual(['ada', 'cleo', 'eve']);

    // Strictly seq-ascending within each room (the interleaving did NOT scramble order).
    const aSeqs = aMessages.map((m) => m.seq);
    const bSeqs = bMessages.map((m) => m.seq);
    expect([...aSeqs].sort((x, y) => x - y)).toEqual(aSeqs);
    expect([...bSeqs].sort((x, y) => x - y)).toEqual(bSeqs);

    // No leakage either direction: A and B share NO message seq (the two histories are
    // disjoint even though their seqs are interleaved on the shared ledger).
    const bSeqSet = new Set(bSeqs);
    expect(aSeqs.some((s) => bSeqSet.has(s))).toBe(false);
    // And none of B's bodies appear in A's history (belt-and-suspenders on isolation).
    const aBodies = new Set(aMessages.map((m) => m.body));
    expect(bMessages.every((m) => !aBodies.has(m.body))).toBe(true);
  });

  // QA addition (AC #1 / Design decision 1 — Epic 5 readiness): the existing tests pin only
  // message #1's seq (== room.seq) and message #2's (== room.activated_at_seq, the ACTIVATOR).
  // Epic 5's `message.reacted.messageSeq` must be able to reference ANY message, so the seq of
  // a NON-activator reply (message #3+) must ALSO equal its underlying room.replied event's
  // seq. The `reply` tool's wire does not expose a non-activator reply's own seq, so the only
  // observable is read_room itself — this pins that the THIRD message's seq is the genuine
  // event seq (strictly beyond the activator, the messages strictly seq-ascending and
  // contiguous with their reply order), i.e. each message carries a stable, reference-able seq.
  it('each message’s seq equals its underlying event seq — incl. a non-activator reply #3 (Epic 5 referenceability, AC #1)', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a reviewer',
        'announcement seed',
      );
    }

    // bob's reply ACTIVATES the room — capture the activator seq the reply tool returns
    // (this is the room's activated_at_seq, i.e. message #2's seq).
    let activatorSeq: number;
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'replying' },
      });
      const r = (await client.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'bob activates' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      activatorSeq = (
        r.structuredContent as { room: { activated_at_seq: number } }
      ).room.activated_at_seq;
      expect(activatorSeq).toBeTypeOf('number');
    }

    // Two more replies — cleo (#3) and dan (#4) are NON-activators (their seqs are NOT
    // surfaced by the reply tool's wire; read_room is the only place to observe them).
    await registerAndReply('cleo', roomId, 'cleo third');
    await registerAndReply('dan', roomId, 'dan fourth');

    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'eve', current_focus: 'reading' },
    });
    const result = (await client.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      room: { seq: number; activated_at_seq: number };
      messages: WireMessage[];
    };
    const messages = envelope.messages;

    // [announcement, bob, cleo, dan] — four messages.
    expect(messages.map((m) => m.actor)).toEqual(['ada', 'bob', 'cleo', 'dan']);

    // Message #1's seq IS the room's announcement seq; message #2's IS the activator seq
    // (both already pinned elsewhere — re-anchored here as the baseline for #3/#4).
    expect(messages[0]!.seq).toBe(envelope.room.seq);
    expect(messages[1]!.seq).toBe(activatorSeq);
    expect(envelope.room.activated_at_seq).toBe(activatorSeq);

    // THE NEW GUARANTEE: the NON-activator replies (#3 cleo, #4 dan) each carry a genuine,
    // strictly-increasing event seq beyond the activator — the seq Epic 5's react targets.
    expect(messages[2]!.seq).toBeGreaterThan(activatorSeq); // cleo (non-activator)
    expect(messages[3]!.seq).toBeGreaterThan(messages[2]!.seq); // dan (non-activator)

    // All four message seqs are strictly ascending AND distinct — a stable per-message id
    // (each reference-able by a future message.reacted.messageSeq).
    const seqs = messages.map((m) => m.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
