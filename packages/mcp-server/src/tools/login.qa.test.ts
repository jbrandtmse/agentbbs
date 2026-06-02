// QA-added coverage (Story 2.3, AC #3 / Task 4) — REAL-RUNTIME (skill-rules
// Rule 3), real `Client`↔`McpServer` over `InMemoryTransport`.
//
// Mirrors register.qa.test.ts for the `login` tool: the Task 4 brief requires that
// an invalid-charset handle is rejected by Zod BEFORE the core delegate runs, with
// the dataAccess SPY NEVER invoked. The login integration test proves the
// real-ledger outcomes; this file pins the boundary-rejection contract DIRECTLY by
// injecting a spying DataAccess into the real `login` tool (via the real
// `createBoardServer` path) and asserting `eventsByActor` (core.login's first act)
// is never called on invalid input.
//
// Control: a VALID handle DOES reach the delegate — the same spy records exactly one
// `eventsByActor`, proving the "zero calls" on the invalid cases is meaningful (the
// spy would have fired had validation passed). The fake's eventsByActor throws, so
// the tool surfaces INTERNAL_ERROR — but the call COUNT is the point.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardServer } from '../server.js';
import { readErrorPayload } from '../error-map.js';

import type { DataAccess } from '@agentbbs/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * A DataAccess whose every method is a `vi.fn` spy that ALSO throws if called. The
 * spies let a test assert a method was NEVER reached (the AC #3 proof that core did
 * not run); the throw makes an unexpected call loud rather than a silent wrong path.
 */
function spyDataAccess(): {
  da: DataAccess;
  spies: Record<keyof DataAccess, ReturnType<typeof vi.fn>>;
} {
  const make = (name: string): ReturnType<typeof vi.fn> =>
    vi.fn(() => {
      throw new Error(`spyDataAccess.${name} was called`);
    });
  const spies = {
    append: make('append'),
    appendGuarded: make('appendGuarded'),
    eventsSince: make('eventsSince'),
    eventsByType: make('eventsByType'),
    eventsByActor: make('eventsByActor'),
    maxSeq: make('maxSeq'),
    getCursor: make('getCursor'),
    setCursor: make('setCursor'),
  } satisfies Record<keyof DataAccess, ReturnType<typeof vi.fn>>;
  const da = spies as unknown as DataAccess;
  return { da, spies };
}

const disposers: (() => Promise<void>)[] = [];

/** Connect a real Client to a login-tool server backed by the given DataAccess. */
async function connect(dataAccess: DataAccess): Promise<Client> {
  const server = createBoardServer({ dataAccess });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'qa-client', version: '0.0.0' });
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

afterEach(async () => {
  while (disposers.length > 0) {
    await disposers.pop()?.();
  }
});

describe('login tool — validation happens BEFORE core (AC #3, dataAccess spy)', () => {
  it.each([
    ['out-of-charset ("Ada!")', 'Ada!'],
    ['uppercase-only ("Ada")', 'Ada'],
    ['embedded space ("a b")', 'a b'],
    ['leading slash ("/ada")', '/ada'],
    ['unicode ("adä")', 'adä'],
    ['empty handle ("")', ''],
  ])(
    'rejects %s at the Zod boundary — core.login is NEVER reached (no dataAccess call)',
    async (_label, handle) => {
      const { da, spies } = spyDataAccess();
      const client = await connect(da);

      const result = (await client.callTool({
        name: 'login',
        arguments: { handle },
      })) as CallToolResult;

      // Rejected as an isError with NO board code (a validation failure, not a
      // domain error — distinct from LOGIN_UNKNOWN).
      expect(result.isError).toBe(true);
      expect(readErrorPayload(result)).toBeUndefined();

      // THE LOAD-BEARING ASSERTION: not one DataAccess method was touched, so
      // `core.login` (whose first act is eventsByActor) never ran. Zod rejected the
      // call at the SDK boundary before the delegate.
      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects a missing handle before core (no dataAccess call)', async () => {
    const { da, spies } = spyDataAccess();
    const client = await connect(da);

    const result = (await client.callTool({
      name: 'login',
      // handle omitted → schema violation (it is required, min(1)).
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('CONTROL: a VALID handle DOES reach core — eventsByActor fires exactly once', async () => {
    // The mirror of the rejection cases: proves the spy WOULD record a call had
    // validation passed, so the "never called" assertions above are meaningful. The
    // spy throws, so the delegate's eventsByActor rejects and the tool surfaces
    // INTERNAL_ERROR — but the call COUNT is the point.
    const { da, spies } = spyDataAccess();
    const client = await connect(da);

    const result = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ada' },
    })) as CallToolResult;

    // Valid input → core ran → eventsByActor was invoked exactly once with the
    // canonical handle (core.login's resolve read).
    expect(spies.eventsByActor).toHaveBeenCalledTimes(1);
    expect(spies.eventsByActor).toHaveBeenCalledWith('ada');
    // login performs NO write even on the happy path — append paths stay untouched.
    expect(spies.append).not.toHaveBeenCalled();
    expect(spies.appendGuarded).not.toHaveBeenCalled();
    // The fake read threw, so the result is INTERNAL_ERROR (the throw is NOT a
    // BoardError, so error-map maps it to the non-board sentinel — never leaking the
    // cause, and distinguishable from LOGIN_UNKNOWN).
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
