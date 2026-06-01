// Integration AC #6 (Story 3.3, Task 5) — REAL-RUNTIME evidence (skill-rules Rule 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING is mocked: the
// wire, the server, the `register`/`announce_project`/`join_board`/`list_projects`
// tools, core's `joinBoard`, the projects projection, and the ledger are all real.
//
// Asserts the AC #6 round-trip for `join_board`:
//   - identity A announces TWO sub-boards (X, Y);
//   - identity B (a DIFFERENT identity on a fresh connection) join_boards X, then Y →
//     B is a member of BOTH (verified via list_projects over the real ledger: X.members
//     and Y.members each include B, with A first);
//   - join_board for an UNKNOWN project_id → BOARD_NOT_FOUND with NOTHING appended;
//   - a SECOND join_board of X by B appends NO additional board.joined (idempotent),
//     observed out-of-band via eventsByType('board.joined') on the real ledger;
//   - join_board with NO established identity → NO_IDENTITY (no session).
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
 * caller-owned {@link SessionIdentity} holder so the test can set/observe the session
 * the tools act as (the construction seam — no public "who am I" tool). Returns the
 * connected client and the very holder the server's tools read.
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-join-board-int-'));
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

describe('join_board over a real MCP client + real ledger (AC #6)', () => {
  it('A announces X,Y; B joins both → member of both; unknown → BOARD_NOT_FOUND; re-join appends nothing', async () => {
    // Identity A announces two sub-boards on connection 1.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      const x = (await client.callTool({
        name: 'announce_project',
        arguments: { title: 'Board X', description: 'the x board' },
      })) as CallToolResult;
      expect(x.isError).toBeFalsy();
      const y = (await client.callTool({
        name: 'announce_project',
        arguments: { title: 'Board Y', description: 'the y board' },
      })) as CallToolResult;
      expect(y.isError).toBeFalsy();
    }

    // Identity B — a DIFFERENT identity on a fresh connection — joins BOTH boards.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'joining' },
    });

    const joinX = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'board-x' },
    })) as CallToolResult;
    expect(joinX.isError).toBeFalsy();
    // The join result surfaces B as a member of X (announcer first).
    expect((joinX.structuredContent as { members: string[] }).members).toEqual([
      'ada',
      'bob',
    ]);
    // This server is built UNSEEDED (createBoardServer does not seed) — so the join result
    // carries NO `protocol` field (robust to an unseeded board; Story 7.2). The SEEDED surface
    // (a new member meets the protocol on join) is proven in protocol-seed.integration.test.ts.
    expect(
      (joinX.structuredContent as { protocol?: unknown }).protocol,
    ).toBeUndefined();

    const joinY = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'board-y' },
    })) as CallToolResult;
    expect(joinY.isError).toBeFalsy();
    expect((joinY.structuredContent as { members: string[] }).members).toEqual([
      'ada',
      'bob',
    ]);

    // Verify B is a member of BOTH via list_projects over the SAME real ledger.
    const list = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;
    const projects = (
      list.structuredContent as { projects: Record<string, unknown>[] }
    ).projects;
    const x = projects.find((p) => p.project_id === 'board-x');
    const y = projects.find((p) => p.project_id === 'board-y');
    expect(x?.members).toEqual(['ada', 'bob']);
    expect(y?.members).toEqual(['ada', 'bob']);

    // Unknown sub-board → BOARD_NOT_FOUND, NOTHING appended. Snapshot BOTH the
    // board.joined count AND the whole-ledger maxSeq so a regression that appended
    // ANY event (not just a join) on the rejected path is caught over the real ledger.
    const joinsBefore = (await dataAccess!.eventsByType('board.joined')).length;
    const maxSeqBefore = await dataAccess!.maxSeq();
    const unknown = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'ghost-board' },
    })) as CallToolResult;
    expect(unknown.isError).toBe(true);
    expect(readErrorPayload(unknown)).toMatchObject({
      code: 'BOARD_NOT_FOUND',
    });
    expect(await dataAccess!.eventsByType('board.joined')).toHaveLength(
      joinsBefore,
    );
    // Whole-ledger maxSeq is unchanged: the rejected path appended NOTHING of any type.
    expect(await dataAccess!.maxSeq()).toBe(maxSeqBefore);

    // Idempotent re-join of X by B → success, NO additional board.joined appended.
    const rejoin = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'board-x' },
    })) as CallToolResult;
    expect(rejoin.isError).toBeFalsy();
    expect((rejoin.structuredContent as { members: string[] }).members).toEqual(
      ['ada', 'bob'],
    );
    // board.joined count unchanged by the re-join (still the pre-re-join total).
    expect(await dataAccess!.eventsByType('board.joined')).toHaveLength(
      joinsBefore,
    );
  });

  it('join_board with NO established identity returns NO_IDENTITY (AC #5), nothing appended', async () => {
    // Seed a real board so the failure is the session gate, not BOARD_NOT_FOUND.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      await client.callTool({
        name: 'announce_project',
        arguments: { title: 'Board X', description: 'the x board' },
      });
    }

    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session
    const joinsBefore = (await dataAccess!.eventsByType('board.joined')).length;
    const maxSeqBefore = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: 'board-x' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    // No event appended on the rejected NO_IDENTITY path — board.joined count AND
    // whole-ledger maxSeq both unchanged over the real ledger.
    expect(await dataAccess!.eventsByType('board.joined')).toHaveLength(
      joinsBefore,
    );
    expect(await dataAccess!.maxSeq()).toBe(maxSeqBefore);
  });

  it('advertises join_board on the discovery surface with project_id required', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'join_board');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(['project_id']);
    expect(schema.required ?? []).toEqual(['project_id']);
  });
});
