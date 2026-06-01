// QA-added coverage (Story 2.2, AC #3 / Task 4) — REAL-RUNTIME (skill-rules
// Rule 3), real `Client`↔`McpServer` over `InMemoryTransport`.
//
// Complements the dev's register.integration.test.ts. That file proves invalid
// input appends nothing by inspecting the ledger AFTER the call — a useful but
// INDIRECT proxy for AC #3's actual contract ("Zod rejects it BEFORE reaching
// core"). The brief calls this gap out explicitly: the register integration test
// must prove an invalid handle is rejected by Zod BEFORE the core delegate runs,
// with the delegate / dataAccess SPY NEVER invoked.
//
// So this file injects a SPYING DataAccess into the REAL `register` tool (via the
// real `createBoardServer` → `registerRegisterTool` path) whose every method is a
// `vi.fn` that also throws. Because `core.register`'s very first act is to call
// `dataAccess.appendGuarded`, a spy that records ZERO calls is positive proof the
// core delegate never executed — Zod rejected the call at the SDK boundary first.
// (A throwing-only fake could only prove "no error escaped"; the call-count spy is
// the load-bearing evidence the delegate was never entered.)
//
// Conversely, a VALID call MUST reach the delegate: the same spy records exactly
// one `appendGuarded` (then surfaces its throw as an INTERNAL_ERROR, since this
// fake has no real store) — the control that proves the spy would have fired had
// validation passed, so the "zero calls" on the invalid cases is meaningful.
//
// No SQLite here: the boundary-rejection contract is about whether core is reached,
// which the spy observes directly. The real-ledger outcomes live in the dev's
// integration test.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardServer } from '../server.js';
import { readErrorPayload } from '../error-map.js';

import type { DataAccess } from '@agentbbs/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * A DataAccess whose every method is a `vi.fn` spy that ALSO throws if called.
 * The spies let a test assert a method was NEVER reached (the AC #3 proof that
 * core did not run); the throw guarantees that if one IS reached unexpectedly the
 * failure is loud rather than a silent wrong-path success.
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

/** Connect a real Client to a register-tool server backed by the given DataAccess. */
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

describe('register tool — validation happens BEFORE core (AC #3, dataAccess spy)', () => {
  it.each([
    ['out-of-charset ("Ada!")', 'Ada!'],
    ['uppercase-only ("Ada")', 'Ada'],
    ['embedded space ("a b")', 'a b'],
    ['leading slash ("/ada")', '/ada'],
    ['unicode ("adä")', 'adä'],
    ['empty handle ("")', ''],
  ])(
    'rejects %s at the Zod boundary — core is NEVER reached (no dataAccess call)',
    async (_label, handle) => {
      const { da, spies } = spyDataAccess();
      const client = await connect(da);

      const result = (await client.callTool({
        name: 'register',
        arguments: { handle, current_focus: 'x' },
      })) as CallToolResult;

      // Rejected as an isError with NO board code (a validation failure, not a
      // domain error).
      expect(result.isError).toBe(true);
      expect(readErrorPayload(result)).toBeUndefined();

      // THE LOAD-BEARING ASSERTION: not one DataAccess method was touched, so
      // `core.register` (whose first act is appendGuarded) never ran. Zod rejected
      // the call at the SDK boundary before the delegate.
      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects a missing current_focus before core (no dataAccess call)', async () => {
    const { da, spies } = spyDataAccess();
    const client = await connect(da);

    const result = (await client.callTool({
      name: 'register',
      // current_focus omitted → schema violation (it is required, min(1)).
      arguments: { handle: 'ada' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('rejects an empty current_focus before core (min(1); no dataAccess call)', async () => {
    const { da, spies } = spyDataAccess();
    const client = await connect(da);

    const result = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: '' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('CONTROL: a VALID call DOES reach core — appendGuarded fires exactly once', async () => {
    // The mirror of the rejection cases: it proves the spy WOULD record a call had
    // validation passed, so the "never called" assertions above are meaningful
    // (not a false pass from, say, the tool silently no-op-ing). The spy throws, so
    // the delegate's appendGuarded rejects and the tool surfaces INTERNAL_ERROR —
    // but the call COUNT is the point.
    const { da, spies } = spyDataAccess();
    const client = await connect(da);

    const result = (await client.callTool({
      name: 'register',
      arguments: { handle: 'ada', current_focus: 'valid focus' },
    })) as CallToolResult;

    // Valid input → core ran → appendGuarded was invoked exactly once with the
    // canonical handle event + the handle uniqueness guard.
    expect(spies.appendGuarded).toHaveBeenCalledTimes(1);
    expect(spies.appendGuarded).toHaveBeenCalledWith(
      [
        {
          type: 'identity.registered',
          actor: 'ada',
          payload: { handle: 'ada', currentFocus: 'valid focus' },
        },
      ],
      [{ type: 'identity.registered', field: 'handle', value: 'ada' }],
    );
    // The fake store threw, so the result is an INTERNAL_ERROR (the throw is NOT a
    // BoardError, so error-map maps it to the non-board sentinel — never leaking
    // the cause, and distinguishable from HANDLE_TAKEN).
    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
