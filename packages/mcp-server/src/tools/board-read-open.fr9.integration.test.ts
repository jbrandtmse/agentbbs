// FR9 read-open lock-in + the membership write-gate over a real ledger (Story 3.5,
// Tasks 3 & 4 / AC #1, #5; gate AC #2, #3). REAL-RUNTIME evidence (skill-rules Rule 3).
//
// This is the Epic-3-closing invariant guard: READ is open board-wide (identity, not
// membership) while WRITE is membership-gated. Nothing here is mocked — a real MCP
// `Client` talks to a `createBoardServer`-built `McpServer` over `InMemoryTransport`,
// backed by the REAL `createDataAccess` (better-sqlite3) against a genuine SQLite file.
//
// Two locks:
//   1. FR9 read-open (AC #1, #5): identity A announces a board; a DIFFERENT identity B,
//      a member of NOTHING, calls BOTH read tools (`list_projects` + `list_members`) and
//      BOTH succeed — explicitly asserting B is NOT a member yet the reads do not gate.
//      A future regression that adds a membership gate to a read is caught HERE.
//   2. Gate-agrees-with-ledger (AC #2, #3): folding the SAME real ledger the tools wrote,
//      `requireMembership` (the Epic 4 post-tool gate) authorizes the member (A) and
//      rejects the non-member (B) with NOT_A_MEMBER, and an unannounced board with
//      BOARD_NOT_FOUND — proving the gate's verdict matches real membership state ahead
//      of its Epic 4 tool consumer (the gate ships with a declared future consumer).
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { requireMembership } from '@agentbbs/core';
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
 * caller-owned {@link SessionIdentity} holder so each call models a distinct agent on a
 * distinct connection (the construction seam — no public "who am I" tool).
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-fr9-read-open-int-'));
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

describe('FR9 read-open invariant: a non-member reads every Epic 3 read tool (AC #1, #5)', () => {
  it('B (member of NOTHING) successfully reads BOTH list_projects and list_members', async () => {
    // A announces a board (auto-joining as its first and only member).
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      const announced = (await client.callTool({
        name: 'announce_project',
        arguments: {
          title: 'Calling Interface',
          description: 'coordinate the calling interface',
        },
      })) as CallToolResult;
      expect(announced.isError).toBeFalsy();
    }

    // B registers on a FRESH connection and joins NOTHING — a member of no board.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });

    // FR9 LOCK 1 — list_projects succeeds for the non-member, and B is provably NOT a
    // member of the board it can nonetheless see.
    const projectsResult = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;
    expect(projectsResult.isError).toBeFalsy();
    const sc = projectsResult.structuredContent as {
      projects: Record<string, unknown>[];
    };
    expect(sc.projects).toHaveLength(1);
    expect(sc.projects[0]?.project_id).toBe('calling-interface');
    // The read returns the board to B even though B is NOT in its members — the read is
    // open board-wide. (If a regression gated the read on membership, B would see [].)
    expect(sc.projects[0]?.members).toEqual(['ada']);
    expect((sc.projects[0]?.members as string[]).includes('bob')).toBe(false);

    // FR9 LOCK 2 — list_members succeeds for the SAME non-member and returns the board's
    // membership (just A), confirming the directory read never gates on the reader's
    // own membership.
    const membersResult = (await client.callTool({
      name: 'list_members',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(membersResult.isError).toBeFalsy();
    const scm = membersResult.structuredContent as {
      members: Record<string, unknown>[];
    };
    expect(scm.members.map((m) => m.handle)).toEqual(['ada']);
    // The reader (bob) is NOT a member, yet the read succeeded — the lock-in assertion.
    expect(scm.members.map((m) => m.handle)).not.toContain('bob');
  });
});

describe('membership write-gate agrees with the real ledger (AC #2, #3)', () => {
  it('requireMembership authorizes the member, rejects the non-member (NOT_A_MEMBER) and the unknown board (BOARD_NOT_FOUND)', async () => {
    // Build the SAME real ledger the tools write: A announces (auto-joins); B registers
    // but never joins.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      await client.callTool({
        name: 'announce_project',
        arguments: {
          title: 'Calling Interface',
          description: 'coordinate the calling interface',
        },
      });
    }
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'browsing' },
      });
    }

    // Now exercise the Epic 4 post-tool gate directly against that same real ledger
    // (the data-access handle IS a DataAccess) — proving the gate's verdict matches the
    // membership the tools actually wrote, ahead of its Epic 4 tool consumer.
    // Member (announcer, auto-joined) → authorized (no throw).
    await expect(
      requireMembership(dataAccess!, 'ada', 'calling-interface'),
    ).resolves.toBeUndefined();
    // Non-member of an existing board → NOT_A_MEMBER.
    await expect(
      requireMembership(dataAccess!, 'bob', 'calling-interface'),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    // Unannounced board → BOARD_NOT_FOUND (distinct from NOT_A_MEMBER).
    await expect(
      requireMembership(dataAccess!, 'ada', 'no-such-board'),
    ).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });

  it('flips a non-member to authorized after they join via the real join_board tool (membership acquired over the real ledger, not just announcing)', async () => {
    // The integration cases above only prove the gate authorizes the ANNOUNCER (auto-
    // joined). The membership-acquisition path Epic 4 actually depends on is "you became
    // a member by JOINING, so the gate now lets you post" — a non-announcer who joins via
    // the real `join_board` tool. This locks that loop in over the real ledger: the gate
    // verdict for the SAME handle flips NOT_A_MEMBER → authorized once a real `board.joined`
    // (written by the actual tool, not a hand-built event) lands.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      await client.callTool({
        name: 'announce_project',
        arguments: {
          title: 'Calling Interface',
          description: 'coordinate the calling interface',
        },
      });
    }

    // B registers but has NOT joined yet — the gate must reject B as a non-member.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });
    await expect(
      requireMembership(dataAccess!, 'bob', 'calling-interface'),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });

    // B joins via the REAL join_board tool (appends a real board.joined to the ledger).
    const joined = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;
    expect(joined.isError).toBeFalsy();
    expect(
      (joined.structuredContent as { members: string[] }).members,
    ).toContain('bob');

    // SAME handle, SAME real ledger: the gate now AUTHORIZES B (no throw). The verdict
    // flipped purely because a real board.joined landed — exactly the Epic 4 contract.
    await expect(
      requireMembership(dataAccess!, 'bob', 'calling-interface'),
    ).resolves.toBeUndefined();
  });
});
