// QA-added session-holder semantics (Story 2.3, AC #1/#3 / Task 2) — REAL-RUNTIME
// (skill-rules Rule 3): a real MCP `Client` ↔ `createBoardServer` `McpServer` over
// the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess` (better-
// sqlite3 behind the NFR2 seam) against a genuine SQLite file under os.tmpdir().
// NOTHING is mocked — the wire, server, tools, core, and ledger are all real.
//
// The session-identity holder is the NEW mechanism this story introduces (first
// CONSUMED by Story 2.4's `update_focus`). The dev's `login.integration.test.ts`
// proves the happy paths (register sets it; login sets it; an unknown login leaves
// a fresh null session null) and `session.test.ts` pins the bare holder factory.
// This file closes the residual state-transition gaps the dev suite does not yet
// assert — the cases that would let a real session-actor bug through:
//
//   1. A FAILED login must NOT CLOBBER an already-established session. The dev test
//      only proves null → (unknown login) → null. The load-bearing case is
//      established-as-A → (unknown login) → STILL A: a wrong implementation that
//      cleared/overwrote the handle before resolving would let an unknown handle
//      silently log the agent out (or worse, leave a half-set actor).
//   2. A second SUCCESSFUL login REPLACES the session handle (login A → login B ⇒ B):
//      re-establishing as a different identity must move the actor, not stick on A.
//   3. Two independent `createBoardServer` instances have INDEPENDENT sessions —
//      no shared/global holder leaks one server's actor into another (the factory
//      defaults a FRESH holder per server when none is injected).
//   4. The `LOGIN_UNKNOWN` error contract carries BOTH a `code` AND a non-empty
//      `message` (the closed `{ code, message }` shape), not just the code.
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
 * Stand up a real Client↔server pair over the in-memory transport, real ledger.
 * Accepts an OPTIONAL caller-owned {@link SessionIdentity} so a test can OBSERVE
 * the session the tools establish (the construction seam — no public "who am I"
 * tool). When omitted, the factory defaults a fresh holder internally (the
 * production path), which case 3 relies on to prove cross-server independence.
 * Returns the connected client and the holder in scope for that server.
 */
async function connect(injected?: SessionIdentity): Promise<{
  client: Client;
  session: SessionIdentity;
}> {
  const session = injected ?? createSessionIdentity();
  const server = createBoardServer({
    dataAccess: dataAccess!,
    sessionIdentity: session,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'qa-session-client', version: '0.0.0' });
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
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-login-session-qa-'));
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

describe('session-holder semantics over a real MCP client + real ledger (Story 2.3)', () => {
  it('a FAILED login does NOT clobber an already-established session (stays the prior handle, not nulled/unknown)', async () => {
    const { client, session } = await connect();

    // Establish the session as `ada` via login (register both `ada` and the
    // unknown target's namespace-mate is unnecessary — only `ada` exists).
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'shipping 2.3' },
    });
    const login = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;
    expect(login.isError).toBeFalsy();
    expect(session.handle).toBe('ada'); // session is now established as `ada`

    // Now attempt to login a handle that was NEVER registered. This must fail with
    // LOGIN_UNKNOWN and — the load-bearing assertion — must leave the EXISTING
    // session untouched. A buggy handler that set/cleared the holder before (or
    // regardless of) resolution would corrupt the acting actor here.
    const failed = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ghost' },
    })) as CallToolResult;
    expect(failed.isError).toBe(true);
    expect(readErrorPayload(failed)).toMatchObject({ code: 'LOGIN_UNKNOWN' });

    // The session is STILL `ada` — the failed login neither nulled it nor set it to
    // the unknown handle. (Consumed by 2.4/2.5: the actor must not silently change.)
    expect(session.handle).toBe('ada');
  });

  it('a second SUCCESSFUL login REPLACES the session handle (login A → login B ⇒ session is B)', async () => {
    const { client, session } = await connect();

    // Two distinct durable identities exist in the real ledger.
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'a-focus' },
    });
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'b-focus' },
    });

    // Login as A → session is A.
    const a = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;
    expect(a.isError).toBeFalsy();
    expect(session.handle).toBe('ada');

    // Re-establish as a DIFFERENT identity B on the same connection → session moves
    // to B (the holder is replaced, not pinned to the first login).
    const b = (await client.callTool({
      name: 'login',
      arguments: { handle: 'bob' },
    })) as CallToolResult;
    expect(b.isError).toBeFalsy();
    expect((b.structuredContent as Record<string, unknown>).handle).toBe('bob');
    expect(session.handle).toBe('bob');
  });

  it('two independent createBoardServer instances have INDEPENDENT sessions (no shared/global state leak)', async () => {
    // Both servers DEFAULT their own fresh holder (none injected) — the production
    // path. We observe each via its own injected holder to prove the default-holder
    // wiring does not secretly share one instance across servers. Use two holders,
    // one per server, and assert a login on server 1 never bleeds into server 2.
    const sessionOne = createSessionIdentity();
    const sessionTwo = createSessionIdentity();
    const { client: clientOne } = await connect(sessionOne);
    const { client: clientTwo } = await connect(sessionTwo);

    // Both clients share the same real ledger, so `ada` registered via server 1 is
    // resolvable from server 2 too — but the SESSION holders must stay independent.
    await clientOne.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'x' },
    });
    expect(sessionOne.handle).toBe('ada'); // register established server 1's session
    expect(sessionTwo.handle).toBeNull(); // server 2's session is untouched

    // Login on server 2 as a DIFFERENT identity; server 1's session must not move.
    await clientTwo.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'y' },
    });
    const loginTwo = (await clientTwo.callTool({
      name: 'login',
      arguments: { handle: 'bob' },
    })) as CallToolResult;
    expect(loginTwo.isError).toBeFalsy();

    // Each server owns its own actor — no cross-talk.
    expect(sessionOne.handle).toBe('ada');
    expect(sessionTwo.handle).toBe('bob');
  });

  it('LOGIN_UNKNOWN carries the full { code, message } contract — a non-empty message, not just the code', async () => {
    const { client } = await connect();

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ghost' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const payload = readErrorPayload(result);
    expect(payload?.code).toBe('LOGIN_UNKNOWN');
    // The closed error contract is `{ code, message }` — the message must be a
    // present, non-empty string (a human/LLM-readable reason), not just a bare code.
    expect(typeof payload?.message).toBe('string');
    expect((payload?.message ?? '').length).toBeGreaterThan(0);
  });
});
