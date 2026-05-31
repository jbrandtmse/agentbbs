// Integration test — the binding Integration AC (Story 2.1, AC #3).
//
// This is the REAL-RUNTIME evidence (skill-rules Rule 3) for the MCP surface: a
// real `Client` talking to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport.createLinkedPair()` — NOT a hand-rolled mock of the SDK. A
// representative tool is registered through the SAME production `registerCoreTool`
// helper the identity tools (Stories 2.2–2.5) will use, with a test-controlled
// fake `DataAccess` and a test-controlled delegate.
//
// Asserts the three AC #3 outcomes:
//   (a) a valid call returns a success result;
//   (b) input that violates the Zod schema is rejected BEFORE the core delegate
//       runs — the delegate is NEVER invoked;
//   (c) a delegate that throws a `BoardError` produces an `isError: true` result
//       whose payload carries the exact `{ code, message }`, `code ∈ BOARD_ERROR_CODES`.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BOARD_ERROR_CODES, BoardError } from '@agentbbs/core';
import type { DataAccess } from '@agentbbs/core';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardServer } from './server.js';
import { readErrorPayload } from './error-map.js';
import { registerCoreTool } from './register-tool.js';
import type { CoreToolDelegate } from './register-tool.js';

// A fake DataAccess: the bootstrap test never touches a real SQLite file (Dev
// Notes). Methods throw if called — the representative tool below does not use the
// port, so any call would be an unexpected coupling and should fail loudly.
function fakeDataAccess(): DataAccess {
  const unused = (name: string) => (): never => {
    throw new Error(`fakeDataAccess.${name} should not be called in this test`);
  };
  return {
    append: unused('append'),
    eventsSince: unused('eventsSince'),
    eventsByType: unused('eventsByType'),
    eventsByActor: unused('eventsByActor'),
    maxSeq: unused('maxSeq'),
  };
}

// The representative tool's input shape: snake_case param names at the MCP wire
// boundary (project convention). `current_focus` proves multi-field + the casing.
const REPRESENTATIVE_SHAPE = {
  handle: z.string().min(1),
  current_focus: z.string(),
} as const;

/**
 * Stand up a real client<->server pair over the in-memory transport, with a
 * representative tool registered through `registerCoreTool` using the supplied
 * delegate. Returns the connected client plus the delegate spy and a disposer.
 */
async function connectWithTool(
  delegate: CoreToolDelegate<typeof REPRESENTATIVE_SHAPE>,
) {
  const delegateSpy = vi.fn(delegate);
  const server = createBoardServer({ dataAccess: fakeDataAccess() });

  // The SAME production path the identity tools will use.
  registerCoreTool(
    server,
    'representative',
    {
      description: 'A representative tool that proves the bootstrap pattern.',
      inputSchema: REPRESENTATIVE_SHAPE,
    },
    delegateSpy,
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const dispose = async () => {
    await client.close();
    await server.close();
  };

  return { client, delegateSpy, dispose };
}

describe('createBoardServer over a real in-memory transport (AC #3)', () => {
  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (disposers.length > 0) {
      await disposers.pop()?.();
    }
  });

  it('(a) a valid call returns a success result from the delegate', async () => {
    const { client, delegateSpy, dispose } = await connectWithTool((args) => ({
      content: [
        {
          type: 'text',
          text: `registered ${args.handle} @ ${args.current_focus}`,
        },
      ],
    }));
    disposers.push(dispose);

    const result = await client.callTool({
      name: 'representative',
      arguments: { handle: 'amelia', current_focus: 'epic-2' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'text', text: 'registered amelia @ epic-2' },
    ]);
    expect(delegateSpy).toHaveBeenCalledTimes(1);
    // The delegate received parsed, typed args.
    expect(delegateSpy).toHaveBeenCalledWith(
      { handle: 'amelia', current_focus: 'epic-2' },
      expect.anything(),
    );
  });

  it('(b) schema-invalid input is rejected BEFORE the delegate runs (delegate never called)', async () => {
    const { client, delegateSpy, dispose } = await connectWithTool(() => ({
      content: [{ type: 'text', text: 'should never run' }],
    }));
    disposers.push(dispose);

    // `handle` is required & min(1); omit it / send wrong type → schema violation.
    const result = await client.callTool({
      name: 'representative',
      arguments: { current_focus: 'epic-2' },
    });

    // The SDK validates and rejects before the handler body; the delegate is the
    // load-bearing proof — it must NEVER have been invoked.
    expect(delegateSpy).not.toHaveBeenCalled();
    // The rejection surfaces as an isError result whose text marks a validation
    // failure (and carries NO board `code` — it is not a domain error).
    expect(result.isError).toBe(true);
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    expect(textBlock?.text ?? '').toMatch(/validation|invalid/i);
    // It is distinguishable from a domain error: no closed board code present.
    expect(readErrorPayload(result as never)).toBeUndefined();
  });

  it('(b2) a wrong-typed field is also rejected before the delegate runs', async () => {
    const { client, delegateSpy, dispose } = await connectWithTool(() => ({
      content: [{ type: 'text', text: 'should never run' }],
    }));
    disposers.push(dispose);

    const result = await client.callTool({
      name: 'representative',
      // handle must be a string; send a number.
      arguments: { handle: 123, current_focus: 'epic-2' },
    });

    expect(delegateSpy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('(c) a delegate that throws a BoardError yields isError with the exact { code, message }', async () => {
    const { client, delegateSpy, dispose } = await connectWithTool(() => {
      throw new BoardError(
        'HANDLE_TAKEN',
        'handle "amelia" is already registered',
      );
    });
    disposers.push(dispose);

    const result = await client.callTool({
      name: 'representative',
      arguments: { handle: 'amelia', current_focus: 'epic-2' },
    });

    // The delegate DID run (input was valid) and threw a domain error.
    expect(delegateSpy).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);

    const payload = readErrorPayload(result as never);
    expect(payload).toEqual({
      code: 'HANDLE_TAKEN',
      message: 'handle "amelia" is already registered',
    });
    // The code is a member of the closed, core-owned set.
    expect(BOARD_ERROR_CODES).toContain(payload?.code);
  });

  it('(c2) the BoardError code round-trips through the structured content too', async () => {
    const { client, dispose } = await connectWithTool(() => {
      throw new BoardError('LOGIN_UNKNOWN', 'no such handle');
    });
    disposers.push(dispose);

    const result = await client.callTool({
      name: 'representative',
      arguments: { handle: 'ghost', current_focus: 'x' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: 'LOGIN_UNKNOWN',
      message: 'no such handle',
    });
  });
});
