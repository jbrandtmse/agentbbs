// Integration AC #5 (Story 6.1, Task 5) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2
// seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is mocked: the
// wire, the server, the `check` tool, core's `check` (cursor read/advance + the membership /
// participation / floor folds + the recordSeen presence ping), the projects/rooms projections,
// the per-board + per-room join floors, the STORED cursors table, and the ledger are all real.
//
// Asserts AC #5 end-to-end for `check`:
//   - FIRST-CHECK-NO-FLOOD: announcer A2 announces board B and posts an OLD announcement
//     (a proto-room) BEFORE A joins. A then registers, joins B (which now has that old
//     announcement), and calls check → A's first check does NOT surface B's pre-join
//     announcement (the per-board floor = A's join seq), A's last_seen ADVANCED (cross-checked
//     via list_members) and A's cursor ADVANCED past the join;
//   - DELTA ON NEW ACTIVITY: a NEW announcement in B (posted after A joined) AND a NEW reply
//     in a room A PARTICIPATES in are returned by A's NEXT check (scoped + seq-ordered), after
//     which the cursor advanced;
//   - EMPTY DELTA: a THIRD check with no new activity returns [] / [] with the cursor UNCHANGED;
//   - NO_IDENTITY: a non-registered session → NO_IDENTITY.
//
// last_seen is cross-checked via list_members (the AC's named consumer); to make the "advanced"
// assertion collision-proof against same-millisecond timestamps, the count of identity.seen
// events on the REAL ledger (read out-of-band via eventsByActor — the better-sqlite3 import
// boundary forbids a raw connection from this package) is the primary presence proof, with the
// list_members timestamp as the AC-named cross-check.
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

/** Register an identity on a connection's session. */
async function register(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'dialing in' },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Announce a sub-board as the session's current identity. */
async function announce(client: Client, projectId: string): Promise<void> {
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
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body: `body for ${subject}` },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

/** Reply to a room as the session's current identity (activates / participates). */
async function reply(
  client: Client,
  roomId: string,
  body: string,
): Promise<void> {
  const result = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** Join a sub-board as the session's current identity. */
async function joinBoard(client: Client, projectId: string): Promise<void> {
  const result = (await client.callTool({
    name: 'join_board',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** Call `check` for the session's current identity; return the wire envelope. */
async function check(client: Client): Promise<{
  announcements: { room_id: string; seq: number }[];
  messages: { room_id: string; seq: number; actor: string }[];
  cursor: number;
}> {
  const result = (await client.callTool({
    name: 'check',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result.structuredContent as {
    announcements: { room_id: string; seq: number }[];
    messages: { room_id: string; seq: number; actor: string }[];
    cursor: number;
  };
}

/** A member's last_seen from a board's list_members (the AC-named cross-check), or undefined. */
async function lastSeenOf(
  client: Client,
  projectId: string,
  handle: string,
): Promise<string | undefined> {
  const result = (await client.callTool({
    name: 'list_members',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  const members = (
    result.structuredContent as {
      members: { handle: string; last_seen: string }[];
    }
  ).members;
  return members.find((m) => m.handle === handle)?.last_seen;
}

/** The count of identity.seen events for `actor` on the REAL ledger (collision-proof presence). */
async function seenCount(actor: string): Promise<number> {
  const events = await dataAccess!.eventsByActor(actor);
  return events.filter((e) => e.type === 'identity.seen').length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-check-int-'));
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

describe('check over a real MCP client + real ledger (AC #5)', () => {
  it('first check after joining a board with OLD announcements: NO flood, last_seen + cursor advance; then delta on new activity; then empty delta with unchanged cursor', async () => {
    // --- Setup: announcer A2 creates board B and posts an OLD announcement BEFORE A joins. ---
    const projectId = 'release-train';
    const { client: setupClient } = await connect();
    await register(setupClient, 'a2');
    await announce(setupClient, projectId); // a2 is first member of board B
    // The pre-join 'old-topic' announcement — back-history A must NOT be flooded with.
    const oldRoomId = await postAnnouncement(
      setupClient,
      projectId,
      'old-topic',
    );

    // --- A registers, joins board B (which already has the OLD pre-join announcement). ---
    const { client: aClient } = await connect();
    await register(aClient, 'ada');
    await joinBoard(aClient, projectId); // ada becomes a member; her board floor = this join seq

    // ada's last_seen BEFORE her first check (= her registration time; no identity.seen yet).
    expect(await seenCount('ada')).toBe(0);
    const lastSeenBefore = await lastSeenOf(aClient, projectId, 'ada');
    expect(lastSeenBefore).toBeDefined();

    // a2 (re-established via login on a fresh connection — register would HANDLE_TAKEN) posts a
    // NEW announcement AFTER ada joined, so it IS in ada's announcement scope (above her floor),
    // while 'old-topic' (pre-join) stays below it.
    const { client: a2Client } = await connect();
    {
      const ok = (await a2Client.callTool({
        name: 'login',
        arguments: { handle: 'a2' },
      })) as CallToolResult;
      expect(ok.isError).toBeFalsy();
    }
    const postJoinRoomId = await postAnnouncement(
      a2Client,
      projectId,
      'post-join-topic',
    );

    // A small real delay so the wall-clock advances → the identity.seen the check appends has a
    // strictly-later timestamp than the registration (makes the list_members cross-check robust).
    await new Promise((r) => setTimeout(r, 5));

    // FIRST CHECK — NO FLOOD + cursor advance: the post-join announcement surfaces (advancing the
    // cursor to its seq), but the pre-join 'old-topic' announcement must NOT (floor = ada's join
    // seq). Presence is recorded (last_seen advances).
    const first = await check(aClient);
    expect(first.announcements.map((a) => a.room_id)).toContain(postJoinRoomId); // in-scope post-join
    expect(first.announcements.map((a) => a.room_id)).not.toContain(oldRoomId); // NO flood (pre-join)
    expect(first.messages).toEqual([]); // ada participates in no room yet

    // Presence advanced: exactly one identity.seen now, and list_members last_seen moved forward.
    expect(await seenCount('ada')).toBe(1);
    const lastSeenAfterFirst = await lastSeenOf(aClient, projectId, 'ada');
    expect(lastSeenAfterFirst).toBeDefined();
    expect(lastSeenAfterFirst! > lastSeenBefore!).toBe(true); // last_seen ADVANCED (AC cross-check)

    // Cursor advanced past 0 — to the post-join announcement's seq (maxReturned, NOT maxSeq).
    expect(first.cursor).toBeGreaterThan(0);

    // --- New activity: a NEW announcement in B + a NEW reply in a room A participates in. ---
    // a2 posts a proto-room; ada replies to it to become a participant of that room.
    const participatedRoomId = await postAnnouncement(
      a2Client,
      projectId,
      'negotiation',
    );
    await reply(aClient, participatedRoomId, 'ada joins the negotiation'); // ada participates now

    // ada checks once to consume the setup activity (her own joining reply + the 'negotiation'
    // announcement, posted AFTER she joined the board so it IS in her announcement scope),
    // advancing her cursor past them. This isolates the NEXT delta to strictly-new activity.
    const cursorBeforeDelta = (await check(aClient)).cursor;

    // Now the genuinely-NEW activity: a2 posts a fresh announcement in B AND replies in the room
    // ada participates in — both AFTER ada's last check.
    const newRoomId = await postAnnouncement(
      a2Client,
      projectId,
      'fresh-topic',
    );
    await reply(a2Client, participatedRoomId, 'a2 replies in the negotiation');

    // DELTA ON NEW ACTIVITY: ada's next check returns the new announcement (board member scope)
    // AND the new reply in her participated room (participation scope), scoped + seq-ordered,
    // and the cursor advances.
    const delta = await check(aClient);
    expect(delta.announcements.map((a) => a.room_id)).toContain(newRoomId);
    expect(
      delta.messages.some(
        (m) => m.room_id === participatedRoomId && m.actor === 'a2',
      ),
    ).toBe(true);
    // The out-of-scope 'old-topic' (pre-join) is STILL never surfaced.
    expect(delta.announcements.map((a) => a.room_id)).not.toContain(oldRoomId);
    // seq-ordered (non-decreasing) across the combined message list.
    const messageSeqs = delta.messages.map((m) => m.seq);
    expect([...messageSeqs].sort((x, y) => x - y)).toEqual(messageSeqs);
    // Cursor advanced beyond the prior check's cursor.
    expect(delta.cursor).toBeGreaterThan(cursorBeforeDelta);

    // --- EMPTY DELTA: a further check with no new activity → [] / [] and UNCHANGED cursor. ---
    const empty = await check(aClient);
    expect(empty.announcements).toEqual([]);
    expect(empty.messages).toEqual([]);
    expect(empty.cursor).toBe(delta.cursor); // cursor UNCHANGED (AC #2)
  });

  it('check with NO established identity returns NO_IDENTITY', async () => {
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const result = (await client.callTool({
      name: 'check',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('advertises check on the discovery surface with NO required params', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'check');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    // No params: empty (or absent) properties, and no required params.
    expect(Object.keys(schema.properties ?? {})).toEqual([]);
    expect(schema.required ?? []).toEqual([]);
  });
});
