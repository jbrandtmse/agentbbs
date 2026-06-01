// Story 6.2 — the NO-PUSH structural contract (AC #2; NFR5 pull-only).
//
// NFR5: the agent-facing contract is strictly request → response. The board NEVER pushes,
// notifies, or interrupts an agent — there is no notification/SSE/async-push surface on any MCP
// tool or on the server. Story 6.2 design decision 2 makes this an ASSERTED structural property,
// not merely documented prose. This file is that assertion.
//
// METHOD (documented, as the story permits a "grep-style structural assertion"):
//   1. STRUCTURAL — statically scan every PRODUCTION source file in this package (all *.ts under
//      src, EXCLUDING *.test.ts) for any push/notification CALL form. The MCP SDK's push surfaces
//      are method CALLS an author would have to invoke to push to a client:
//        - `server.sendNotification(...)` / `.notification(` — the JSON-RPC notification channel;
//        - `sendLoggingMessage(...)` — logging notifications;
//        - `createMessage(...)` / `elicitInput(...)` — sampling / elicitation (server→client calls);
//        - SSE transports / `EventSource` — the V2 HTTP+SSE push backend (deferred, must be absent);
//        - a bare server-side `.send(` of a message.
//      The board is stdio JSON-RPC request→response, so NONE of these appears in a tool/server
//      path. We grep for the CALL forms (e.g. `sendNotification(`), which cannot false-positive on
//      a comment word like "notification" or on `Array.push`.
//   2. TYPE-ONLY CARVE-OUT — the SDK type `ServerNotification` legitimately appears ONCE, as a
//      TYPE PARAMETER of the per-call `RequestHandlerExtra` context in `register-tool.ts`
//      (`RequestHandlerExtra<ServerRequest, ServerNotification>`). That is request-handling
//      infrastructure (the type of the `extra` arg threaded to a handler), NOT a push being
//      emitted. We assert `ServerNotification` appears ONLY in that type position (only in
//      `register-tool.ts`, only on a line that also mentions `RequestHandlerExtra` or is a type
//      import) — so the carve-out is pinned and a future real `sendNotification` call cannot hide
//      behind it.
//   3. BEHAVIOURAL — `check` (the marquee pull-only dial-in) over a real Client↔server pair returns
//      a `CallToolResult` (request→response). No notification is delivered to the client: we
//      install a fallback notification handler on the client and assert it never fires across a
//      full register→check exchange. (The client SDK routes any server notification through this
//      handler; zero invocations ⇒ the server pushed nothing.)
//
// If this test ever fails because a push CALL was added to a tool/server path, that is a genuine
// NFR5 violation (the V2 push backend belongs behind the data-access seam, not bolted onto the V1
// agent surface) — NOT a test to relax.

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { describe, expect, it } from 'vitest';

import { createBoardServer } from './server.js';
import { createSessionIdentity } from './session.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Recursively collect every PRODUCTION source file (*.ts, excluding *.test.ts) under `dir`. */
function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...productionSources(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// The push/notification CALL forms the MCP SDK exposes for a server to reach a client. Matching the
// CALL syntax (the symbol immediately followed by `(`, or a transport class name) avoids
// false-positives on comment words ("notification", "PUSHES nothing") and on `Array.push`.
const PUSH_CALL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'sendNotification(', re: /\bsendNotification\s*\(/ },
  { name: '.notification(', re: /\.notification\s*\(/ },
  { name: 'sendLoggingMessage(', re: /\bsendLoggingMessage\s*\(/ },
  { name: 'createMessage(', re: /\bcreateMessage\s*\(/ },
  { name: 'elicitInput(', re: /\belicitInput\s*\(/ },
  { name: 'SSEServerTransport', re: /\bSSEServerTransport\b/ },
  { name: 'EventSource', re: /\bEventSource\b/ },
];

describe('NO-PUSH structural contract: no tool or server path emits a push (NFR5, AC #2)', () => {
  const files = productionSources(srcDir);

  it('scans a non-trivial set of production sources (guards against an empty/❌ scan silently passing)', () => {
    // Sanity: the scan must actually cover the server + tools (e.g. server.ts, tools/check.ts),
    // so a "no matches" pass is meaningful rather than an empty glob.
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith('server.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith(join('tools', 'check.ts')))).toBe(true);
  });

  it('contains NO push/notification CALL form in any production source', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const { name, re } of PUSH_CALL_PATTERNS) {
        if (re.test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    // Any hit is a genuine NFR5 violation — the board must never push to an agent.
    expect(offenders).toEqual([]);
  });

  it('the SDK type `ServerNotification` appears ONLY as the RequestHandlerExtra type parameter (request-handling context, not a push)', () => {
    const mentions: { file: string; line: string }[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (/\bServerNotification\b/.test(line)) {
          mentions.push({ file, line: line.trim() });
        }
      }
    }
    // It is referenced (the carve-out is real, not vacuous)…
    expect(mentions.length).toBeGreaterThan(0);
    // …and EVERY reference is a TYPE position: the file is register-tool.ts and the line is either
    // the type import of it or the `RequestHandlerExtra<ServerRequest, ServerNotification>` alias.
    // No reference is a CALL (a `sendNotification(`-style push), so the type cannot mask a push.
    for (const { file, line } of mentions) {
      expect(file.endsWith('register-tool.ts')).toBe(true);
      const isTypePosition =
        line.includes('RequestHandlerExtra') ||
        line.includes('ServerRequest') || // the paired type-import line
        line.startsWith('ServerNotification') || // a multi-line type import member
        line.includes('import type');
      expect(isTypePosition).toBe(true);
    }
  });
});

describe('NO-PUSH behavioural contract: check is request→response, the server delivers no notification (AC #2)', () => {
  it('check returns a CallToolResult and the client receives ZERO server notifications across register→check', async () => {
    // Real ledger (better-sqlite3 behind the NFR2 seam) under os.tmpdir — nothing mocked.
    const dir = mkdtempSync(join(tmpdir(), 'agentbbs-no-push-'));
    const dataAccess = createDataAccess({
      dbPath: join(dir, '.agentbbs', 'agentbbs.db'),
    });
    const session = createSessionIdentity();
    const server = createBoardServer({ dataAccess, sessionIdentity: session });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    // Install a fallback notification handler: the client SDK routes ANY server-originated
    // notification through it (verified against @modelcontextprotocol/sdk@1.29.0 protocol.d.ts:
    // `fallbackNotificationHandler?: (notification: Notification) => Promise<void>`). If the server
    // pushed anything, this counter would advance.
    let notificationCount = 0;
    client.fallbackNotificationHandler = (): Promise<void> => {
      notificationCount += 1;
      return Promise.resolve();
    };

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    try {
      // Establish an identity, then dial in.
      const reg = (await client.callTool({
        name: 'register',
        arguments: { handle: 'ada', current_focus: 'dialing in' },
      })) as CallToolResult;
      expect(reg.isError).toBeFalsy();

      const result = (await client.callTool({
        name: 'check',
        arguments: {},
      })) as CallToolResult;

      // check is a pure request→response: a CallToolResult, no error, no streamed push.
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expect(
        (result.structuredContent as { cursor: number }).cursor,
      ).toBeTypeOf('number');

      // The load-bearing assertion: across the whole register→check exchange the server delivered
      // NO notification to the client. The board never pushed.
      expect(notificationCount).toBe(0);
    } finally {
      await client.close();
      await server.close();
      try {
        dataAccess.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
