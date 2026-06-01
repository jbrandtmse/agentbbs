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

import { MAX_BODY_BYTES } from '@agentbbs/core';

import { handleApiRequest } from './json-api.js';
import { createSseChannel } from './sse.js';
import { createStaticServer, resolveWebDist } from './static-assets.js';

import type { RequestBody } from './json-api.js';
import type { DataAccess } from '@agentbbs/core';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

/** The SSE endpoint path (the operator-browser live view channel). */
export const SSE_PATH = '/api/events';

/**
 * The host-level request-body byte ceiling for a body-carrying WRITE (Story 9.7). Set
 * generously ABOVE core's `MAX_BODY_BYTES` (the 256 KB message-body cap) plus slack for the
 * JSON envelope (`{"body":"…"}` quoting/escaping), so a body just over the message cap still
 * REACHES core and is rejected there with the contract `BODY_TOO_LARGE` → 413 (the AC-faithful
 * code). This bound only guards against an UNBOUNDED stream — a body this large is rejected
 * BEFORE buffering it all (a host-surface 413), without reading the whole malicious payload.
 */
export const MAX_REQUEST_BODY_BYTES = MAX_BODY_BYTES + 64 * 1024;

/**
 * A sentinel for a request body that exceeded {@link MAX_REQUEST_BODY_BYTES} (rejected
 * before fully buffering) or was not valid JSON. The caller maps it to a 4xx; it is NEVER
 * passed to a route handler.
 */
type BodyParse =
  | { ok: true; body: RequestBody }
  | { ok: false; status: number; code: string; message: string };

/**
 * Read + size-bound + JSON-parse a request body from the `IncomingMessage` stream (Node 24
 * idiomatic async iteration). Enforces {@link MAX_REQUEST_BODY_BYTES} on the UTF-8 BYTE
 * length — as soon as the accumulated size exceeds the bound the request is destroyed and a
 * 413 sentinel returned (we never buffer the whole oversize payload). An empty body parses
 * to `undefined` (a body-less POST); a non-empty body must be valid JSON, else a 400
 * sentinel. The parsed value must be a JSON OBJECT (the write payloads are `{ … }`); a
 * non-object JSON value is a 400. Pure transport — no board logic.
 */
async function readRequestBody(req: IncomingMessage): Promise<BodyParse> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      // The request stream yields Buffers (no encoding is set on req), but the iterator's
      // element type is loose — normalize defensively. A string chunk (if an encoding were
      // ever set) is decoded as UTF-8; a Buffer passes through.
      const buf: Buffer =
        typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : (chunk as Buffer);
      totalBytes += buf.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        // Stop buffering immediately (we never hold more than the bound). We do NOT destroy
        // the request here — that would reset the socket before the 413 response flushes
        // (the client would see ECONNRESET, not the status). The caller writes the 413 and
        // ends the response; pausing the request lets that response reach the client.
        req.pause();
        return {
          ok: false,
          status: 413,
          code: 'BODY_TOO_LARGE',
          message: `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte host limit.`,
        };
      }
      chunks.push(buf);
    }
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Failed to read the request body.',
    };
  }

  if (totalBytes === 0) {
    return { ok: true, body: undefined };
  }

  const text = Buffer.concat(chunks, totalBytes).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Request body is not valid JSON.',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Request body must be a JSON object.',
    };
  }
  return { ok: true, body: parsed as RequestBody };
}

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

    // 2. The JSON API (read-first; mirrors core read ops). A POST may carry a JSON body
    // (Story 9.7 reply/add_participant) — parse + size-bound it from the request stream and
    // pass the parsed object in. A non-POST carries no body (GET/HEAD reads, PATH-only
    // writes). An oversize/unparseable body is a 4xx raised here, BEFORE routing.
    let parsedBody: RequestBody = undefined;
    if (method === 'POST' && (path.startsWith('/api/') || path === '/api')) {
      const result = await readRequestBody(req);
      if (!result.ok) {
        // The body was oversize or unparseable. Close the connection in the response so a
        // still-uploading client does not stall on an unconsumed request body (the request
        // was paused at the bound), and the client reliably reads the 4xx status.
        const payload = JSON.stringify({
          code: result.code,
          message: result.message,
        });
        res.writeHead(result.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        });
        res.end(payload);
        return;
      }
      parsedBody = result.body;
    }
    const apiResponse = await handleApiRequest(
      method,
      path,
      dataAccess,
      operatorHandle,
      parsedBody,
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
