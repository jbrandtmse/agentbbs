// Integration AC #5 (Story 3.4, Task 4) — REAL-RUNTIME evidence (skill-rules Rule 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the register/update_focus/announce_project/join_board/
// list_members tools, core's ops, the projects + identity projections, and the ledger
// are all real.
//
// Asserts the AC #5 round-trip for `list_members`:
//   - identity A announces a board (auto-joining as first member) and updates its focus;
//   - identity B (DIFFERENT connection) join_boards that same board and updates a
//     DIFFERENT focus;
//   - identity C (a member of NEITHER board) calls list_members and receives BOTH A and
//     B with their correct handle/current_focus/last_seen, in JOIN order (A first), each
//     last_seen reflecting that member's latest identity event (distinct, because A and B
//     updated focus at distinct times) — proving the cross-projection join (membership ⋈
//     identity) over the real ledger AND the open-read-without-membership property;
// plus AC #3 (unknown board → BOARD_NOT_FOUND) and AC #4 (NO_IDENTITY, no session) over
// the same real transport.
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
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set the session
 * the tools act as (the construction seam — no public "who am I" tool). Each call gets
 * its OWN server + session, modelling distinct agents A / B / C on distinct connections.
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-list-members-int-'));
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

describe('list_members over a real MCP client + real ledger (AC #5)', () => {
  it('C (member of neither) reads A + B with correct handle/current_focus/last_seen in join order', async () => {
    // A announces a board (auto-joins as first member) and updates its focus.
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
      const focusA = (await client.callTool({
        name: 'update_focus',
        arguments: { current_focus: 'A is wiring the dialer' },
      })) as CallToolResult;
      expect(focusA.isError).toBeFalsy();
    }

    // B joins that same board (becomes the second member) and updates a DIFFERENT focus.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'bob', current_focus: 'browsing' },
      });
      const joined = (await client.callTool({
        name: 'join_board',
        arguments: { project_id: 'calling-interface' },
      })) as CallToolResult;
      expect(joined.isError).toBeFalsy();
      const focusB = (await client.callTool({
        name: 'update_focus',
        arguments: { current_focus: 'B is testing the ringer' },
      })) as CallToolResult;
      expect(focusB.isError).toBeFalsy();
    }

    // C — a THIRD identity on a fresh connection, a member of NEITHER board — reads the
    // directory against the SAME real ledger.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'cleo', current_focus: 'observing' },
    });
    const result = (await client.callTool({
      name: 'list_members',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { members?: unknown[] };
    expect(Array.isArray(sc.members)).toBe(true);
    const members = sc.members as Record<string, unknown>[];
    // BOTH members visible to the non-member, in JOIN order (announcer A first, B next).
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.handle)).toEqual(['ada', 'bob']);
    // Each carries the LATEST focus the member set (proves the identity-fold join).
    expect(members[0]).toMatchObject({
      handle: 'ada',
      current_focus: 'A is wiring the dialer',
    });
    expect(members[1]).toMatchObject({
      handle: 'bob',
      current_focus: 'B is testing the ringer',
    });
    // last_seen is present + ISO-8601-ish for each (the derived presence value). No
    // `stale` flag is fabricated by core (DECISION 1) — only last_seen is surfaced.
    for (const m of members) {
      expect(typeof m.last_seen).toBe('string');
      expect(Number.isNaN(Date.parse(m.last_seen as string))).toBe(false);
      expect(m).not.toHaveProperty('stale');
    }
    // AC #2 (distinguishable last_seen): each member's last_seen is that member's OWN
    // latest identity event created_at, read out-of-band from the REAL ledger — NOT a
    // single board-wide timestamp. Pinning to the per-actor latest event proves the
    // directory surfaces DISTINCT, per-member derived values (a regression collapsing
    // last_seen to one timestamp — e.g. the announce time — would fail here) AND that
    // last_seen reflects the LATEST identity event (the focus update), not registration.
    const latestCreatedAt = async (actor: string): Promise<string> => {
      const evs = await dataAccess!.eventsByActor(actor);
      // eventsByActor returns seq-ascending; the last is the most recent identity event.
      return evs[evs.length - 1]!.createdAt;
    };
    const adaLastSeen = await latestCreatedAt('ada');
    const bobLastSeen = await latestCreatedAt('bob');
    expect(members[0]!.last_seen).toBe(adaLastSeen);
    expect(members[1]!.last_seen).toBe(bobLastSeen);
    // The two last_seen values are per-member, not a shared board timestamp: bob's
    // latest event happens AFTER ada's whole block, so over the monotonic real clock
    // bob's last_seen is >= ada's (deterministic — no flake on same-millisecond luck),
    // and each is pinned to its own actor's latest event above. A regression collapsing
    // last_seen to one shared value would break the two per-actor equalities.
    expect(bobLastSeen >= adaLastSeen).toBe(true);
    // A non-member (cleo) does NOT appear in the directory.
    expect(members.map((m) => m.handle)).not.toContain('cleo');

    // The JSON text block mirrors structuredContent (same { members: [...] }).
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock?.text ?? '{}') as {
      members: Record<string, unknown>[];
    };
    expect(parsed.members.map((m) => m.handle)).toEqual(['ada', 'bob']);
  });

  it('list_members for an unknown project_id returns BOARD_NOT_FOUND (AC #3)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'observing' },
    });
    const result = (await client.callTool({
      name: 'list_members',
      arguments: { project_id: 'no-such-board' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });

  it('list_members with NO established identity returns NO_IDENTITY (AC #4)', async () => {
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const result = (await client.callTool({
      name: 'list_members',
      arguments: { project_id: 'calling-interface' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('advertises list_members on the discovery surface requiring project_id', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_members');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(['project_id']);
    expect(schema.required ?? []).toEqual(['project_id']);
  });
});
