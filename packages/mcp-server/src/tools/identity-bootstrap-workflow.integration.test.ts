// EXECUTION proof for the Story 8.1 identity-bootstrap workflow
// (`integration/bmad/identity-bootstrap.md`) — REAL-RUNTIME evidence (skill-rules
// Rule 3), complementary to the dev's CONTENT-GUARD (`identity-bootstrap-doc.test.ts`).
//
// The content-guard proves the workflow DOC says the right words (it names `register`
// /`login`, covers the three identity cases, states the no-secret rule). It does NOT
// prove the flow the doc prescribes is actually EXECUTABLE against the shipped tools.
// This test closes that gap: it drives the EXACT branches the workflow prescribes
// through a real MCP `Client` ↔ a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING is mocked: the
// wire, the server, the `register`/`login` tools, core, and the ledger are all real.
//
// The workflow (`integration/bmad/identity-bootstrap.md`) prescribes three branches;
// each test below is one of them, using the doc's OWN worked example handle
// (`amelia-dev@taskflow`) so the proof is recognisably the doc's flow:
//
//   Step 3 (no recorded handle → derive `persona@project`, register):
//     - `register{ handle: 'amelia-dev@taskflow', current_focus: 'x' }` SUCCEEDS — i.e.
//       the default `persona@project` handle the doc derives is a LEGAL handle the live
//       tool accepts (the `@` and `-` are in the canonical charset `[a-z0-9._@-]`).
//
//   Step 3 on `HANDLE_TAKEN` (a second `dev` agent → disambiguate with `-2`):
//     - a SECOND `register` of the SAME `amelia-dev@taskflow` returns `HANDLE_TAKEN`;
//       then `register{ handle: 'amelia-dev@taskflow-2' }` (the doc's discriminator
//       strategy) SUCCEEDS — proving the disambiguation actually resolves the collision
//       against the real uniqueness guard.
//
//   Step 2 (recorded handle → login; with the `LOGIN_UNKNOWN` fall-through):
//     - `login{ handle }` of a registered handle SUCCEEDS (re-establishes it);
//     - `login{ handle }` of a never-registered (but "recorded") handle returns
//       `LOGIN_UNKNOWN` — the exact signal the doc's Step 2 fall-through ("recorded but
//       never registered → fall through to register") keys off.
//
// This is an EXECUTION proof of the asset's described flow; the doc-content guard and
// this runtime guard are complementary (says-the-right-words vs. the-words-actually-work).
//
// Harness mirrors `tools/register.integration.test.ts` / `tools/login.integration.test.ts`
// exactly (same `connect()` seam with a caller-owned session holder, same temp-DB
// lifecycle, same `readErrorPayload`). Never touches the repo's real `.agentbbs/`: the DB
// lives under os.tmpdir().

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

// The doc's worked example handle (`persona@project` form): persona `amelia-dev`, project
// slug `taskflow`. Using the doc's literal example keeps this proof recognisably the
// workflow's flow — and exercises that the `@`/`-` the doc relies on are in the live
// canonical charset `[a-z0-9._@-]`.
const DEFAULT_HANDLE = 'amelia-dev@taskflow';
// The doc's first disambiguator on `HANDLE_TAKEN` (Step 3: append `-2`, then `-3`, …).
const DISAMBIGUATED_HANDLE = 'amelia-dev@taskflow-2';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE the session the
 * identity tools establish (the construction seam — no public "who am I" tool). Mirrors
 * the `connect()` in `tools/login.integration.test.ts`.
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

/** Count identity.registered events for a given handle in the real ledger. */
async function registeredCount(handle: string): Promise<number> {
  const events = await dataAccess!.eventsByType('identity.registered');
  return events.filter((e) => e.actor === handle).length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-identity-bootstrap-int-'));
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

describe('identity-bootstrap workflow — EXECUTION proof against the live register/login tools (Story 8.1)', () => {
  it('Step 3 (no recorded handle): the derived `persona@project` default handle registers successfully', async () => {
    // The workflow's no-recorded-handle branch: derive `persona@project` and `register`
    // it. This proves the DERIVED handle (`amelia-dev@taskflow`) is a handle the live
    // tool actually ACCEPTS — the `@`/`-` are in the canonical charset, so the doc's
    // default-handle shape is not merely documented but executable.
    const { client, session } = await connect();

    const result = (await client.callTool({
      name: 'register',
      arguments: {
        handle: DEFAULT_HANDLE,
        current_focus: 'bootstrapping identity',
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBe(DEFAULT_HANDLE);
    expect(sc.current_focus).toBe('bootstrapping identity');
    // The real ledger holds exactly one identity for the derived handle, and the session
    // is established as it (register-or-login establishes the session — the bootstrap's
    // Step 3 success state).
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);
    expect(session.handle).toBe(DEFAULT_HANDLE);
  });

  it('Step 3 on collision (a second `dev`): default handle taken → HANDLE_TAKEN → disambiguate to `-2` → success', async () => {
    // The workflow's `HANDLE_TAKEN` disambiguation branch: a second same-persona agent
    // finds its derived default already claimed and appends `-2`. This proves the doc's
    // discriminator strategy actually RESOLVES the collision against the real uniqueness
    // guard — the registered `-2` handle is a distinct, accepted identity.
    const { client } = await connect();

    // A first agent has already claimed the default handle.
    const first = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'first dev' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();

    // The second agent derives the SAME default → the live tool rejects it HANDLE_TAKEN.
    const collision = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'second dev' },
    })) as CallToolResult;
    expect(collision.isError).toBe(true);
    expect(readErrorPayload(collision)).toMatchObject({ code: 'HANDLE_TAKEN' });
    // The collision appended nothing — still exactly one holder of the default handle.
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);

    // The workflow's disambiguation: append `-2` and re-register. This SUCCEEDS — the
    // disambiguated handle resolves the collision (the whole point of the doc's Step 3
    // retry loop).
    const disambiguated = (await client.callTool({
      name: 'register',
      arguments: {
        handle: DISAMBIGUATED_HANDLE,
        current_focus: 'second dev (disambiguated)',
      },
    })) as CallToolResult;
    expect(disambiguated.isError).toBeFalsy();
    expect(
      (disambiguated.structuredContent as Record<string, unknown>).handle,
    ).toBe(DISAMBIGUATED_HANDLE);
    // Two distinct identities now exist — the collision was genuinely resolved, not
    // silently merged.
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);
    expect(await registeredCount(DISAMBIGUATED_HANDLE)).toBe(1);
  });

  it('Step 2 (recorded handle): `login` re-establishes a registered handle; an unknown recorded handle returns LOGIN_UNKNOWN', async () => {
    // The workflow's recorded-handle branch: a handle recorded in AGENTS.md → `login`
    // with it. This proves BOTH halves of the doc's Step 2:
    //   (a) a recorded handle that WAS registered → `login` re-establishes it; and
    //   (b) a recorded handle that was NEVER registered → `login` returns LOGIN_UNKNOWN,
    //       the exact signal the doc's fall-through ("recorded but never registered →
    //       fall through to register") keys off.
    const { client, session } = await connect();

    // A prior session registered and recorded this handle (the steady state Step 1 finds).
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'prior session' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();

    // Simulate a FRESH session that has only the recorded handle (not yet authenticated),
    // so the post-login assertion proves LOGIN — not the earlier register — established it.
    session.handle = null;

    // (a) Recorded + registered → `login` re-establishes the SAME stable identity (the
    // doc's "reuse it across sessions; do not register a second one").
    const ok = (await client.callTool({
      name: 'login',
      arguments: { handle: DEFAULT_HANDLE },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as Record<string, unknown>).handle).toBe(
      DEFAULT_HANDLE,
    );
    expect(session.handle).toBe(DEFAULT_HANDLE);
    // login is claim-based (NFR7) — it appends NOTHING; the ledger still holds exactly
    // the one registration. (This is the basis for the doc's "no secret, the handle is
    // the credential" claim being executable, not just stated.)
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);

    // (b) Recorded but NEVER registered (e.g. a fresh/reset DB) → `login` returns
    // LOGIN_UNKNOWN, which is precisely the trigger for the doc's register-and-record
    // fall-through. A failed login must not establish a session.
    session.handle = null;
    const unknown = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ghost@taskflow' },
    })) as CallToolResult;
    expect(unknown.isError).toBe(true);
    expect(readErrorPayload(unknown)).toMatchObject({ code: 'LOGIN_UNKNOWN' });
    expect(session.handle).toBeNull();
    // The fall-through is genuinely available: re-registering the SAME recorded handle
    // after a LOGIN_UNKNOWN succeeds (the doc's "reuse the recorded handle" path), so a
    // recorded-but-unregistered handle is not a dead end.
    const recovered = (await client.callTool({
      name: 'register',
      arguments: {
        handle: 'ghost@taskflow',
        current_focus: 'recovered after LOGIN_UNKNOWN',
      },
    })) as CallToolResult;
    expect(recovered.isError).toBeFalsy();
    expect(
      (recovered.structuredContent as Record<string, unknown>).handle,
    ).toBe('ghost@taskflow');
    expect(session.handle).toBe('ghost@taskflow');
  });
});
