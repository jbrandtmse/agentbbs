// Integration AC #3 (Story 2.4, Task 5) — REAL-RUNTIME evidence (skill-rules
// Rule 3). A real MCP `Client` talks to a `createBoardServer`-built `McpServer`
// over the SDK's `InMemoryTransport`, backed by the REAL `createDataAccess`
// (better-sqlite3 behind the NFR2 seam) against a genuine SQLite file in an OS temp
// dir. NOTHING in the stack is mocked: the wire, the server, the `update_focus`
// tool, core, the session holder, and the ledger are all real.
//
// Asserts the AC #3 outcomes for `update_focus`:
//   - a client registers `H` (establishing the session), then `update_focus` with a
//     new focus appends an identity.focus_updated for `H`; the returned/derived
//     identity's current_focus is the NEW value and last_seen has advanced to the
//     new event's time;
//   - APPEND-ONLY (the heart of AC #1): the original identity.registered event
//     (with the OLD focus) STILL exists in the ledger — nothing was overwritten;
//   - calling `update_focus` on a FRESH connection with NO session returns a
//     NO_IDENTITY isError result and appends NOTHING.
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
 * Returns the connected client and the holder the server's tools mutate.
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

/** Total event count in the real ledger (across all types). */
async function totalEvents(): Promise<number> {
  return (await dataAccess!.eventsSince(0)).length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-update-focus-int-'));
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

describe('update_focus over a real MCP client + real ledger (AC #3)', () => {
  it('register H then update_focus appends focus_updated, derives the new focus + advanced last_seen, and RETAINS the original registration (append-only)', async () => {
    const { client } = await connect();

    // Register `ada` with the OLD focus — this establishes the session.
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'old focus' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();
    const registeredAt = (reg.structuredContent as Record<string, unknown>)
      .created_at as string;

    // Update the focus to a NEW value (no handle param — the actor is the session).
    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'new focus' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // The derived/returned identity shows the NEW focus; handle + created_at pinned.
    expect(sc.handle).toBe('ada');
    expect(sc.current_focus).toBe('new focus');
    expect(sc.created_at).toBe(registeredAt);

    // The ledger now holds BOTH events for ada (append-only):
    const adaEvents = (await dataAccess!.eventsByActor('ada')).sort(
      (a, b) => a.seq - b.seq,
    );
    expect(adaEvents.map((e) => e.type)).toEqual([
      'identity.registered',
      'identity.focus_updated',
    ]);
    // The ORIGINAL identity.registered event still carries the OLD focus — proof
    // nothing was overwritten; the directory's current_focus is the DERIVED latest.
    const registered = adaEvents[0];
    expect(registered?.type).toBe('identity.registered');
    expect((registered?.payload as { currentFocus: string }).currentFocus).toBe(
      'old focus',
    );
    // The focus_updated event carries the NEW focus.
    const updated = adaEvents[1];
    expect((updated?.payload as { currentFocus: string }).currentFocus).toBe(
      'new focus',
    );

    // last_seen advanced to the NEW event's created_at (the AC's "advanced to the
    // new event's time"). Robust to clock granularity: last_seen is taken from the
    // focus_updated event, and is never earlier than created_at.
    expect(sc.last_seen).toBe(updated?.createdAt);
    expect((sc.last_seen as string) >= (sc.created_at as string)).toBe(true);
    // When the two appends landed in different milliseconds, last_seen strictly
    // advanced past the registration time (it never regresses to it).
    if (updated?.createdAt !== registeredAt) {
      expect(sc.last_seen).not.toBe(registeredAt);
    }
  });

  it('LOGIN (not just register) establishes the session so update_focus then works for that handle (QA)', async () => {
    // The session precondition is satisfied by EITHER register or login — the brief
    // asks us to prove login also establishes it (Story 2.3 wires both). First a
    // client registers `ada` (so the identity exists in the ledger). Then a SECOND,
    // FRESH connection — with no session of its own — `login`s as `ada` and runs
    // update_focus, which must succeed for `ada` (the actor came from the login).
    const first = await connect();
    await first.client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'registered focus' },
    });

    // A brand-new connection: its session starts unestablished.
    const { client, session } = await connect();
    expect(session.handle).toBeNull();

    const loginResult = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;
    expect(loginResult.isError).toBeFalsy();
    // login established the session as `ada` on THIS connection.
    expect(session.handle).toBe('ada');

    // update_focus now succeeds, attributed to the logged-in handle (no handle param).
    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'focus via login' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBe('ada');
    expect(sc.current_focus).toBe('focus via login');

    // The focus_updated landed in the ledger for `ada` (one registration + one update).
    const adaEvents = await dataAccess!.eventsByActor('ada');
    expect(
      adaEvents.filter((e) => e.type === 'identity.focus_updated'),
    ).toHaveLength(1);
    // login itself appended NOTHING (claim-based) — only register + the focus update.
    expect(
      adaEvents.filter((e) => e.type === 'identity.registered'),
    ).toHaveLength(1);
  });

  it('sequential update_focus calls keep appending — the latest derived focus wins and the registration is retained', async () => {
    const { client } = await connect();

    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'focus-0' },
    });
    await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'focus-1' },
    });
    const last = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'focus-2' },
    })) as CallToolResult;

    expect(
      (last.structuredContent as Record<string, unknown>).current_focus,
    ).toBe('focus-2');
    // One registration + two focus updates retained in the ledger (append-only).
    const adaEvents = await dataAccess!.eventsByActor('ada');
    expect(
      adaEvents.filter((e) => e.type === 'identity.registered'),
    ).toHaveLength(1);
    expect(
      adaEvents.filter((e) => e.type === 'identity.focus_updated'),
    ).toHaveLength(2);
  });

  it('last_seen advances (never regresses) across N updates and always equals the latest focus_updated event created_at over the real ledger (QA)', async () => {
    const { client } = await connect();
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'focus-0' },
    })) as CallToolResult;
    const registeredAt = (reg.structuredContent as Record<string, unknown>)
      .created_at as string;

    let prevLastSeen = registeredAt;
    for (let i = 1; i <= 4; i += 1) {
      const result = (await client.callTool({
        name: 'update_focus',
        arguments: { current_focus: `focus-${i}` },
      })) as CallToolResult;
      const sc = result.structuredContent as Record<string, unknown>;
      const lastSeen = sc.last_seen as string;

      // DERIVATION (deterministic): last_seen equals the createdAt of the LATEST
      // identity.focus_updated event in the real ledger — read, never fabricated.
      const updates = (await dataAccess!.eventsByActor('ada'))
        .filter((e) => e.type === 'identity.focus_updated')
        .sort((a, b) => a.seq - b.seq);
      const latest = updates[updates.length - 1];
      expect(lastSeen).toBe(latest?.createdAt);
      // NON-REGRESSION: last_seen is monotonic across updates (ISO-8601 UTC strings
      // sort lexicographically === chronologically), never moving backwards. Under
      // ms-granularity collisions it may equal the previous value; it must never be
      // earlier (the append invariant: a later event's createdAt is >= an earlier's).
      expect(lastSeen >= prevLastSeen).toBe(true);
      // It also never regresses below the registration time.
      expect(lastSeen >= registeredAt).toBe(true);
      prevLastSeen = lastSeen;
    }
  });

  it('append-only over the real ledger: each update grows the TOTAL ledger by exactly one and the original registration survives all N updates (QA)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'focus-0' },
    });
    // After registration the ledger holds exactly one row.
    expect(await totalEvents()).toBe(1);

    const N = 4;
    let prev = 1;
    for (let i = 1; i <= N; i += 1) {
      const result = (await client.callTool({
        name: 'update_focus',
        arguments: { current_focus: `focus-${i}` },
      })) as CallToolResult;
      expect(result.isError).toBeFalsy();
      // Exactly ONE new row per update — nothing overwritten (the AC #1 guarantee
      // over the genuine SQLite ledger).
      const after = await totalEvents();
      expect(after).toBe(prev + 1);
      prev = after;

      // The ORIGINAL identity.registered row (with the very first focus) still
      // exists, unchanged, after every update.
      const registrations = await dataAccess!.eventsByType(
        'identity.registered',
      );
      expect(registrations).toHaveLength(1);
      expect(
        (registrations[0]?.payload as { currentFocus: string }).currentFocus,
      ).toBe('focus-0');
    }

    // Final: 1 registration + N focus updates = N + 1 rows; derived focus is latest.
    expect(await totalEvents()).toBe(N + 1);
    const sc = (
      (await client.callTool({
        name: 'update_focus',
        arguments: { current_focus: 'final' },
      })) as CallToolResult
    ).structuredContent as Record<string, unknown>;
    expect(sc.current_focus).toBe('final');
  });

  it('the success result is EXACTLY the snake_case identity shape — { handle, current_focus, created_at, last_seen }, no camelCase leakage (QA)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'old' },
    });
    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'new' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // Exact key set — snake_case only, nothing extra.
    expect(Object.keys(sc).sort()).toEqual([
      'created_at',
      'current_focus',
      'handle',
      'last_seen',
    ]);
    // No camelCase leakage of the multi-word fields onto the wire.
    expect(sc).not.toHaveProperty('currentFocus');
    expect(sc).not.toHaveProperty('createdAt');
    expect(sc).not.toHaveProperty('lastSeen');
    // Every value is a string (ISO timestamps + handle + focus), not a 0/1 or object.
    for (const v of Object.values(sc)) expect(typeof v).toBe('string');

    // The text content block carries the IDENTICAL snake_case payload (parity with
    // structuredContent), so a client reading either view sees the same object.
    const textBlock = result.content.find(
      (b): b is { type: 'text'; text: string } => b.type === 'text',
    );
    expect(textBlock).toBeDefined();
    expect(JSON.parse(textBlock!.text)).toEqual(sc);
  });

  it('update_focus on a FRESH connection with no session returns NO_IDENTITY and appends NOTHING', async () => {
    const { client, session } = await connect();
    // No register/login on this connection — the session is unestablished.
    expect(session.handle).toBeNull();
    const before = await totalEvents();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'whatever' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    // The session is still unestablished, and NO event was appended on this path.
    expect(session.handle).toBeNull();
    expect(await totalEvents()).toBe(before);
    expect(before).toBe(0); // nothing in the ledger at all
  });

  it('NO_IDENTITY carries the full { code, message } contract — a non-empty message, not just the code', async () => {
    const { client } = await connect();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'x' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const payload = readErrorPayload(result);
    expect(payload?.code).toBe('NO_IDENTITY');
    expect(typeof payload?.message).toBe('string');
    expect((payload?.message ?? '').length).toBeGreaterThan(0);
  });

  it('rejects an empty current_focus at the boundary BEFORE core (no event appended)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });
    const before = await totalEvents();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: '' }, // violates focusSchema.min(1)
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // A Zod validation rejection, NOT a domain error — no closed board code.
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → no identity.focus_updated appended.
    expect(await totalEvents()).toBe(before);
    expect(
      await dataAccess!.eventsByType('identity.focus_updated'),
    ).toHaveLength(0);
  });

  it('rejects a MISSING current_focus at the boundary BEFORE core (no event appended) (QA)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });
    const before = await totalEvents();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: {}, // current_focus omitted — violates the required focusSchema
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // A Zod/SDK InvalidParams rejection, NOT a closed board code.
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → nothing appended.
    expect(await totalEvents()).toBe(before);
    expect(
      await dataAccess!.eventsByType('identity.focus_updated'),
    ).toHaveLength(0);
  });

  it('rejects a TOO-LONG current_focus (> 280 chars) at the boundary BEFORE core (no event appended) (QA)', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });
    const before = await totalEvents();

    // 281 chars — one past the shared focusSchema max (FOCUS_MAX_LENGTH = 280).
    const tooLong = 'x'.repeat(281);
    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: tooLong },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toBeUndefined();
    // Rejected before core → nothing appended.
    expect(await totalEvents()).toBe(before);
    expect(
      await dataAccess!.eventsByType('identity.focus_updated'),
    ).toHaveLength(0);

    // CONTROL: a focus AT the 280 limit is accepted (proves the bound is inclusive,
    // not off-by-one — the rejection above is the length cap, not a blanket reject).
    const atLimit = 'y'.repeat(280);
    const ok = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: atLimit },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    expect(
      (ok.structuredContent as Record<string, unknown>).current_focus,
    ).toBe(atLimit);
  });
});
