// Integration AC #3 (Story 2.3, Task 4) — REAL-RUNTIME evidence (skill-rules
// Rule 3). A real MCP `Client` talks to a `createBoardServer`-built `McpServer`
// over the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess`
// (better-sqlite3 behind the NFR2 seam) against a genuine SQLite file in an OS temp
// dir. NOTHING in the stack is mocked: the wire, the server, the tools, core, and
// the ledger are all real.
//
// Asserts the AC #3 outcomes for `login`:
//   - a client registers handle `H`, then `login H` returns H's identity
//     (snake_case wire) and the server's SESSION identity is now `H`;
//   - `login` resolves the already-canonical handle (the schema accepts only
//     canonical handles — an uppercase variant is rejected at the boundary, the
//     same documented decision as register);
//   - `login` of a never-registered handle returns a `LOGIN_UNKNOWN` isError result
//     and appends NOTHING (login is claim-based, no ledger write);
//   - the session holder is observed via the CONSTRUCTION SEAM (a holder passed into
//     `createBoardServer`), NOT a public "who am I" tool.
//
// The session holder introduced here is first CONSUMED by Story 2.4's `update_focus`
// (see Consumed-by); this test proves the login semantics + that the session is set.
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
 * with a caller-owned {@link SessionIdentity} holder so the test can OBSERVE the
 * session the tools establish (the construction seam — no public "who am I" tool).
 * Returns the connected client and the very holder the server's tools mutate.
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-login-int-'));
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

describe('login over a real MCP client + real ledger (AC #3)', () => {
  it('register H then login H returns H’s identity and the session is now H', async () => {
    const { client, session } = await connect();

    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'shipping 2.3' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();
    // register also establishes the session (FR2/FR37) — observable on the holder.
    expect(session.handle).toBe('ada');

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    // The full snake_case identity is returned (created_at/last_seen from the ledger).
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBe('ada');
    expect(sc.current_focus).toBe('shipping 2.3');
    expect(typeof sc.created_at).toBe('string');
    expect(sc.last_seen).toBe(sc.created_at); // last_seen === created_at (no activity yet)
    expect(new Date(sc.created_at as string).toISOString()).toBe(sc.created_at);

    // The session identity is now H (set by the login tool via the holder).
    expect(session.handle).toBe('ada');
  });

  it('login resolves the canonical handle even after the session was reset (proves login itself sets it)', async () => {
    const { client, session } = await connect();

    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });

    // Simulate a fresh session that has NOT yet authenticated, so the assertion
    // after login proves LOGIN (not the earlier register) set the handle.
    session.handle = null;

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as Record<string, unknown>).handle).toBe(
      'ada',
    );
    expect(session.handle).toBe('ada');
  });

  it('login of a never-registered handle returns LOGIN_UNKNOWN and leaves the session unset', async () => {
    const { client, session } = await connect();

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ghost' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'LOGIN_UNKNOWN' });
    // A failed login must NOT establish a session.
    expect(session.handle).toBeNull();
    // login is claim-based: nothing was appended for the unknown handle.
    const all = await dataAccess!.eventsByType('identity.registered');
    expect(all.filter((e) => e.actor === 'ghost')).toHaveLength(0);
  });

  it('login appends NOTHING — the ledger event count is unchanged across a login', async () => {
    const { client } = await connect();

    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    const before = (await dataAccess!.eventsByType('identity.registered'))
      .length;

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    const after = (await dataAccess!.eventsByType('identity.registered'))
      .length;
    expect(after).toBe(before); // claim-based resolve, no ledger write
  });

  it('rejects an uppercase-but-otherwise-valid handle before core (canonical-only schema, same as register)', async () => {
    const { client, session } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    session.handle = null;

    const result = (await client.callTool({
      name: 'login',
      // "Ada" is in-charset except the uppercase A; the lowercase-only pattern
      // rejects it at the boundary BEFORE core runs (documented AC #3 decision).
      arguments: { handle: 'Ada' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // A Zod validation rejection, NOT a domain error — no closed board code.
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → no session established.
    expect(session.handle).toBeNull();
  });

  it('rejects an out-of-charset handle before core (no LOGIN_UNKNOWN, no session)', async () => {
    const { client, session } = await connect();

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'Ada!' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    expect(textBlock?.text ?? '').toMatch(/validation|invalid|match/i);
    // No board code: it is a validation failure, distinct from LOGIN_UNKNOWN.
    expect(readErrorPayload(result)).toBeUndefined();
    expect(session.handle).toBeNull();
  });
});
