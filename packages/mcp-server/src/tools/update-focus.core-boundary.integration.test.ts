// Core-boundary SPY evidence for `update_focus` (Story 2.4 QA hardening).
//
// The sibling `update-focus.integration.test.ts` proves NO event is appended on the
// rejection paths via the real ledger size (an OBSERVABLE proxy). This file makes
// the stronger, more direct claim the QA brief asks for: that the no-session and
// invalid-input rejections short-circuit BEFORE the core board operation is even
// invoked — i.e. `core.updateFocus` is never CALLED — with a valid control proving
// the spy DOES fire on the happy path (so a green "not called" is meaningful, not a
// spy that never wires up).
//
// Why a dedicated file with `vi.mock`: `@agentbbs/core` is consumed as a built ESM
// dist whose namespace exports are read-only, so `vi.spyOn(coreNamespace, …)` would
// throw ("cannot assign to read only property"). The idiomatic Vitest pattern is
// `vi.mock(module, importOriginal)` returning the REAL module with only the one
// export wrapped in a delegating `vi.fn` — preserving every other export (BoardError,
// register, login) and the real `updateFocus` behavior. Scoping this to its own file
// keeps the pristine real-runtime integration file free of any module mocking.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import * as core from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Replace ONLY `core.updateFocus` with a spy that delegates to the real impl, so the
// board operation still runs identically when it IS reached (the control), while we
// can assert it is NEVER reached on the rejection paths. Every other core export is
// the genuine one (BoardError must stay real — the tool throws it for NO_IDENTITY).
vi.mock('@agentbbs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentbbs/core')>();
  return {
    ...actual,
    updateFocus: vi.fn(actual.updateFocus),
  };
});

const updateFocusSpy = vi.mocked(core.updateFocus);

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

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
  updateFocusSpy.mockClear();
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-update-focus-spy-'));
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

describe('update_focus short-circuits before core on rejection (spy evidence, QA)', () => {
  it('NO-SESSION: core.updateFocus is NEVER called (the NO_IDENTITY guard precedes the board op)', async () => {
    const { client } = await connect();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'whatever' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    // The session precondition rejected BEFORE delegating to core.
    expect(updateFocusSpy).not.toHaveBeenCalled();
  });

  it('INVALID INPUT (empty current_focus): rejected by Zod BEFORE the delegate, so core.updateFocus is NEVER called', async () => {
    const { client } = await connect();
    // Establish a real session so the ONLY thing that can reject is the Zod schema —
    // this isolates "validation precedes core", not the session guard.
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: '' }, // violates focusSchema.min(1)
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    // SDK InvalidParams (not a board code) — and core was never reached.
    expect(readErrorPayload(result)).toBeUndefined();
    expect(updateFocusSpy).not.toHaveBeenCalled();
  });

  it('INVALID INPUT (missing current_focus): core.updateFocus is NEVER called', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: {}, // required field omitted
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(updateFocusSpy).not.toHaveBeenCalled();
  });

  it('INVALID INPUT (too long): core.updateFocus is NEVER called', async () => {
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'real focus' },
    });

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'x'.repeat(281) }, // past FOCUS_MAX_LENGTH
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(updateFocusSpy).not.toHaveBeenCalled();
  });

  it('CONTROL — a valid established call DOES reach core.updateFocus exactly once (so the "not called" assertions are meaningful)', async () => {
    const { client, session } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'old' },
    });
    expect(session.handle).toBe('ada');
    // Clear the spy so we count ONLY this update_focus call (register does not call it).
    updateFocusSpy.mockClear();

    const result = (await client.callTool({
      name: 'update_focus',
      arguments: { current_focus: 'new' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as Record<string, unknown>).current_focus,
    ).toBe('new');
    // Core WAS reached — exactly once — with the session handle as the actor and the
    // validated focus (proving the spy wires up; the negative assertions are real).
    expect(updateFocusSpy).toHaveBeenCalledTimes(1);
    expect(updateFocusSpy).toHaveBeenCalledWith(dataAccess, 'ada', 'new');
  });
});
