// Unit tests for the reusable tool-registration helper (Story 2.1, Task 3).
//
// These exercise the helper's wiring at the unit level (delegate invocation,
// error routing, success pass-through) by registering against a real McpServer and
// reaching into the registered handler. The END-TO-END proof over a real
// client<->server transport (incl. the SDK rejecting invalid input before the
// delegate) is the AC #3 integration test in server.test.ts.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BoardError } from '@agentbbs/core';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { INTERNAL_ERROR, readErrorPayload } from './error-map.js';
import { registerCoreTool } from './register-tool.js';

function newServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

describe('registerCoreTool', () => {
  it('registers a tool and returns the RegisteredTool handle', () => {
    const server = newServer();
    const registered = registerCoreTool(
      server,
      'echo',
      { description: 'echoes', inputSchema: { value: z.string() } },
      (args) => ({ content: [{ type: 'text', text: args.value }] }),
    );
    expect(registered).toBeDefined();
    expect(typeof registered.remove).toBe('function');
  });

  it('passes typed, parsed args to the delegate and returns its success result', async () => {
    const server = newServer();
    const delegate = vi.fn((args: { value: string }) => ({
      content: [{ type: 'text' as const, text: `got:${args.value}` }],
    }));
    registerCoreTool(
      server,
      'echo',
      { description: 'echoes', inputSchema: { value: z.string() } },
      delegate,
    );

    // Drive the registered handler exactly as the SDK would post-validation.
    const result = await callRegistered(server, 'echo', { value: 'hi' });

    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate).toHaveBeenCalledWith({ value: 'hi' }, expect.anything());
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toEqual({ type: 'text', text: 'got:hi' });
  });

  it('routes a thrown BoardError through error-map (isError + exact { code, message })', async () => {
    const server = newServer();
    registerCoreTool(
      server,
      'boom',
      { description: 'always fails', inputSchema: { value: z.string() } },
      () => {
        throw new BoardError('HANDLE_TAKEN', 'taken');
      },
    );

    const result = await callRegistered(server, 'boom', { value: 'x' });

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toEqual({
      code: 'HANDLE_TAKEN',
      message: 'taken',
    });
  });

  it('routes an unexpected throw through error-map as a generic INTERNAL_ERROR', async () => {
    const server = newServer();
    registerCoreTool(
      server,
      'crash',
      { description: 'unexpected', inputSchema: { value: z.string() } },
      () => {
        throw new Error('kaboom internal detail');
      },
    );

    const result = await callRegistered(server, 'crash', { value: 'x' });

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)?.code).toBe(INTERNAL_ERROR);
    expect(JSON.stringify(result)).not.toContain('kaboom');
  });

  it('awaits an async delegate that rejects with a BoardError', async () => {
    const server = newServer();
    registerCoreTool(
      server,
      'async-boom',
      { description: 'async fail', inputSchema: { value: z.string() } },
      async () => {
        await Promise.resolve();
        throw new BoardError('LOGIN_UNKNOWN', 'nope');
      },
    );

    const result = await callRegistered(server, 'async-boom', { value: 'x' });

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toEqual({
      code: 'LOGIN_UNKNOWN',
      message: 'nope',
    });
  });
});

// --- helpers -------------------------------------------------------------

/**
 * Invoke a tool's registered handler the way the SDK does AFTER input validation,
 * by reading the private tool registry. This is a UNIT-level shortcut; the public
 * client-over-transport path is covered in the integration test.
 */
async function callRegistered(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const registry = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (a: unknown, extra: unknown) => unknown }
      >;
    }
  )._registeredTools;
  const tool = registry[name];
  if (!tool) {
    throw new Error(`tool ${name} not registered`);
  }
  const extra = { signal: new AbortController().signal };
  return (await tool.handler(args, extra)) as CallToolResult;
}
