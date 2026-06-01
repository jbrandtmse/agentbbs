// Integration AC #5 (Story 5.3, Task 3) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2 seam)
// against a genuine SQLite file in an OS temp dir. NOTHING in the stack is mocked: the wire, the
// server, the `read_contract` tool, core's `readContract` (findRoom existence + currentContract),
// the rooms projection, the contract projection, the live-react fold, and the ledger are all real.
//
// Asserts AC #5 end-to-end for `read_contract` (FR21 — the CURRENT AGREED CONTRACT computed,
// never stored):
//   - a room with messages M1 (the announcement, seq a) and M2 (a reply, seq b > a) — seqs
//     CAPTURED from read_room — and a PARTICIPANT (bob, who replied) drives the progression:
//       👍 M1            → read_contract = M1
//       👍 M2            → read_contract = M2   (highest-seq live-👍 wins)
//       retract M2's 👍  → read_contract REVERTS to M1
//       retract M1's 👍  → read_contract = null ("no contract yet")
//     proving reversion needs NO stored state (a fresh query each call);
//   - a BRAND-NEW room with no reactions → contract: null;
//   - a NON-MEMBER identity (never joined, never replied) can read_contract (OPEN read, FR9);
//   - an unknown room_id → ROOM_NOT_FOUND (DISTINCT from contract: null);
//   - plus the NO_IDENTITY (no session) precondition and the discovery-surface param (room_id).
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
  reactions: string[];
}

/**
 * The read_contract envelope shape — used as an INLINE cast target at each call site (an
 * anonymous object literal, mirroring react/reply/read-room integration tests, so the assertion
 * from `structuredContent` (`{ [x: string]: unknown } | undefined`) is accepted by the strict
 * typecheck config — a named interface does not carry the index signature and fails TS2352).
 */
type ContractEnvelope = { room_id: string; contract: WireMessage | null };

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set the session the tools
 * act as. Returns the connected client and the very holder the server's tools read.
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
    arguments: { handle, current_focus: 'shipping 5.3' },
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

/** Read a room's full history (as any established identity); return the messages array. */
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

/** Read a room's current contract (as the connected identity); return the envelope. */
async function readContractEnvelope(
  client: Client,
  roomId: string,
): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'read_contract',
    arguments: { room_id: roomId },
  })) as CallToolResult;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-readcontract-int-'));
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

describe('read_contract over a real MCP client + real ledger (AC #5)', () => {
  it('👍 M1 → M1; 👍 M2 → M2; retract M2 → reverts to M1; retract M1 → null (computed, never stored)', async () => {
    // ada announces calling-interface (auto-joined) + posts a proto-room (M1 = announcement).
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a contract',
        'the announcement (message #1)',
      );
    }

    // bob replies (M2) on a fresh identity-bearing connection — this makes bob a PARTICIPANT
    // (so bob may react to M1 and M2; reacting REQUIRES participation, NOT_A_MEMBER otherwise).
    const { client: bob } = await connect();
    await bob.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'replying' },
    });
    {
      const r = (await bob.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'the reply (message #2)' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
    }

    // CAPTURE the real message seqs from read_room (M1 the announcement, M2 the reply, b > a).
    const messages = await readRoomMessages(bob, roomId);
    expect(messages.map((m) => m.kind)).toEqual(['announcement', 'reply']);
    const m1Seq = messages[0]!.seq;
    const m2Seq = messages[1]!.seq;
    expect(m2Seq).toBeGreaterThan(m1Seq);

    // Before any 👍 → no contract yet.
    {
      const env = (await readContractEnvelope(bob, roomId))
        .structuredContent as ContractEnvelope;
      expect(env.contract).toBeNull();
    }

    // 👍 M1 (bob is a participant) → contract is M1 (the announcement CAN be the contract).
    {
      const react = (await bob.callTool({
        name: 'react',
        arguments: { message_seq: m1Seq },
      })) as CallToolResult;
      expect(react.isError).toBeFalsy();

      const env = (await readContractEnvelope(bob, roomId))
        .structuredContent as ContractEnvelope;
      expect(env.room_id).toBe(roomId);
      expect(env.contract).not.toBeNull();
      expect(env.contract!.seq).toBe(m1Seq);
      expect(env.contract!.kind).toBe('announcement');
      expect(env.contract!.body).toBe('the announcement (message #1)');
      expect(env.contract!.reactions).toEqual(['bob']);
    }

    // 👍 M2 → contract moves to M2 (highest-seq live-👍 wins) even though M1 still holds bob's 👍.
    {
      const react = (await bob.callTool({
        name: 'react',
        arguments: { message_seq: m2Seq },
      })) as CallToolResult;
      expect(react.isError).toBeFalsy();

      const env = (await readContractEnvelope(bob, roomId))
        .structuredContent as ContractEnvelope;
      expect(env.contract!.seq).toBe(m2Seq);
      expect(env.contract!.kind).toBe('reply');
      expect(env.contract!.body).toBe('the reply (message #2)');
    }

    // Retract M2's 👍 → contract REVERTS to M1 (still live-👍'd) — a fresh query, no stored revert.
    {
      const unreact = (await bob.callTool({
        name: 'unreact',
        arguments: { message_seq: m2Seq },
      })) as CallToolResult;
      expect(unreact.isError).toBeFalsy();

      const env = (await readContractEnvelope(bob, roomId))
        .structuredContent as ContractEnvelope;
      expect(env.contract!.seq).toBe(m1Seq);
      expect(env.contract!.kind).toBe('announcement');
    }

    // Retract M1's 👍 → no message holds a live 👍 → contract: null ("no contract yet").
    {
      const unreact = (await bob.callTool({
        name: 'unreact',
        arguments: { message_seq: m1Seq },
      })) as CallToolResult;
      expect(unreact.isError).toBeFalsy();

      const env = (await readContractEnvelope(bob, roomId))
        .structuredContent as ContractEnvelope;
      expect(env.contract).toBeNull();
    }
  });

  it('a brand-new room with no reactions → contract: null', async () => {
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Fresh room',
        'nothing reacted here',
      );
    }
    // ada reads her own fresh proto-room's contract — exists, but no live 👍 → null.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'reader', current_focus: 'reading' },
    });
    const env = (await readContractEnvelope(client, roomId))
      .structuredContent as ContractEnvelope;
    expect(env.room_id).toBe(roomId);
    expect(env.contract).toBeNull();
  });

  it('a NON-MEMBER identity can read_contract (open read, FR9)', async () => {
    // ada announces + posts; bob (participant) replies and 👍s the reply so a contract EXISTS.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Open contract',
        'announcement body',
      );
    }
    let replySeq: number;
    {
      const { client: bob } = await connect();
      await bob.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'replying' },
      });
      const r = (await bob.callTool({
        name: 'reply',
        arguments: { room_id: roomId, body: 'reply body' },
      })) as CallToolResult;
      expect(r.isError).toBeFalsy();
      const messages = await readRoomMessages(bob, roomId);
      replySeq = messages[1]!.seq;
      const react = (await bob.callTool({
        name: 'react',
        arguments: { message_seq: replySeq },
      })) as CallToolResult;
      expect(react.isError).toBeFalsy();
    }

    // dan registers but NEVER joins the board and NEVER replies — a pure non-member reader.
    const { client: dan } = await connect();
    await dan.callTool({
      name: 'register',
      arguments: { handle: 'dan', current_focus: 'just reading' },
    });
    const result = await readContractEnvelope(dan, roomId);
    expect(result.isError).toBeFalsy(); // the OPEN read succeeds for a non-member
    const env = result.structuredContent as ContractEnvelope;
    expect(env.contract).not.toBeNull();
    expect(env.contract!.seq).toBe(replySeq);
    expect(env.contract!.body).toBe('reply body');
    expect(env.contract!.reactions).toEqual(['bob']);
  });

  it('read_contract on an unknown room_id is rejected ROOM_NOT_FOUND (distinct from contract: null)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const result = await readContractEnvelope(client, 'no-such-room');
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('read_contract with NO established identity returns NO_IDENTITY', async () => {
    // A room must exist so the failure is the session gate, not ROOM_NOT_FOUND. Set it up on a
    // separate connection, then read on a fresh, identity-less connection.
    let roomId: string;
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
      roomId = await postAnnouncement(
        client,
        'calling-interface',
        'Need a contract',
        'seed',
      );
    }
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const result = await readContractEnvelope(client, roomId);
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('advertises the snake_case param (room_id) on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'read_contract');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(['room_id']);
    expect(schema.required).toEqual(expect.arrayContaining(['room_id']));
  });
});
