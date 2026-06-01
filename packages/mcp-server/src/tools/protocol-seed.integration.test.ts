// Integration AC #5 (Story 7.2, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2
// seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is mocked: the
// wire, the server, the `register`/`check`/`join_board`/`read_room`/`list_announcements` tools,
// core's `check` (incl. the first-check protocol surface) + `joinBoard` + `readProtocolAnnouncement`,
// the rooms/projects projections, and the ledger are all real. The protocol is seeded by calling
// `seedProtocolAnnouncement(dataAccess)` directly (since `createBoardServer` does NOT seed — the
// seed runs at bootstrap in `main.ts`, Story 7.2 Design decision 5).
//
// Asserts AC #5 end-to-end:
//   - IDEMPOTENT: seed twice → EXACTLY ONE protocol announcement on the real ledger;
//   - FIRST-CHECK SURFACE: a fresh identity registers and calls `check` for the first time →
//     the protocol IS surfaced (the additive `protocol` field), even though it predates her;
//   - NOT RE-SURFACED: a SECOND `check` → the protocol is NOT in the result;
//   - JOIN SURFACE: she `join_board`s a real board → the protocol IS surfaced in the result;
//   - OPEN-READABLE (FR9): the protocol is readable by ANY identity via `read_room
//     how-this-board-works` (the announcement body) AND `list_announcements main` (the proto-room
//     in the reserved main project) — without membership of `main`.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  MAIN_BOARD_PROJECT_ID,
  PROTOCOL_ROOM_ID,
  PROTOCOL_SUBJECT,
  seedProtocolAnnouncement,
} from '@agentbbs/core';
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

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder. Returns the connected client and the holder the
 * server's tools read.
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

/** Register an identity on a connection's session. */
async function register(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'dialing in' },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Call `check` for the session's current identity; return the wire envelope. */
async function check(client: Client): Promise<{
  announcements: { room_id: string }[];
  messages: { room_id: string }[];
  cursor: number;
  protocol?: { room_id: string; subject: string; body: string };
}> {
  const result = (await client.callTool({
    name: 'check',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result.structuredContent as {
    announcements: { room_id: string }[];
    messages: { room_id: string }[];
    cursor: number;
    protocol?: { room_id: string; subject: string; body: string };
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-protocol-seed-int-'));
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

describe('protocol seed + surfacing over a real MCP client + real ledger (AC #5)', () => {
  it('seed is idempotent, first-check + join surface the protocol, and it is open-readable', async () => {
    // --- IDEMPOTENT: seed TWICE against the real ledger → exactly ONE protocol announcement. ---
    await seedProtocolAnnouncement(dataAccess!);
    await seedProtocolAnnouncement(dataAccess!);
    const protocolAnnouncements = (
      await dataAccess!.eventsByType('announcement.posted')
    ).filter((e) => {
      const p = e.payload as { roomId: string };
      return p.roomId === PROTOCOL_ROOM_ID;
    });
    expect(protocolAnnouncements).toHaveLength(1); // idempotent — no duplicate
    // And exactly ONE reserved system identity + ONE reserved main project were created.
    expect(
      (await dataAccess!.eventsByType('identity.registered')).filter(
        (e) => (e.payload as { handle: string }).handle === 'agentbbs',
      ),
    ).toHaveLength(1);
    expect(
      (await dataAccess!.eventsByType('project.announced')).filter(
        (e) =>
          (e.payload as { projectId: string }).projectId ===
          MAIN_BOARD_PROJECT_ID,
      ),
    ).toHaveLength(1);

    // --- FIRST-CHECK SURFACE: a fresh identity's first check surfaces the protocol. ---
    const { client: ada } = await connect();
    await register(ada, 'ada');

    const first = await check(ada);
    expect(first.protocol).toBeDefined();
    expect(first.protocol?.room_id).toBe(PROTOCOL_ROOM_ID);
    expect(first.protocol?.subject).toBe(PROTOCOL_SUBJECT);
    // The surfaced body is the real protocol content (states the four moves + points to the doc).
    expect(first.protocol?.body).toMatch(/Propose/);
    expect(first.protocol?.body).toMatch(/Ratify/);
    expect(first.protocol?.body).toContain('docs/negotiation-protocol.md');

    // --- NOT RE-SURFACED: a second check does NOT carry the protocol. ---
    const second = await check(ada);
    expect(second.protocol).toBeUndefined();

    // --- JOIN SURFACE: ada joins a REAL board → the join result surfaces the protocol. ---
    // A second identity announces an ordinary board for ada to join.
    {
      const { client: boardOwner } = await connect();
      await register(boardOwner, 'owner');
      const announced = (await boardOwner.callTool({
        name: 'announce_project',
        arguments: { title: 'Release Train', description: 'the release board' },
      })) as CallToolResult;
      expect(announced.isError).toBeFalsy();
    }
    const joinResult = (await ada.callTool({
      name: 'join_board',
      arguments: { project_id: 'release-train' },
    })) as CallToolResult;
    expect(joinResult.isError).toBeFalsy();
    const joinEnvelope = joinResult.structuredContent as {
      project_id: string;
      members: string[];
      protocol?: { room_id: string; subject: string };
    };
    expect(joinEnvelope.members).toContain('ada'); // she really joined
    expect(joinEnvelope.protocol).toBeDefined(); // protocol surfaced on join
    expect(joinEnvelope.protocol?.room_id).toBe(PROTOCOL_ROOM_ID);
    expect(joinEnvelope.protocol?.subject).toBe(PROTOCOL_SUBJECT);

    // --- OPEN-READABLE (FR9): ANY identity reads the protocol WITHOUT membership of `main`. ---
    // A THIRD identity who never joined `main` reads it via read_room + list_announcements.
    const { client: reader } = await connect();
    await register(reader, 'reader');

    // read_room how-this-board-works → the announcement is message #1, body = the protocol.
    const roomResult = (await reader.callTool({
      name: 'read_room',
      arguments: { room_id: PROTOCOL_ROOM_ID },
    })) as CallToolResult;
    expect(roomResult.isError).toBeFalsy();
    const roomEnvelope = roomResult.structuredContent as {
      room: { room_id: string; project_id: string; subject: string };
      messages: { kind: string; body: string }[];
    };
    expect(roomEnvelope.room.room_id).toBe(PROTOCOL_ROOM_ID);
    expect(roomEnvelope.room.project_id).toBe(MAIN_BOARD_PROJECT_ID);
    expect(roomEnvelope.messages[0]?.kind).toBe('announcement');
    expect(roomEnvelope.messages[0]?.body).toMatch(/Propose/);

    // list_announcements main → the protocol proto-room is listed (still-proto: no reply yet).
    const listResult = (await reader.callTool({
      name: 'list_announcements',
      arguments: { project_id: MAIN_BOARD_PROJECT_ID },
    })) as CallToolResult;
    expect(listResult.isError).toBeFalsy();
    const listEnvelope = listResult.structuredContent as {
      announcements: { room_id: string }[];
    };
    expect(listEnvelope.announcements.map((a) => a.room_id)).toContain(
      PROTOCOL_ROOM_ID,
    );

    // `reader` is NOT a member of `main` (it only read it openly) — confirm the open read did not
    // require membership: list_members of `main` does not include `reader`.
    const membersResult = (await reader.callTool({
      name: 'list_members',
      arguments: { project_id: MAIN_BOARD_PROJECT_ID },
    })) as CallToolResult;
    expect(membersResult.isError).toBeFalsy();
    const memberHandles = (
      membersResult.structuredContent as {
        members: { handle: string }[];
      }
    ).members.map((m) => m.handle);
    expect(memberHandles).not.toContain('reader'); // read without joining (FR9)
    expect(memberHandles).toContain('agentbbs'); // the system identity is main's member
  });
});
