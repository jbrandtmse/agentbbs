// Integration AC #5 (Story 3.1, Task 6) — REAL-RUNTIME evidence (skill-rules
// Rule 3). A real MCP `Client` talks to a `createBoardServer`-built `McpServer`
// over the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess`
// (better-sqlite3 behind the NFR2 seam) against a genuine SQLite file in an OS temp
// dir. NOTHING in the stack is mocked: the wire, the server, the `announce_project`
// tool, core's `announceProject`, the projects projection, and the ledger are all
// real.
//
// Asserts the AC #5 round-trip for `announce_project`:
//   - an established identity announces a project once → the ledger holds EXACTLY
//     one project.announced (with the derived project_id) plus one board.joined for
//     the announcer, and the wire result shows the announcer as first member;
//   - a SECOND announce of the SAME title (by the SAME identity) fails PROJECT_EXISTS
//     and appends NOTHING further;
//   - a DIFFERENT identity announcing the SAME title also fails PROJECT_EXISTS and
//     appends nothing — observed out-of-band via the real ledger (maxSeq / eventsByType);
// plus the AC #3 (NO_IDENTITY, no session) and AC #4 (invalid input — empty title)
// paths over the same real transport.
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
 * Stand up a real Client↔server pair over the in-memory transport, real ledger,
 * with a caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set
 * the session the tools act as (the construction seam — no public "who am I" tool).
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-announce-int-'));
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

describe('announce_project over a real MCP client + real ledger (AC #5)', () => {
  it('announce once → exactly one project.announced + one board.joined for the announcer; duplicate title → PROJECT_EXISTS, nothing appended', async () => {
    const { client } = await connect();

    // Establish an identity for the session (register also establishes it).
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'shipping 3.1' },
    });

    const result = (await client.callTool({
      name: 'announce_project',
      arguments: {
        title: 'Calling Interface',
        description: 'coordinate the calling interface',
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.project_id).toBe('calling-interface');
    expect(sc.title).toBe('Calling Interface');
    expect(sc.description).toBe('coordinate the calling interface');
    expect(sc.announcer).toBe('ada');
    // The announcer is the first member (real array on the wire, not object-keyed).
    expect(sc.members).toEqual(['ada']);
    // The JSON text block mirrors structuredContent.
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    expect(JSON.parse(textBlock?.text ?? '{}')).toMatchObject({
      project_id: 'calling-interface',
      members: ['ada'],
    });

    // Out-of-band via the REAL ledger: exactly one project.announced + one board.joined.
    const announced = await dataAccess!.eventsByType('project.announced');
    expect(announced).toHaveLength(1);
    expect(announced[0]?.actor).toBe('ada');
    expect(announced[0]?.payload).toMatchObject({
      projectId: 'calling-interface',
      title: 'Calling Interface',
    });
    const joins = await dataAccess!.eventsByType('board.joined');
    expect(joins).toHaveLength(1);
    expect(joins[0]?.actor).toBe('ada');
    expect(joins[0]?.payload).toEqual({ projectId: 'calling-interface' });

    const maxAfterFirst = await dataAccess!.maxSeq();

    // Second announce of the SAME title (same identity) → PROJECT_EXISTS, no append.
    const dup = (await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Calling Interface', description: 'again' },
    })) as CallToolResult;
    expect(dup.isError).toBe(true);
    expect(readErrorPayload(dup)).toMatchObject({ code: 'PROJECT_EXISTS' });

    expect(await dataAccess!.maxSeq()).toBe(maxAfterFirst);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(1);
    expect(await dataAccess!.eventsByType('board.joined')).toHaveLength(1);
  });

  it('a DIFFERENT identity announcing the SAME title also fails PROJECT_EXISTS and appends nothing', async () => {
    // First identity announces the title on one connection.
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'x' },
      });
      const ok = (await client.callTool({
        name: 'announce_project',
        arguments: { title: 'Shared Board', description: 'first' },
      })) as CallToolResult;
      expect(ok.isError).toBeFalsy();
    }

    // A different identity on a fresh connection (same real ledger) tries the same title.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'y' },
    });
    // Capture max AFTER bob registers, so the assertion isolates the announce's
    // effect (the duplicate announce must append NOTHING).
    const maxBefore = await dataAccess!.maxSeq();
    const dup = (await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Shared Board', description: 'second' },
    })) as CallToolResult;

    expect(dup.isError).toBe(true);
    expect(readErrorPayload(dup)).toMatchObject({ code: 'PROJECT_EXISTS' });
    // Nothing appended by the rejected attempt.
    expect(await dataAccess!.maxSeq()).toBe(maxBefore);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(1);
  });

  it('a DISTINCT title that slugs to the SAME project_id is rejected PROJECT_EXISTS by the REAL ledger (dual-guard, AC #2)', async () => {
    // The dev's documented collision policy: announceProject guards uniqueness on
    // BOTH the title AND the derived project_id. A SECOND title that differs from
    // the first ("Hello World" vs "hello, world!") but slugs to the SAME id
    // ("hello-world") would slip past the `title` guard — only the SECOND
    // (`project_id`) guard catches it. The unit test pins this against the in-memory
    // fake; this proves the real better-sqlite3 appendGuarded actually enforces the
    // second guard end-to-end (a single-guard implementation would let this through).
    {
      const { client } = await connect();
      await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'x' },
      });
      const ok = (await client.callTool({
        name: 'announce_project',
        arguments: { title: 'Hello World', description: 'first' },
      })) as CallToolResult;
      expect(ok.isError).toBeFalsy();
      expect((ok.structuredContent as Record<string, unknown>).project_id).toBe(
        'hello-world',
      );
    }

    // A different identity announces a DIFFERENT title that slugs to the same id.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'y' },
    });
    const maxBefore = await dataAccess!.maxSeq();
    const dup = (await client.callTool({
      name: 'announce_project',
      arguments: { title: 'hello, world!', description: 'same slug' },
    })) as CallToolResult;

    expect(dup.isError).toBe(true);
    expect(readErrorPayload(dup)).toMatchObject({ code: 'PROJECT_EXISTS' });
    // The project_id guard tripped → nothing appended; still exactly one project.
    expect(await dataAccess!.maxSeq()).toBe(maxBefore);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(1);
    expect(await dataAccess!.eventsByType('board.joined')).toHaveLength(1);
  });

  it('the two events land in order on the REAL ledger: project.announced before the announcer board.joined, both attributed to the announcer (AC #1)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    const ok = (await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Ordered Board', description: 'check seq order' },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();

    // Out-of-band via the real ledger: both events attributed to the announcer,
    // and project.announced is appended BEFORE the announcer's board.joined within
    // the single atomic transaction (lower seq).
    const announced = await dataAccess!.eventsByType('project.announced');
    const joins = await dataAccess!.eventsByType('board.joined');
    expect(announced).toHaveLength(1);
    expect(joins).toHaveLength(1);
    expect(announced[0]?.actor).toBe('ada');
    expect(joins[0]?.actor).toBe('ada');
    expect(announced[0]!.seq).toBeLessThan(joins[0]!.seq);
    expect(joins[0]!.payload).toEqual({ projectId: 'ordered-board' });
  });

  it('announce_project with NO established identity returns NO_IDENTITY and appends nothing (AC #3)', async () => {
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session

    const before = await dataAccess!.maxSeq();
    const result = (await client.callTool({
      name: 'announce_project',
      arguments: { title: 'Orphan', description: 'no session' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    // No event appended on the NO_IDENTITY path.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(0);
  });

  it('rejects invalid input (empty title) at the boundary BEFORE core — no event appended (AC #4)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'announce_project',
      arguments: { title: '', description: 'has empty title' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // A Zod validation rejection, NOT a domain error — no closed board code.
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → nothing appended (only the earlier registration exists).
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(0);
  });

  it('rejects a title that slugs to EMPTY (punctuation/non-Latin only) at the boundary — no empty-id project appended (AC #4 / AR10)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    const before = await dataAccess!.maxSeq();

    // "!!!" passes a naive .min(1) (length 3) but slugify collapses it to '' — a
    // boundary .refine must reject it so no project with an empty/unaddressable
    // project_id is ever minted.
    const result = (await client.callTool({
      name: 'announce_project',
      arguments: { title: '!!!', description: 'all punctuation' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // A Zod validation rejection (the .refine), NOT a domain error — no closed code.
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → nothing appended, and no empty-id project exists.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('project.announced')).toHaveLength(0);
  });

  it('advertises snake_case params (title, description) on the discovery surface (AC #4)', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'announce_project');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'description',
      'title',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['title', 'description']),
    );
  });
});
