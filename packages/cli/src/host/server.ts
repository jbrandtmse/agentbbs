// The on-demand web host HTTP server (Story 9.3, Task 2 / AC #1, #2).
//
// Composes the JSON API (read-first, mirrors core read ops), the SSE channel (host →
// operator-browser live view via MAX(seq) polling), and static serving of the built
// apps/web client into ONE `node:http` server. Uses the Node built-in `http` module —
// NO HTTP-framework dependency (the dep surface stays minimal; the routing is a small
// table, the SSE is a held-open response, static serving is a contained file read).
//
// THIN CLIENT (NFR2): the host imports @agentbbs/core + @agentbbs/data-access only and
// carries no board logic — every request validates → delegates to a core read op →
// maps to the snake_case wire → returns. The same posture as the stdio mcp-server, over
// HTTP instead of MCP.
//
// ON-DEMAND (NFR4): nothing here auto-starts. `createHost` builds a server object;
// `startHost` binds it to a port. The host runs ONLY when the operator invokes
// `agentbbs ui` (which calls `startHost`); killing that process tears it down. Agents
// never touch this — their MCP stdio processes are independent over the same SQLite file.

import { createServer } from 'node:http';

import { handleApiRequest } from './json-api.js';
import { createSseChannel } from './sse.js';
import { createStaticServer, resolveWebDist } from './static-assets.js';

import type { DataAccess } from '@agentbbs/core';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

/** The SSE endpoint path (the operator-browser live view channel). */
export const SSE_PATH = '/api/events';

/** Options for {@link createHost}. */
export interface CreateHostOptions {
  /** The persistence port the host reads through (core read ops + SSE poller). */
  dataAccess: DataAccess;
  /** Override the resolved apps/web `dist/` root (else runtime path resolution). */
  webDist?: string;
  /** Override the SSE poll interval (ms). */
  ssePollIntervalMs?: number;
  /**
   * The resolved operator handle (Story 9.4) — the host's read-only answer to "who am I"
   * for `/api/me` + the NEEDS YOU queue. `null`/`undefined` → watching-only posture (no
   * personalization; global read still works). Resolved by the CLI from `ui --as <handle>`
   * / the `AGENTBBS_OPERATOR` env (see `../ui.ts`). The host treats it as opaque — it does
   * NOT register or validate it (identity bootstrap is the BMad kit's job; the operator
   * reuses an existing claimed handle).
   */
  operatorHandle?: string | null;
}

/** A built (not-yet-listening) host. {@link startHost} binds it to a port. */
export interface Host {
  /** The underlying `node:http` server (for `listen`/`close`/tests). */
  server: Server;
  /** Connected operator-browser count (diagnostics/tests). */
  sseConnectionCount(): number;
  /** Stop the SSE poller + end SSE connections, then close the server. */
  close(): Promise<void>;
}

/** A listening host plus the bound address. */
export interface RunningHost extends Host {
  /** The bound port (resolved when an ephemeral `0` port was requested). */
  port: number;
  /** The local URL the operator opens (`http://127.0.0.1:<port>`). */
  url: string;
}

/** Write a JSON response body with the standard headers. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Build the on-demand web host (NOT yet listening — NFR4 on-demand). Wires the request
 * pipeline: SSE endpoint → JSON API → static client assets (SPA fallback).
 *
 * @param options The data-access port + optional web-dist / poll overrides.
 * @returns A {@link Host}; call {@link startHost} (or `host.server.listen`) to bind it.
 */
export function createHost(options: CreateHostOptions): Host {
  const { dataAccess } = options;
  const operatorHandle = options.operatorHandle ?? null;
  const distRoot = options.webDist ?? resolveWebDist();
  const sse = createSseChannel({
    dataAccess,
    pollIntervalMs: options.ssePollIntervalMs,
  });
  const staticServer = createStaticServer(distRoot);

  const server = createServer(
    (req: IncomingMessage, res: ServerResponse): void => {
      void handleRequest(req, res);
    },
  );

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    // Strip the query string; we route on the pathname only.
    const rawUrl = req.url ?? '/';
    const path = rawUrl.split('?')[0];

    // 1. The SSE channel (operator-browser live view) — held open.
    if (path === SSE_PATH) {
      if (method !== 'GET') {
        writeJson(res, 405, {
          code: 'NOT_FOUND',
          message: 'SSE endpoint is GET-only.',
        });
        return;
      }
      sse.addConnection(res);
      return;
    }

    // 2. The JSON API (read-first; mirrors core read ops). Returns null if not /api/.
    const apiResponse = await handleApiRequest(
      method,
      path,
      dataAccess,
      operatorHandle,
    );
    if (apiResponse !== null) {
      writeJson(res, apiResponse.status, apiResponse.body);
      return;
    }

    // 3. Static client assets (built apps/web) + SPA fallback. GET/HEAD only.
    if (method !== 'GET' && method !== 'HEAD') {
      writeJson(res, 405, {
        code: 'NOT_FOUND',
        message: `Method ${method} not supported.`,
      });
      return;
    }
    const asset = staticServer.serve(path);
    if (asset.body === undefined) {
      res.writeHead(asset.status, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end();
      return;
    }
    res.writeHead(asset.status, {
      'Content-Type': asset.contentType ?? 'application/octet-stream',
      'Content-Length': asset.body.length,
    });
    res.end(method === 'HEAD' ? undefined : asset.body);
  }

  return {
    server,
    sseConnectionCount: () => sse.connectionCount(),
    close(): Promise<void> {
      sse.close();
      return new Promise<void>((resolvePromise, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolvePromise();
        });
      });
    },
  };
}

/**
 * Start the host listening on `port` (default ephemeral `0`) bound to loopback. Resolves
 * once the server is listening, with the resolved port + the local URL to open.
 *
 * @param options The {@link CreateHostOptions} plus the optional `port`/`host` binding.
 * @returns A {@link RunningHost}: the bound port, URL, and lifecycle handle.
 */
export function startHost(
  options: CreateHostOptions & { port?: number; host?: string },
): Promise<RunningHost> {
  const host = createHost(options);
  const bindHost = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;
  return new Promise<RunningHost>((resolvePromise, reject) => {
    host.server.once('error', reject);
    host.server.listen(requestedPort, bindHost, () => {
      host.server.removeListener('error', reject);
      const address = host.server.address();
      const port =
        address !== null && typeof address === 'object'
          ? address.port
          : requestedPort;
      resolvePromise({
        ...host,
        port,
        url: `http://${bindHost}:${port}`,
      });
    });
  });
}
