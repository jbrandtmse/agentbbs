// Integration AC #4 (Story 2.2, Task 5) — REAL-RUNTIME evidence (skill-rules
// Rule 3). A real MCP `Client` talks to a `createBoardServer`-built `McpServer`
// over the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess`
// (better-sqlite3 behind the NFR2 seam) against a genuine SQLite file in an OS
// temp dir. NOTHING in the stack is mocked: the wire, the server, the tool, core,
// and the ledger are all real.
//
// Asserts the AC #4 outcomes:
//   - a first `register` call returns the identity (snake_case wire) and the real
//     ledger holds EXACTLY ONE identity.registered event for that handle;
//   - a second call with the SAME handle returns a HANDLE_TAKEN isError result and
//     the ledger STILL holds exactly one;
//   - invalid-charset input (e.g. "Ada!") is rejected by the SDK BEFORE the core
//     delegate runs — observable as an isError validation result with NO board
//     `code`, and no new event in the ledger.
// (The cross-process race — two concurrent registrations of the same handle →
//  exactly one event — is the separate FR1 proof in register-race.test.ts.)
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
import { readErrorPayload } from '../error-map.js';

import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/** Stand up a real Client↔server pair over the in-memory transport, real ledger. */
async function connect(): Promise<Client> {
  const server = createBoardServer({ dataAccess: dataAccess! });
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
  return client;
}

/** Count identity.registered events for a given handle in the real ledger. */
async function registeredCount(handle: string): Promise<number> {
  const events = await dataAccess!.eventsByType('identity.registered');
  return events.filter((e) => e.actor === handle).length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-register-int-'));
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

describe('register over a real MCP client + real ledger (AC #4)', () => {
  it('a valid register returns the identity (snake_case) and the ledger holds exactly one event', async () => {
    const client = await connect();

    const result = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'shipping 2.2' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    // snake_case wire payload with createdAt/lastSeen filled by the real ledger.
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBe('ada');
    expect(sc.current_focus).toBe('shipping 2.2');
    expect(typeof sc.created_at).toBe('string');
    expect(sc.last_seen).toBe(sc.created_at); // last_seen === created_at at registration
    // Real ISO-8601 instant assigned by data-access (not fabricated by core).
    expect(new Date(sc.created_at as string).toISOString()).toBe(sc.created_at);

    // The REAL ledger holds exactly one identity.registered for "ada".
    expect(await registeredCount('ada')).toBe(1);
  });

  it('a second register of the same handle returns HANDLE_TAKEN and the ledger still holds exactly one', async () => {
    const client = await connect();

    const first = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'first' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();

    const second = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'second' },
    })) as CallToolResult;

    expect(second.isError).toBe(true);
    expect(readErrorPayload(second)).toMatchObject({ code: 'HANDLE_TAKEN' });

    // No second event was appended — the atomic guard rejected before insert.
    expect(await registeredCount('ada')).toBe(1);
  });

  it('rejects an invalid-charset handle BEFORE core, appending nothing', async () => {
    const client = await connect();

    const result = (await client.callTool({
      name: 'register',
      // "Ada!" — uppercase + "!" are outside the canonical charset → schema reject.
      arguments: { handle: 'Ada!', current_focus: 'x' },
    })) as CallToolResult;

    // Rejected by Zod validation, surfaced as an isError with a validation message
    // and NO board code (distinguishable from a domain error).
    expect(result.isError).toBe(true);
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    expect(textBlock?.text ?? '').toMatch(/validation|invalid|match/i);
    expect(readErrorPayload(result)).toBeUndefined();

    // Nothing reached core, so nothing was appended for any casing of the handle.
    const all = await dataAccess!.eventsByType('identity.registered');
    expect(all).toHaveLength(0);
  });

  it('rejects an uppercase-but-otherwise-valid handle before core (canonical-only schema)', async () => {
    const client = await connect();

    const result = (await client.callTool({
      name: 'register',
      arguments: { handle: 'Ada', current_focus: 'x' },
    })) as CallToolResult;

    // "Ada" is in-charset except for the uppercase A; the lowercase-only pattern
    // rejects it at the boundary (the documented AC #3 decision).
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toBeUndefined();
    expect(await dataAccess!.eventsByType('identity.registered')).toHaveLength(
      0,
    );
  });

  it('two DIFFERENT handles both register and the ledger holds one event each', async () => {
    const client = await connect();

    const a = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'a' },
    })) as CallToolResult;
    const b = (await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'b' },
    })) as CallToolResult;

    expect(a.isError).toBeFalsy();
    expect(b.isError).toBeFalsy();
    expect(await registeredCount('ada')).toBe(1);
    expect(await registeredCount('bob')).toBe(1);
  });
});
