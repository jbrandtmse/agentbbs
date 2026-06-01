// Story 8.2 — the post-step board-review CADENCE HOOK's heartbeat, proven at runtime
// (skill-rules Rule 3 real-runtime evidence for the cadence asset `integration/bmad/cadence-hook.toml`).
//
// The dev stage of Story 8.2 shipped the cadence hook (a resolvable BMad `[workflow]` fragment that
// makes an agent review the board after every workflow step) and a CONTENT-GUARD that proves the
// hook SAYS the right words and names only real tools (`cadence-hook-doc.test.ts`), plus a lead
// smoke proving the hook RESOLVES through the real Python resolver. What neither of those proves is
// that the cadence's CENTRAL PROMISED BEHAVIOR is real — that the heartbeat the hook tells the agent
// to run actually behaves the way the hook claims. This file is that proof.
//
// The hook's `persistent_facts` step 1 promises, verbatim:
//   "`check` — pull your delta since your last dial-in (the bounded set of events scoped to your
//    boards/rooms; advances your cursor). This is the heartbeat of the review."
//   "KEEP IT LIGHT: a quiet board needs no action — if `check` shows nothing relevant, you are done
//    in one call. This review is PULL-ONLY: the board never pushes ... you choose to dial in."
//
// So a Story-8.2-faithful runtime proof of the cadence heartbeat must show, over the REAL stack:
//   (POST-CONDITION A) After a workflow step that produced board activity in a scope the agent
//     participates in, the agent's post-step `check` returns that NEW item (the delta) — the cadence
//     surfaces work that affects the agent. An IMMEDIATELY-following second `check` (the next step's
//     review, nothing new in between) returns an EMPTY delta with the cursor UNCHANGED — proving the
//     "a quiet board needs no action; you are done in one call" claim AND that the first review
//     ADVANCED the cursor (the same items are NOT re-flooded review after review).
//   (POST-CONDITION B) The review is PULL-ONLY: the delta is delivered ONLY in RESPONSE to the
//     agent's own `check` call (request->response), never pushed. We assert the bounded-delta
//     envelope shape `{ announcements, messages, cursor }` is what `check` RETURNS, and — the
//     load-bearing pull-only assertion — that across a register->step-activity->check->check exchange
//     the server delivers ZERO notifications to the client (a fallback notification handler that
//     would fire on any server push stays at 0). This is the FR35/NFR5 "wired as a post-condition,
//     no push" property expressed as the tool's own contract.
//
// This is the SAME real harness as `check.integration.test.ts` / `check.bounded.integration.test.ts`
// (a real MCP `Client` <-> a `createBoardServer`-built `McpServer` over the SDK's `InMemoryTransport`,
// backed by the REAL `createDataAccess` — better-sqlite3 behind the NFR2 seam — against a genuine
// SQLite file under os.tmpdir()). Nothing is mocked: the wire, the server, the `check` tool, core's
// `check` (scoped delta + cursor read/advance + the membership/participation/floor folds + the
// presence ping), the projections, the STORED cursors table, and the ledger are all real.
//
// The generic bounded-delta mechanics ARE already covered by the two files above; this file does NOT
// duplicate them — it adds ONE focused test that frames exactly the three properties the cadence hook
// PROMISES (delta-on-step-activity, empty-on-quiet + cursor-advanced, pull-only-no-push), named to
// tie it to Story 8.2's post-condition, so a future change that breaks the cadence's heartbeat fails
// a test that explicitly says WHY it matters to this story.
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

/**
 * Stand up a real Client<->server pair over the in-memory transport + real ledger. A
 * `notificationCount` ref is exposed so a test can prove the server pushed NOTHING across an
 * exchange (the cadence hook's PULL-ONLY promise): the client SDK routes ANY server-originated
 * notification through `fallbackNotificationHandler` (verified against @modelcontextprotocol/sdk
 * @1.29.0 protocol.d.ts), so a counter that stays at 0 means zero pushes.
 */
async function connect(): Promise<{
  client: Client;
  session: SessionIdentity;
  notifications: () => number;
}> {
  const session = createSessionIdentity();
  const server = createBoardServer({
    dataAccess: dataAccess!,
    sessionIdentity: session,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  let notificationCount = 0;
  client.fallbackNotificationHandler = (): Promise<void> => {
    notificationCount += 1;
    return Promise.resolve();
  };
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  disposers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, session, notifications: () => notificationCount };
}

/** Register an identity on a connection's session. */
async function register(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'dialing in' },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Re-establish an already-registered identity on a fresh connection's session. */
async function login(client: Client, handle: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'login',
    arguments: { handle },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Announce a sub-board as the session's current identity. */
async function announce(client: Client, projectId: string): Promise<void> {
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
}

/** Post a proto-room announcement as the session's current identity; return its room_id. */
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

/** Reply to a room as the session's current identity (activates / participates). */
async function reply(
  client: Client,
  roomId: string,
  body: string,
): Promise<void> {
  const result = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/** Join a sub-board as the session's current identity. */
async function joinBoard(client: Client, projectId: string): Promise<void> {
  const result = (await client.callTool({
    name: 'join_board',
    arguments: { project_id: projectId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
}

/**
 * Call `check` for the session's current identity and return the FULL `CallToolResult` (so a test
 * can assert it is a request->response result AND read the bounded-delta envelope off its
 * `structuredContent`). The hook names this tool in bare `` `check` `` form; verified `check` with
 * empty `{}` args + the `{ announcements, messages, cursor }` envelope against the live `check.ts`
 * registration and `docs/mcp-tool-contract.md` §3/§6 before authoring.
 */
async function checkResult(client: Client): Promise<CallToolResult> {
  const result = (await client.callTool({
    name: 'check',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result;
}

/** The bounded-delta envelope `check` returns, read off a (non-error) `CallToolResult`. */
function deltaOf(result: CallToolResult): {
  announcements: { room_id: string; seq: number }[];
  messages: { room_id: string; seq: number; actor: string }[];
  cursor: number;
} {
  return result.structuredContent as {
    announcements: { room_id: string; seq: number }[];
    messages: { room_id: string; seq: number; actor: string }[];
    cursor: number;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-cadence-post-int-'));
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

describe('Story 8.2 cadence hook: the post-step board-review heartbeat behaves as the hook promises (`check` is a pull-only bounded delta that advances the cursor)', () => {
  it("the post-step review surfaces only the NEW delta from a step's activity, the immediately-following review is empty with an UNCHANGED cursor (no re-flood), and the whole exchange is PULL-ONLY (zero server pushes)", async () => {
    // === Setup: a peer agent runs a board the cadence agent participates in. ===
    // `peer` stands up the board; the cadence `agent` joins it (board-member scope). `peer` then
    // posts the 'negotiation' proto-room AFTER the agent joined (so it is ABOVE the agent's board
    // floor — in the agent's announcement scope), and the agent replies into it, so it PARTICIPATES
    // (its `check` scope spans this board's announcements AND this room's messages — the two scopes
    // the cadence hook's review walks).
    const projectId = 'release-train';
    const { client: peerSetup } = await connect();
    await register(peerSetup, 'peer');
    await announce(peerSetup, projectId);

    const { client: agent, notifications } = await connect();
    await register(agent, 'agent');
    await joinBoard(agent, projectId); // board-member scope (its floor = this join seq)

    // 'negotiation' is posted AFTER the agent's join, so it sits ABOVE the board floor and IS in the
    // agent's announcement scope (a pre-join announcement would be floored out — that no-flood
    // property is the subject of check.integration.test.ts; here the announcement is deliberately
    // in-scope so the baseline review has a real item to return + advance the cursor on).
    const roomId = await postAnnouncement(peerSetup, projectId, 'negotiation');
    await reply(agent, roomId, 'agent joins the negotiation'); // participation scope

    // The agent's first post-step review CONSUMES the setup activity (the in-scope 'negotiation'
    // announcement; its own joining reply sits AT the room floor and is excluded by the strict `>`),
    // advancing the cursor past it. This isolates the NEXT review's delta to STRICTLY-NEW activity —
    // mirroring the cadence: each step's review only sees what happened SINCE the last one.
    const baseline = deltaOf(await checkResult(agent));
    expect(baseline.announcements.map((a) => a.room_id)).toContain(roomId); // baseline returned a real item
    const cursorAfterBaseline = baseline.cursor;
    expect(cursorAfterBaseline).toBeGreaterThan(0); // the baseline review advanced the cursor past it

    // === A workflow STEP runs and produces board activity affecting the agent. ===
    // `peer` (re-established via login on a fresh connection — register would HANDLE_TAKEN) posts a
    // NEW announcement on the board AND a NEW reply in the room the agent participates in. This is
    // the "work that affects you" the post-step review exists to catch.
    const { client: peerStep } = await connect();
    await login(peerStep, 'peer');
    const stepRoomId = await postAnnouncement(peerStep, projectId, 'scope-cut');
    await reply(peerStep, roomId, 'peer proposes cutting scope');

    // === POST-CONDITION A.1 — the post-step `check` RETURNS the new delta (no flood, scoped). ===
    const postStep = await checkResult(agent);
    const delta = deltaOf(postStep);
    // The new announcement (board-member scope) AND the new reply in the participated room
    // (participation scope) are both surfaced — exactly the two scopes the hook's review walks.
    expect(delta.announcements.map((a) => a.room_id)).toContain(stepRoomId);
    expect(
      delta.messages.some((m) => m.room_id === roomId && m.actor === 'peer'),
    ).toBe(true);
    // …and the review advanced the cursor past the baseline (so the NEXT review starts after this).
    expect(delta.cursor).toBeGreaterThan(cursorAfterBaseline);

    // === POST-CONDITION A.2 — the IMMEDIATELY-following review (a quiet board) is EMPTY, and the
    // cursor is UNCHANGED: the cadence does NOT re-flood the same items review after review, and a
    // quiet board "needs no action — you are done in one call". This is the load-bearing proof that
    // the heartbeat advanced the cursor (otherwise this second check would re-return the step delta).
    const quiet = deltaOf(await checkResult(agent));
    expect(quiet.announcements).toEqual([]);
    expect(quiet.messages).toEqual([]);
    expect(quiet.cursor).toBe(delta.cursor); // cursor UNCHANGED — the same items are NOT re-flooded

    // === POST-CONDITION B — PULL-ONLY: the delta arrived ONLY in RESPONSE to the agent's `check`
    // calls (request->response), and the board pushed NOTHING across the whole exchange. ===
    // The bounded-delta envelope is what `check` RETURNS (not something streamed/pushed): a non-error
    // CallToolResult whose structuredContent is the `{ announcements, messages, cursor }` shape.
    expect(postStep.isError).toBeFalsy();
    expect(postStep.structuredContent).toBeDefined();
    const envelope = postStep.structuredContent as Record<string, unknown>;
    expect(Array.isArray(envelope.announcements)).toBe(true); // bounded delta, not unbounded history
    expect(Array.isArray(envelope.messages)).toBe(true);
    expect(envelope.cursor).toBeTypeOf('number'); // the catch-up cursor (the agent's own position)
    // The decisive pull-only assertion: across register -> join -> reply -> baseline check -> step
    // activity -> post-step check -> quiet check, the server delivered ZERO notifications to the
    // agent. The board never pushed — every item the agent saw, it PULLED by calling `check`. This is
    // the cadence hook's FR35/NFR5 "no push, wired as a post-condition you initiate" property.
    expect(notifications()).toBe(0);
  });
});
