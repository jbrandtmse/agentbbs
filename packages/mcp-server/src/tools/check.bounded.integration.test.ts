// Story 6.2 — BOUNDED delivery, real-runtime evidence (AC #1, #4; skill-rules Rule 3).
//
// The reaffirming proof that a `check` RESPONSE is bounded by NEW activity, NOT by the size of the
// ledger. A real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2 seam)
// against a genuine SQLite file. Nothing is mocked: the wire, the server, the `check` tool, core's
// `check` (cursor read/advance + the membership / participation / floor folds), the projections,
// the STORED cursors table, and the ledger are all real.
//
// THE BOUND (Story 6.2 design decision 1, AC #1): an item surfaces only if
// `seq > max(cursor, joinFloor)` (Story 6.1's per-board / per-room floors), so a freshly-floored
// identity is NOT flooded with the pre-join back-history — the delta it receives is ~`new items`,
// independent of how many events preceded its join. This file proves it two ways:
//   1. ABSOLUTE: seed a LARGE pre-floor back-history (hundreds of announcements the joiner is
//      floored out of) + a SMALL post-floor delta (k new announcements posted after the join);
//      the joiner's first `check` returns EXACTLY k announcements (NOT back-history + k), and the
//      pre-join rooms are provably absent from the delta.
//   2. SCALE-INVARIANCE: run the SAME scenario at two very different back-history sizes (small N
//      vs large N) with the SAME post-floor k; the returned delta count is IDENTICAL (== k) at
//      both sizes — the response does not grow with the ledger. (This is the operational meaning
//      of "bounded": the agent pays for new activity, not ledger size.)
//
// Rule 5 (NFR tripwire — honest check, NOT a paper-over): NFR5 says `check` is a CHEAP cursor
// query. Story 6.1 measured the per-call scope-fold and accepted it at V1; this file additionally
// asserts that `check` over the LARGE back-history completes in a generous wall-clock budget — a
// smoke that the QUERY (not just the bounded response) stays acceptable at a realistic V1 size. It
// is a loose ceiling (a non-flaky guard against an accidental O(ledger^2) regression), not a
// micro-benchmark; if it ever trips at a realistic size, that is an NFR tripwire to surface (amend
// the planning artifact / re-open the perf item), NOT to silence. Expected: comfortably green.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/** Stand up a real Client↔server pair over the in-memory transport + real ledger. */
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

async function register(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'dialing in' },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

async function login(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'login',
    arguments: { handle },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

async function announce(client: Client, projectId: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Post a proto-room announcement; return its room_id. */
async function postAnnouncement(
  client: Client,
  projectId: string,
  subject: string,
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body: `body for ${subject}` },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

async function joinBoard(client: Client, projectId: string): Promise<void> {
  const result = (await client.callTool({
    name: 'join_board',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** Call `check` for the session's current identity; return the wire envelope. */
async function check(client: Client): Promise<{
  announcements: { room_id: string; seq: number }[];
  messages: { room_id: string; seq: number; actor: string }[];
  cursor: number;
}> {
  const result = (await client.callTool({
    name: 'check',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result.structuredContent as {
    announcements: { room_id: string; seq: number }[];
    messages: { room_id: string; seq: number; actor: string }[];
    cursor: number;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-check-bounded-int-'));
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

/**
 * Run the bounded scenario once and return the freshly-joined identity's first-check delta + the
 * elapsed `check` wall-clock (ms) + the real ledger maxSeq. Each invocation uses its OWN announcer,
 * board, and joiner handles, so several runs can layer on ONE shared ledger without collisions
 * (the scale-invariance test relies on this — the second run sits on top of the first run's events,
 * making the ledger genuinely larger while the second board's floor logic stays independent).
 *
 * Scenario: `announcer` creates `projectId` and posts `backHistory` OLD proto-rooms BEFORE the
 * joiner joins (the pre-floor back-history). The joiner then registers and joins (its board floor =
 * the join seq, ABOVE all the old announcements). The announcer then posts `delta` NEW proto-rooms
 * AFTER the join. The joiner's first `check` must return EXACTLY the `delta` new rooms — never the
 * back-history.
 */
async function runBounded(args: {
  announcer: string;
  joiner: string;
  projectId: string;
  backHistory: number;
  delta: number;
}): Promise<{
  announcements: { room_id: string; seq: number }[];
  oldRoomIds: Set<string>;
  newRoomIds: Set<string>;
  checkMs: number;
  maxSeq: number;
}> {
  const { announcer, joiner, projectId, backHistory, delta } = args;

  // The announcer creates the board and floods it with `backHistory` pre-join announcements.
  const { client: ann } = await connect();
  await register(ann, announcer);
  await announce(ann, projectId);
  const oldRoomIds = new Set<string>();
  for (let i = 0; i < backHistory; i += 1) {
    oldRoomIds.add(await postAnnouncement(ann, projectId, `old-topic-${i}`));
  }

  // The joiner registers on a fresh connection and joins — AFTER all the old announcements, so its
  // per-board floor sits above every one of them.
  const { client: joinerClient } = await connect();
  await register(joinerClient, joiner);
  await joinBoard(joinerClient, projectId);

  // The announcer (re-established via login — register would HANDLE_TAKEN) posts `delta` NEW
  // announcements AFTER the joiner joined, so they ARE in the joiner's announcement scope (above
  // its floor).
  const { client: annB } = await connect();
  await login(annB, announcer);
  const newRoomIds = new Set<string>();
  for (let i = 0; i < delta; i += 1) {
    newRoomIds.add(await postAnnouncement(annB, projectId, `new-topic-${i}`));
  }

  // The freshly-joined identity's FIRST check — time it (Rule 5 smoke).
  const t0 = performance.now();
  const result = await check(joinerClient);
  const checkMs = performance.now() - t0;

  return {
    announcements: result.announcements,
    oldRoomIds,
    newRoomIds,
    checkMs,
    maxSeq: await dataAccess!.maxSeq(),
  };
}

describe('check response is BOUNDED by new activity, not ledger size (AC #1, #4)', () => {
  it('a freshly-floored identity over a LARGE back-history receives ONLY the small post-floor delta (count == delta, NOT back-history + delta)', async () => {
    const BACK_HISTORY = 400; // hundreds of pre-join announcements the joiner is floored out of
    const DELTA = 3; // a small post-floor delta

    const { announcements, oldRoomIds, newRoomIds, checkMs, maxSeq } =
      await runBounded({
        announcer: 'a2',
        joiner: 'ada',
        projectId: 'release-train',
        backHistory: BACK_HISTORY,
        delta: DELTA,
      });

    // The delta is EXACTLY the post-floor new rooms — NOT the back-history.
    expect(announcements).toHaveLength(DELTA);
    const returnedIds = new Set(announcements.map((a) => a.room_id));
    expect(returnedIds).toEqual(newRoomIds);

    // Provably bounded: NONE of the hundreds of pre-join rooms leaked into the response, even
    // though they all sit in the (now large) ledger.
    for (const id of returnedIds) expect(oldRoomIds.has(id)).toBe(false);

    // The ledger is genuinely LARGE (>= the back-history we seeded) — so "only DELTA returned" is
    // a real bound, not an artifact of a small ledger.
    expect(maxSeq).toBeGreaterThanOrEqual(BACK_HISTORY);
    // …yet the response carried only a handful of items: response size ≪ ledger size.
    expect(announcements.length).toBeLessThan(maxSeq / 10);

    // Rule 5 smoke (NOT a micro-benchmark): the QUERY over the large back-history stayed cheap.
    // A loose ceiling that only trips on an accidental pathological (e.g. O(ledger^2)) regression.
    expect(checkMs).toBeLessThan(2000);
  });

  it('SCALE-INVARIANCE: the same post-floor delta returns the SAME count at a small AND a large back-history (the response does not grow with the ledger)', async () => {
    const DELTA = 2;

    // Run the scenario twice on ONE shared ledger, each with its OWN announcer/board/joiner. The
    // FIRST run uses a small back-history; the SECOND run layers a large back-history ON TOP of the
    // first run's events, so by the time the second joiner checks, the total ledger is far larger —
    // yet its delta must STILL be exactly DELTA, because its per-board floor excludes everything
    // before its own join (the first run's events AND the second board's pre-join back-history).
    const small = await runBounded({
      announcer: 'a2',
      joiner: 'ada',
      projectId: 'board-small',
      backHistory: 10,
      delta: DELTA,
    });
    expect(small.announcements).toHaveLength(DELTA);
    expect(new Set(small.announcements.map((a) => a.room_id))).toEqual(
      small.newRoomIds,
    );

    const large = await runBounded({
      announcer: 'a3',
      joiner: 'bea',
      projectId: 'board-large',
      backHistory: 400,
      delta: DELTA,
    });
    expect(large.announcements).toHaveLength(DELTA);
    expect(new Set(large.announcements.map((a) => a.room_id))).toEqual(
      large.newRoomIds,
    );

    // The two deltas are the SAME size despite the second run sitting on a far larger ledger.
    expect(large.announcements.length).toBe(small.announcements.length);
    expect(large.maxSeq).toBeGreaterThan(small.maxSeq);
    // None of the second run's pre-join back-history leaked into its delta.
    const largeIds = new Set(large.announcements.map((a) => a.room_id));
    for (const id of largeIds) expect(large.oldRoomIds.has(id)).toBe(false);
  });
});
