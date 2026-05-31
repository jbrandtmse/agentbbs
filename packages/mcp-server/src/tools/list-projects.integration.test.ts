// Integration AC #5 (Story 3.2, Task 4) — REAL-RUNTIME evidence (skill-rules
// Rule 3). A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over
// the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3
// behind the NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in
// the stack is mocked: the wire, the server, the `announce_project` + `list_projects`
// tools, core's `announceProject`/`listProjects`, the projects projection, and the
// ledger are all real.
//
// Asserts the AC #5 round-trip for `list_projects`:
//   - identity A announces TWO projects in a known order;
//   - identity B (a DIFFERENT identity on a fresh connection, a member of NEITHER)
//     calls list_projects and receives BOTH projects, ordered by seq (announcement
//     order), each with the correct title/project_id/description/announcer — proving
//     the cross-tool wire-up (announce_project writes → list_projects reads the folded
//     directory) AND the board-wide-open-read-without-membership property;
// plus the AC #3 (empty board → []), AC #4 (NO_IDENTITY, no session), and the
// discovery surface (list_projects advertises NO required params) paths over the same
// real transport.
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
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with
 * a caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set the
 * session the tools act as (the construction seam — no public "who am I" tool).
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-list-projects-int-'));
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

describe('list_projects over a real MCP client + real ledger (AC #5)', () => {
  it('A announces two projects; B (a DIFFERENT, non-member identity) lists BOTH, seq-ordered, with correct fields', async () => {
    // Identity A announces two projects in a known order on connection 1.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'announcing' },
      });
      const first = (await client.callTool({
        name: 'announce_project',
        arguments: {
          title: 'Calling Interface',
          description: 'coordinate the calling interface',
        },
      })) as CallToolResult;
      expect(first.isError).toBeFalsy();
      const second = (await client.callTool({
        name: 'announce_project',
        arguments: {
          title: 'Release Train',
          description: 'coordinate the release train',
        },
      })) as CallToolResult;
      expect(second.isError).toBeFalsy();
    }

    // Identity B — a DIFFERENT identity on a fresh connection, member of NEITHER
    // board — lists the directory against the SAME real ledger.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });
    const result = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { projects?: unknown[] };
    expect(Array.isArray(sc.projects)).toBe(true);
    const projects = sc.projects as Record<string, unknown>[];
    // BOTH projects visible to the non-member, ordered by announcement (seq).
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.project_id)).toEqual([
      'calling-interface',
      'release-train',
    ]);
    // Field fidelity on the first entry — announcer is A, B is NOT a member.
    expect(projects[0]).toMatchObject({
      project_id: 'calling-interface',
      title: 'Calling Interface',
      description: 'coordinate the calling interface',
      announcer: 'ada',
    });
    expect(projects[0]?.members).toEqual(['ada']);
    expect((projects[0]?.members as string[]).includes('bob')).toBe(false);
    expect(projects[1]).toMatchObject({
      project_id: 'release-train',
      title: 'Release Train',
      description: 'coordinate the release train',
      announcer: 'ada',
    });

    // The JSON text block mirrors structuredContent (same { projects: [...] }).
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock?.text ?? '{}') as {
      projects: Record<string, unknown>[];
    };
    expect(parsed.projects.map((p) => p.project_id)).toEqual([
      'calling-interface',
      'release-train',
    ]);
  });

  it('orders the wire list by announcement seq, NOT alphabetically by title (AC #1)', async () => {
    // Announce in an order where seq-order and alphabetical-by-title DISAGREE:
    // "Zephyr Board" (slug zephyr-board) is announced FIRST, "Alpha Board"
    // (slug alpha-board) SECOND. seq-order => [zephyr-board, alpha-board];
    // a title/slug-sorted bug would instead yield [alpha-board, zephyr-board].
    // The two-project AC #5 case above can't catch this (its titles happen to be
    // already alphabetical); this case proves the FULL wire path (announce_project
    // writes -> core seq-sort -> projectToWire) preserves seq order, never title.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'announcing' },
    });
    await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Zephyr Board', description: 'announced first' },
    });
    await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Alpha Board', description: 'announced second' },
    });

    const result = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      projects: Record<string, unknown>[];
    };
    // seq order (announcement order), which here is the REVERSE of alphabetical.
    expect(sc.projects.map((p) => p.project_id)).toEqual([
      'zephyr-board',
      'alpha-board',
    ]);
    // The text block mirrors the same seq order.
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock?.text ?? '{}') as {
      projects: Record<string, unknown>[];
    };
    expect(parsed.projects.map((p) => p.project_id)).toEqual([
      'zephyr-board',
      'alpha-board',
    ]);
  });

  it('an empty board returns an empty list ([]), not an error (AC #3)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    const result = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { projects?: unknown[] };
    expect(sc.projects).toEqual([]);
  });

  it('list_projects with NO established identity returns NO_IDENTITY (AC #4)', async () => {
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const result = (await client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
  });

  it('advertises list_projects on the discovery surface with NO required params', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_projects');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    // No params: empty (or absent) properties, and no required params.
    expect(Object.keys(schema.properties ?? {})).toEqual([]);
    expect(schema.required ?? []).toEqual([]);
  });
});
