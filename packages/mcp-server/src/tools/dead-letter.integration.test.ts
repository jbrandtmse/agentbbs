// Story 6.2 — the pull-only DEAD-LETTER persists (AC #3, #4; NFR11). REAL-RUNTIME (Rule 3).
//
// The accepted V1 limitation: a need posted FOR an agent whose workflow has ENDED (it never dials
// in again) is NEVER DELIVERED (the board never pushes — pull-only), but is NEVER LOST. The ledger
// is append-only, so the `announcement.posted` sits there permanently and stays visible to every
// OPEN read (FR9 — board-wide, identity-not-membership) and to the operator (the global-read /
// escalation backstop). This is DURABILITY WITHOUT A DELIVERY GUARANTEE (design decision 3).
//
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over `InMemoryTransport`,
// backed by the REAL `createDataAccess` (better-sqlite3) against a genuine SQLite file. Nothing is
// mocked.
//
// The scenario:
//   - poster A announces a sub-board and posts a need (a proto-room) that agent Z would pick up by
//     dialing in — Z is the intended recipient ("for Z" — the board does not parse addressing; the
//     need is one Z's `check` WOULD surface in Z's member board if Z ever checked);
//   - Z registers and joins the board (so the need IS in Z's `check` scope) but Z's workflow ENDS:
//     Z NEVER calls `check` (asserted: Z appended ZERO `identity.seen` events — `check` is the only
//     thing that records Z's presence on this connection, so zero presence pings ⇒ Z never dialed
//     in);
//   - NOTHING is lost: the `announcement.posted` remains in the real ledger (asserted via a direct
//     out-of-band read of the ledger), and it is RETURNED by OPEN reads — `list_announcements` and
//     `read_room` — performed by the OPERATOR (a different identity, NOT a member of the board),
//     proving the undelivered need is durable and operator-visible, only undelivered-by-pull.
//
// THE APPEND INVARIANT corollary: the dead-letter PERSISTS precisely because the ledger is
// append-only — nothing is ever deleted, so an undelivered need cannot evaporate. `check` PUSHES
// nothing, so Z (ended) never receives it; both halves are the V1 contract.
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
    arguments: { handle, current_focus: 'on the board' },
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

/** Post a proto-room announcement (a "need"); return its room_id. */
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

async function joinBoard(client: Client, projectId: string): Promise<void> {
  const result = (await client.callTool({
    name: 'join_board',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** The count of identity.seen events for `actor` on the REAL ledger (presence == dialed in). */
async function seenCount(actor: string): Promise<number> {
  const events = await dataAccess!.eventsByActor(actor);
  return events.filter((e) => e.type === 'identity.seen').length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-dead-letter-int-'));
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

describe('pull-only dead-letter: an undelivered need for an ended-workflow agent persists and stays operator-visible (AC #3, #4)', () => {
  it('Z never checks, yet the need remains in the ledger and is returned by OPEN reads (list_announcements + read_room) to a non-member operator', async () => {
    const projectId = 'release-train';
    const subject = 'who owns the tasks schema';

    // --- Poster A creates the board and posts a need that Z would pick up by dialing in. ---
    const { client: a } = await connect();
    await register(a, 'ada');
    await announce(a, projectId);
    const roomId = await postAnnouncement(
      a,
      projectId,
      subject,
      'Z, please confirm the tasks table column types before I freeze the contract.',
    );

    // --- Z registers and JOINS the board, so the need IS in Z's check scope… but Z's workflow
    // ENDS: Z NEVER calls check. (Joining is in Z's scope; the need predates Z's join floor, but
    // that is irrelevant here — the point is Z never dials in at all, so it receives NOTHING,
    // floor or no floor.) ---
    const { client: z } = await connect();
    await register(z, 'zed');
    await joinBoard(z, projectId);
    // Z's workflow ends here. No check() is ever issued on Z's connection.

    // Z provably never dialed in: check is the ONLY op that records Z's presence (identity.seen),
    // and Z never called it → zero presence pings. The need was never delivered to Z.
    expect(await seenCount('zed')).toBe(0);

    // --- NOTHING IS LOST: the announcement.posted is still in the real ledger (out-of-band read,
    // since the better-sqlite3 import boundary forbids a raw connection from this package). ---
    const posted = (
      await dataAccess!.eventsByType('announcement.posted')
    ).filter((e) => (e.payload as { roomId?: string }).roomId === roomId);
    expect(posted).toHaveLength(1); // durable — append-only, never deleted

    // --- OPERATOR-VISIBLE: a DIFFERENT identity (the operator), a member of NOTHING, dials in and
    // reads the board. The undelivered need surfaces on the OPEN reads (FR9 — identity, not
    // membership), which is the documented escalation / global-read backstop. ---
    const { client: op } = await connect();
    await register(op, 'operator');

    // list_announcements (open browse) returns the still-proto need to the non-member operator.
    const listed = (await op.callTool({
      name: 'list_announcements',
      arguments: { project_id: projectId },
    })) as CallToolResult;
    expect(listed.isError).toBeFalsy();
    const announcements = (
      listed.structuredContent as {
        announcements: { room_id: string; subject: string }[];
      }
    ).announcements;
    expect(announcements.map((r) => r.room_id)).toContain(roomId);
    expect(announcements.find((r) => r.room_id === roomId)?.subject).toBe(
      subject,
    );

    // read_room (open full-history read) returns the need's complete content to the operator — the
    // body is intact and verbatim, so the operator can act on it (reply / pull in a live agent).
    const room = (await op.callTool({
      name: 'read_room',
      arguments: { room_id: roomId },
    })) as CallToolResult;
    expect(room.isError).toBeFalsy();
    const messages = (
      room.structuredContent as {
        messages: { seq: number; actor: string; body: string; kind: string }[];
      }
    ).messages;
    // The seeding announcement (#1) carries the need verbatim, posted by A, undelivered to Z.
    expect(messages).toHaveLength(1);
    expect(messages[0]?.actor).toBe('ada');
    expect(messages[0]?.kind).toBe('announcement');
    expect(messages[0]?.body).toContain('tasks table column types');

    // The operator is a member of NOTHING, yet both reads succeeded — the backstop is open-read,
    // not membership-gated. (A regression that gated these reads would strand the dead-letter.)
    const members = (await op.callTool({
      name: 'list_members',
      arguments: { project_id: projectId },
    })) as CallToolResult;
    const memberHandles = (
      members.structuredContent as { members: { handle: string }[] }
    ).members.map((m) => m.handle);
    expect(memberHandles).not.toContain('operator');
  });
});
