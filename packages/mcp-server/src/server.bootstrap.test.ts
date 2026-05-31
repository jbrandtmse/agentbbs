// Integration tests for the bare bootstrap + the tool-discovery surface
// (Story 2.1, AC #1 / AC #3) — QA hardening.
//
// The dev's `server.test.ts` proves the call path (callTool → validate →
// delegate → map). This file covers the surface the brief also names but that
// file does not exercise: the DISCOVERY path (`tools/list`) over a real
// `Client`↔`McpServer` pair, plus the literal Story-2.1 deliverable state —
// `createBoardServer` with NO board tools registered (identity tools land in
// Stories 2.2–2.5). Same real in-memory transport (Rule 3 evidence), never a
// mock of the SDK.
//
// Why this is non-redundant with server.test.ts:
//   - It asserts a real `Client` can `connect` to a `createBoardServer`-built
//     server and `listTools` against it (the brief's "listTools/callTool").
//   - It proves the `snake_case` MCP param-name convention is observable on the
//     DISCOVERY surface (the JSON-Schema `properties`/`required`), not only as
//     parsed call arguments.
//   - It pins the real SDK behavior of the BARE bootstrap (zero tools): the
//     server connects, but `tools/list` is unavailable until the first tool is
//     registered. Documenting this with a test means a regression (or a later
//     decision to always advertise the tools capability) is caught, not silent.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DataAccess } from '@agentbbs/core';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import { createBoardServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { registerCoreTool } from './register-tool.js';

// A fake DataAccess whose methods throw if touched — the bootstrap surface does
// not read persistence, so any call would signal an unintended coupling.
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

// The representative tool shape: snake_case param names at the MCP wire boundary
// (project convention). Mirrors the identity-tool shape later stories register.
const REPRESENTATIVE_SHAPE = {
  handle: z.string().min(1),
  current_focus: z.string(),
} as const;

describe('createBoardServer bootstrap over a real in-memory transport', () => {
  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (disposers.length > 0) {
      await disposers.pop()?.();
    }
  });

  /** Connect a real Client to a freshly-built server; auto-disposed. */
  async function connect(server: ReturnType<typeof createBoardServer>) {
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

  it('a real Client can connect to the bare bootstrap and read the server identity', async () => {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const client = await connect(server);

    // The handshake completed: the client sees the server's advertised identity,
    // which mirrors the package name/version constants.
    expect(client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
  });

  it('the bare bootstrap registers NO tools, so tools/list is not yet served (literal Story 2.1 state)', async () => {
    // Story 2.1 is bootstrap-only: createBoardServer adds no board tools (the
    // identity tools arrive in 2.2–2.5). The SDK's McpServer only wires the
    // `tools/list` handler + advertises the `tools` capability once the first
    // tool is registered — so on the bare server the capability is absent and a
    // `listTools` call is rejected as an unknown method (-32601). Pinning this
    // makes any future change to the bootstrap's advertised surface visible.
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const client = await connect(server);

    expect(client.getServerCapabilities()?.tools).toBeUndefined();
    await expect(client.listTools()).rejects.toMatchObject({ code: -32601 });
  });

  it('once a tool is registered through registerCoreTool, a real Client can listTools and discover it', async () => {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    // The SAME production path the identity tools (2.2–2.5) will use.
    registerCoreTool(
      server,
      'representative',
      {
        description: 'A representative tool that proves the bootstrap pattern.',
        inputSchema: REPRESENTATIVE_SHAPE,
      },
      (args) => ({ content: [{ type: 'text', text: args.handle }] }),
    );
    const client = await connect(server);

    // Registering a tool advertises the tools capability to the client.
    expect(client.getServerCapabilities()?.tools).toBeDefined();

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('representative');
    expect(tool.description).toBe(
      'A representative tool that proves the bootstrap pattern.',
    );
  });

  it('the listed input schema exposes the snake_case param names on the wire (discovery surface)', async () => {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    registerCoreTool(
      server,
      'representative',
      {
        description: 'A representative tool that proves the bootstrap pattern.',
        inputSchema: REPRESENTATIVE_SHAPE,
      },
      (args) => ({ content: [{ type: 'text', text: args.handle }] }),
    );
    const client = await connect(server);

    const { tools } = await client.listTools();
    const schema = tools[0].inputSchema;

    // JSON-Schema object with the snake_case property names the project mandates
    // at the MCP boundary (NOT camelCase) — observable on the discovery surface,
    // not just as parsed call args.
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'current_focus',
      'handle',
    ]);
    // Both fields are required, and the `.min(1)` constraint round-trips.
    expect(schema.required).toEqual(
      expect.arrayContaining(['handle', 'current_focus']),
    );
    expect(
      (schema.properties as Record<string, { minLength?: number }>).handle,
    ).toMatchObject({ type: 'string', minLength: 1 });
    // No camelCase leakage of the multi-word param onto the wire.
    expect(schema.properties).not.toHaveProperty('currentFocus');
  });

  it('two tools registered through the helper are both discoverable', async () => {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    registerCoreTool(
      server,
      'alpha',
      { description: 'first', inputSchema: { value: z.string() } },
      (args) => ({ content: [{ type: 'text', text: args.value }] }),
    );
    registerCoreTool(
      server,
      'beta',
      { description: 'second', inputSchema: { n: z.number() } },
      (args) => ({ content: [{ type: 'text', text: String(args.n) }] }),
    );
    const client = await connect(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
  });
});
