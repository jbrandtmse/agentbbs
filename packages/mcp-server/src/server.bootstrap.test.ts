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
    appendGuarded: unused('appendGuarded'),
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

  it('the bootstrap now serves tools/list and advertises the tools capability (Story 2.2 registered `register`)', async () => {
    // Story 2.1 shipped a bare bootstrap with NO tools (capability absent,
    // listTools → -32601). Story 2.2 registers the first board tool (`register`)
    // inside createBoardServer, so the SDK now wires the `tools/list` handler and
    // advertises the `tools` capability. This pins the post-2.2 advertised
    // surface so any future change to the bootstrap's tool set stays visible.
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const client = await connect(server);

    expect(client.getServerCapabilities()?.tools).toBeDefined();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('register');
  });

  it('once an extra tool is registered through registerCoreTool, a real Client can listTools and discover it alongside `register`', async () => {
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    // The SAME production path the identity tools use (register itself, plus
    // login/focus/seen in 2.3–2.5). Register one more representative tool on top.
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
    // The representative is discoverable next to the built-in `register` tool.
    const tool = tools.find((t) => t.name === 'representative');
    expect(tool).toBeDefined();
    expect(tool?.description).toBe(
      'A representative tool that proves the bootstrap pattern.',
    );
    expect(tools.map((t) => t.name)).toContain('register');
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
    const representative = tools.find((t) => t.name === 'representative');
    expect(representative).toBeDefined();
    const schema = representative!.inputSchema;

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

  it('the built-in `register` tool advertises snake_case params on the discovery surface', async () => {
    // The real Story-2.2 tool (not a representative) must expose `handle` +
    // `current_focus` (snake_case) — never camelCase — on the wire schema.
    const server = createBoardServer({ dataAccess: fakeDataAccess() });
    const client = await connect(server);

    const { tools } = await client.listTools();
    const registerTool = tools.find((t) => t.name === 'register');
    expect(registerTool).toBeDefined();
    const schema = registerTool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'current_focus',
      'handle',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['handle', 'current_focus']),
    );
    expect(schema.properties).not.toHaveProperty('currentFocus');
  });

  it('extra tools registered through the helper are all discoverable alongside `register`', async () => {
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
    // The two representatives plus the built-in tools the factory wires:
    // `register` (Story 2.2), `login` (Story 2.3), `update_focus` (Story 2.4),
    // `announce_project` (Story 3.1 — the first board tool), `list_projects`
    // (Story 3.2 — the first board READ tool), `join_board` (Story 3.3 — the
    // membership-write tool), `list_members` (Story 3.4 — the sub-board directory
    // READ tool), `post_announcement` (Story 4.1 — the first room tool).
    expect(tools.map((t) => t.name).sort()).toEqual([
      'alpha',
      'announce_project',
      'beta',
      'join_board',
      'list_members',
      'list_projects',
      'login',
      'post_announcement',
      'register',
      'update_focus',
    ]);
  });
});
