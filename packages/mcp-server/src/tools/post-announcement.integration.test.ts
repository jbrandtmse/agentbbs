// Integration AC #6 (Story 4.1, Task 6) — REAL-RUNTIME evidence (skill-rules Rule 3).
// A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING in the stack is
// mocked: the wire, the server, the `post_announcement` tool, core's `postAnnouncement`
// (membership gate + room-id allocation + disambiguator), the rooms projection, and the
// ledger are all real.
//
// Asserts AC #6 end-to-end for `post_announcement`:
//   - a member (the announcer is auto-joined by announce_project) posts → the ledger
//     DURABLY holds one announcement.posted carrying { projectId, roomId, subject, body }
//     (read back through the REAL mapper, which only yields camelCase if the snake_case
//     project_id/room_id columns were written + read on disk), and the returned proto-room
//     round-trips (roomId = subject slug, projectId = the board, subject/body byte-identical);
//   - a SECOND identity that registered but did NOT join the board is rejected NOT_A_MEMBER,
//     nothing appended;
//   - a post to an unknown project_id is rejected BOARD_NOT_FOUND, nothing appended;
//   - two same-subject posts on the same board produce two DISTINCT roomIds (…, …-2),
//     no lost write, no error.
// plus the NO_IDENTITY (no session) path and the discovery-surface params, over the same
// real transport.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir(). The
// at-rest snake_case keys are asserted transitively via eventsByType's mapped payload —
// the better-sqlite3 import boundary (lint) forbids opening a raw connection from this
// package, and a correct camelCase read-back over the REAL ledger proves the on-disk
// snake_case mapping round-tripped.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE / set the session the
 * tools act as (the construction seam — no public "who am I" tool). Returns the connected
 * client and the very holder the server's tools read.
 */
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

/** Register an identity AND announce a sub-board (making the announcer its first member). */
async function registerAndAnnounce(
  client: Client,
  handle: string,
  projectId: string,
): Promise<void> {
  await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'shipping 4.1' },
  });
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-post-ann-int-'));
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

describe('post_announcement over a real MCP client + real ledger (AC #6)', () => {
  it('a member posts → one durable announcement.posted with { projectId, roomId, subject, body } and the returned proto-room round-trips', async () => {
    const { client } = await connect();
    // "calling-interface" slugs to itself, so announce_project gives the board this id.
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const result = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: 'Need a reviewer',
        body: 'looking for a second pair of eyes on the calling interface',
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { room: Record<string, unknown> };
    const room = sc.room;
    expect(room.room_id).toBe('need-a-reviewer');
    expect(room.project_id).toBe('calling-interface');
    expect(room.subject).toBe('Need a reviewer');
    expect(room.body).toBe(
      'looking for a second pair of eyes on the calling interface',
    );
    expect(room.posted_by).toBe('ada');
    expect(room.active).toBe(false);
    expect(typeof room.seq).toBe('number');

    // The JSON text block mirrors structuredContent (the { room } envelope).
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    expect(JSON.parse(textBlock?.text ?? '{}')).toMatchObject({
      room: { room_id: 'need-a-reviewer', project_id: 'calling-interface' },
    });

    // Out-of-band via the REAL ledger: exactly one announcement.posted, durably carrying
    // the board scope + room id + verbatim subject/body (mapped back from the on-disk
    // snake_case project_id/room_id — proving the at-rest wire shape round-tripped).
    const posted = await dataAccess!.eventsByType('announcement.posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.actor).toBe('ada');
    expect(posted[0]?.payload).toEqual({
      projectId: 'calling-interface',
      roomId: 'need-a-reviewer',
      subject: 'Need a reviewer',
      body: 'looking for a second pair of eyes on the calling interface',
    });
    // The returned seq matches the durable event's seq.
    expect(room.seq).toBe(posted[0]!.seq);
  });

  it('a registered identity that did NOT join the board is rejected NOT_A_MEMBER, nothing appended', async () => {
    // ada announces the board (and is auto-joined) on one connection.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
    }

    // bob registers on a fresh connection (same real ledger) but never joins the board.
    const { client } = await connect();
    await client.callTool({
      name: 'register',
      arguments: { handle: 'bob', current_focus: 'browsing' },
    });
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: 'Sneaky',
        body: 'should be rejected — not a member',
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NOT_A_MEMBER' });
    // Nothing appended on the gate rejection.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });

  it('a post to an unknown project_id is rejected BOARD_NOT_FOUND, nothing appended', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'no-such-board',
        subject: 'Orphan',
        body: 'no board to post to',
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'BOARD_NOT_FOUND' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });

  it('two same-subject posts on the same board produce two DISTINCT roomIds (…, …-2), no lost write', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const first = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: 'Calling Interface',
        body: 'first announcement',
      },
    })) as CallToolResult;
    const second = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: 'Calling Interface',
        body: 'second announcement (same subject)',
      },
    })) as CallToolResult;

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
    const firstId = (first.structuredContent as { room: { room_id: string } })
      .room.room_id;
    const secondId = (second.structuredContent as { room: { room_id: string } })
      .room.room_id;
    expect(firstId).toBe('calling-interface');
    expect(secondId).toBe('calling-interface-2');
    expect(firstId).not.toBe(secondId);

    // Both durable — no lost write; two distinct proto-rooms on the real ledger.
    const posted = await dataAccess!.eventsByType('announcement.posted');
    expect(posted).toHaveLength(2);
    expect(posted.map((e) => (e.payload as { roomId: string }).roomId)).toEqual(
      ['calling-interface', 'calling-interface-2'],
    );
  });

  it('post_announcement with NO established identity returns NO_IDENTITY and appends nothing', async () => {
    // A board must exist so the failure is the session gate, not BOARD_NOT_FOUND. Set it
    // up on a separate connection, then post on a fresh, identity-less connection.
    {
      const { client } = await connect();
      await registerAndAnnounce(client, 'ada', 'calling-interface');
    }
    const { client, session } = await connect();
    expect(session.handle).toBeNull(); // no register/login on this session
    const before = await dataAccess!.maxSeq();

    const result = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: 'No session',
        body: 'should be NO_IDENTITY',
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(readErrorPayload(result)).toMatchObject({ code: 'NO_IDENTITY' });
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });

  it('advertises snake_case params (project_id, subject, body) on the discovery surface', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'post_announcement');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'body',
      'project_id',
      'subject',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['project_id', 'subject', 'body']),
    );
  });
});

// ---------------------------------------------------------------------------
// QA gap-fill #1 — VERBATIM body fidelity (NFR6 body addressability). AC #1/#6 assert
// the body is stored "verbatim", but the dev's round-trips only carry plain ASCII. The
// board NEVER parses or transforms content (project-context.md: agent-authored bodies are
// untrusted, rendered inert downstream — core/data-access store them as-is). This pins
// that a pathological multi-paragraph Markdown body (code fences, unicode, emoji, CRLF,
// control-ish whitespace, the wire's own delimiters) round-trips BYTE-IDENTICAL through
// post_announcement → the REAL SQLite ledger → read back, AND that the same fidelity holds
// for the subject. A lossy mapper (trim, normalize, smart-quote, JSON re-encode drift)
// would fail this where the ASCII cases pass.
// ---------------------------------------------------------------------------
describe('post_announcement — verbatim subject/body fidelity over the real ledger (NFR6)', () => {
  // A deliberately hostile body: headings, a fenced code block with braces/quotes/
  // backslashes, unicode + emoji + combining marks, a CRLF, tabs, and JSON-significant
  // characters ({ } " \ ,) that a naive re-serialize could mangle. Kept well under the
  // interim 16k subject/body cap.
  const HOSTILE_BODY = [
    '# Need help with the **calling interface**',
    '',
    'Here is a snippet:',
    '',
    '```ts',
    'const x: Record<string, unknown> = { "k": [1, 2, 3], nested: { a: "b\\\\c" } };',
    'function f(): void { /* tabs:\there */ return; }',
    '```',
    '',
    'Unicode: café — naïve — 日本語 — emoji 🚀🛰️ — combining: é — math ∑∫≠',
    'Quotes & escapes: "double" \'single\' `back` \\backslash\\ {braces} <tag/> , comma',
    'A CRLF line ending follows this.\r',
    '   leading + trailing spaces kept   ',
  ].join('\n');

  // A subject with mixed case, internal punctuation, and unicode — its SLUG is the room
  // id, but the STORED subject must remain the exact original string.
  const HOSTILE_SUBJECT = 'Calling Interface — v2 (HTTP/2) café 🚀';

  it('stores a hostile Markdown/unicode body and subject byte-identical (board never parses content)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    const result = (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject: HOSTILE_SUBJECT,
        body: HOSTILE_BODY,
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();

    // The RETURNED room carries the subject/body unchanged (===, not just "looks like").
    const room = (result.structuredContent as { room: Record<string, unknown> })
      .room;
    expect(room.subject).toBe(HOSTILE_SUBJECT);
    expect(room.body).toBe(HOSTILE_BODY);

    // And the DURABLE event read back through the REAL mapper is byte-identical — proving
    // the SQLite at-rest text was stored + retrieved without normalization/trimming/
    // re-encoding. (A lossy round-trip would diverge from the source constants here.)
    const posted = await dataAccess!.eventsByType('announcement.posted');
    expect(posted).toHaveLength(1);
    const payload = posted[0]?.payload as { subject: string; body: string };
    expect(payload.subject).toBe(HOSTILE_SUBJECT);
    expect(payload.body).toBe(HOSTILE_BODY);
    // Exact length too (catches a single stripped char / trailing-whitespace trim / an
    // added BOM that a string-equality pass might otherwise survive on some terminals).
    expect(payload.body.length).toBe(HOSTILE_BODY.length);
    expect(payload.subject.length).toBe(HOSTILE_SUBJECT.length);

    // The JSON text block mirror is also faithful (round-tripped through JSON.parse).
    const textBlock = (
      result.content as { type: string; text?: string }[]
    ).find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock?.text ?? '{}') as {
      room: { subject: string; body: string };
    };
    expect(parsed.room.body).toBe(HOSTILE_BODY);
    expect(parsed.room.subject).toBe(HOSTILE_SUBJECT);
  });
});

// ---------------------------------------------------------------------------
// QA gap-fill #2 — subject → roomId slug derivation AT THE TOOL BOUNDARY, plus the Zod
// caps. roomIdBase is unit-tested in isolation; this pins the FULL chain (Zod schema →
// core slug → allocated roomId, on the real ledger) for the boundary-relevant subjects:
// mixed case, leading/trailing punctuation, internal punctuation runs, an unsluggable
// subject (→ `room` fallback, AC #5 over the real tool), an at-cap subject (accepted),
// and an over-cap subject (REJECTED by Zod before core, nothing appended). The unit test
// proves roomIdBase; this proves the TOOL produces / rejects exactly per the schema.
// ---------------------------------------------------------------------------
describe('post_announcement — subject→roomId slug + Zod caps at the tool boundary', () => {
  /** Post `subject` as ada on the seeded board; return the CallToolResult. */
  async function post(
    client: Client,
    subject: string,
  ): Promise<CallToolResult> {
    return (await client.callTool({
      name: 'post_announcement',
      arguments: {
        project_id: 'calling-interface',
        subject,
        body: 'body',
      },
    })) as CallToolResult;
  }

  it('derives the expected kebab roomId for mixed-case / punctuation-laden subjects', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    // [subject, expected roomId] — leading/trailing punctuation trimmed, internal
    // non-[a-z0-9] runs collapsed to a single '-', lowercased. All DISTINCT slugs, so no
    // disambiguator is involved (each is the base).
    const cases: [string, string][] = [
      ['  Mixed CASE Subject  ', 'mixed-case-subject'],
      ['!!!Leading punctuation', 'leading-punctuation'],
      ['Trailing punctuation???', 'trailing-punctuation'],
      ['Lots___of   separators!!!here', 'lots-of-separators-here'],
      ['UPPER and lower 123', 'upper-and-lower-123'],
    ];

    for (const [subject, expectedRoomId] of cases) {
      const result = await post(client, subject);
      expect(result.isError).toBeFalsy();
      const room = (
        result.structuredContent as { room: Record<string, unknown> }
      ).room;
      expect(room.room_id).toBe(expectedRoomId);
      // The STORED subject stays the original (only the id is slugged).
      expect(room.subject).toBe(subject);
    }
  });

  it('an UNSLUGGABLE subject falls back to the `room` base over the real tool (AC #5)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    // No [a-z0-9] → slug is '' → roomId base is the literal `room` (proto-room always made).
    const first = await post(client, '!!!');
    expect(first.isError).toBeFalsy();
    expect(
      (first.structuredContent as { room: { room_id: string } }).room.room_id,
    ).toBe('room');

    // A second unsluggable subject disambiguates to `room-2` on the real ledger.
    const second = await post(client, '％％％'); // fullwidth percent signs, no [a-z0-9]
    expect(second.isError).toBeFalsy();
    expect(
      (second.structuredContent as { room: { room_id: string } }).room.room_id,
    ).toBe('room-2');
  });

  it('accepts a subject at the length cap and rejects one over it (Zod, before core — nothing appended)', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');

    // ANNOUNCEMENT_SUBJECT_MAX_LENGTH = 200 (room-shared.ts). A 200-char all-`a` subject
    // is accepted; its slug is the 200-char run (a single [a-z0-9] word).
    const atCap = 'a'.repeat(200);
    const okResult = await post(client, atCap);
    expect(okResult.isError).toBeFalsy();
    expect(
      (okResult.structuredContent as { room: { room_id: string } }).room
        .room_id,
    ).toBe(atCap);

    const maxBefore = await dataAccess!.maxSeq();

    // 201 chars → over the cap → Zod rejects at the boundary BEFORE core runs.
    const overCap = 'a'.repeat(201);
    const rejected = await post(client, overCap);
    expect(rejected.isError).toBe(true);
    // A Zod validation rejection, NOT a closed board code (no domain error payload).
    expect(readErrorPayload(rejected)).toBeUndefined();
    // Rejected before core → NOTHING appended by the over-cap call.
    expect(await dataAccess!.maxSeq()).toBe(maxBefore);
  });

  it('rejects an empty subject and an empty body at the boundary (Zod .min(1)), nothing appended', async () => {
    const { client } = await connect();
    await registerAndAnnounce(client, 'ada', 'calling-interface');
    const before = await dataAccess!.maxSeq();

    const emptySubject = await post(client, '');
    expect(emptySubject.isError).toBe(true);
    expect(readErrorPayload(emptySubject)).toBeUndefined(); // Zod, not a board code

    const emptyBody = (await client.callTool({
      name: 'post_announcement',
      arguments: { project_id: 'calling-interface', subject: 'ok', body: '' },
    })) as CallToolResult;
    expect(emptyBody.isError).toBe(true);
    expect(readErrorPayload(emptyBody)).toBeUndefined();

    // Neither invalid call appended anything.
    expect(await dataAccess!.maxSeq()).toBe(before);
    expect(await dataAccess!.eventsByType('announcement.posted')).toHaveLength(
      0,
    );
  });
});
