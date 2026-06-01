// Story 8.3 (QA) — REAL-RUNTIME EXECUTION proof for the skill-rules registry's
// Negotiation Protocol convention (skill-rules Rule 3 evidence).
//
// Story 8.3 ships `integration/bmad/skill-rules.md`, whose **Rule B** prescribes a four-move
// convention an AgentBBS-using agent EXECUTES at a shared boundary:
//
//   | Move     | Tool           |
//   | Propose  | reply          |  ← post your proposed contract as a reply in the room
//   | Counter  | reply          |  ← post an alternative as another reply (the seq-ordered history)
//   | Ratify   | react (unreact)|  ← place a live 👍 on the message you accept
//   | Frozen   | read_contract  |  ← the highest-seq message holding a live 👍 (FR21), reverts on unreact
//
// The dev's content-guard (`packages/mcp-server/src/skill-rules-registry-doc.test.ts`) proves the
// registry SAYS these words and names only REAL tools — but it does NOT prove the described
// protocol is genuinely EXECUTABLE end-to-end with the shipped tools. THIS test closes that gap:
// it drives the FULL four-move convention over the REAL surface and asserts each move works as the
// registry prescribes, so the registry's Rule B is a real executable convention, not just prose.
//
// Mirrors the sibling `read-contract.integration.test.ts` / `react.integration.test.ts` harness: a
// real MCP `Client` talks to a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the NFR2 seam)
// against a genuine SQLite file in an OS temp dir. NOTHING is mocked — the wire, the server, the
// `reply`/`react`/`unreact`/`read_contract`/`read_room` tools, core's `reply`/`react`/`unreact`/
// `readContract`, the rooms + reactions + contract projections, and the ledger are all real.
//
// The scenario uses TWO genuinely-distinct agents posting COMPETING proposals (the back-and-forth
// IS the room history), then ratifies, freezes, reverts, and re-freezes a refinement:
//   Need  M1  — ada post_announcement (the seeding need, message #1)
//   Propose M2 — bob reply  "Proposal A"           (first reply activates the room + auto-joins bob)
//   Counter M3 — ada reply  "Proposal B (counter)"  (a competing alternative; auto-joins ada)
//   Ratify     — bob 👍 M2; ada 👍 M3; bob 👍 M3      (the room converges on M3)
//   Frozen     — read_contract = M3                  (highest-seq live-👍'd message wins, FR21)
//   Revert     — ada + bob unreact M3                → read_contract reverts to M2 (still live-👍'd)
//   Re-freeze  — bob reply "Refinement" (M4); 👍 M4  → read_contract = M4 (most-recent agreement wins)
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

/** One message as it appears on the read_room wire (incl. its live 👍 reactors). */
interface WireMessage {
  seq: number;
  actor: string;
  body: string;
  kind: 'announcement' | 'reply';
  reactions: string[];
}

/** The read_contract envelope — an inline cast target at each call site (mirrors the sibling tests). */
type ContractEnvelope = { room_id: string; contract: WireMessage | null };

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test sets the session the tools act as.
 * Returns the connected client (the very session holder the server's tools read is internal).
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

/** Register an identity on a fresh connection AND announce a sub-board (first member = announcer). */
async function registerAndAnnounce(
  handle: string,
  projectId: string,
): Promise<Client> {
  const { client } = await connect();
  const reg = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'negotiating a boundary' },
  })) as CallToolResult;
  expect(reg.isError).toBeFalsy();
  const ok = (await client.callTool({
    name: 'announce_project',
    arguments: { title: projectId, description: `the ${projectId} board` },
  })) as CallToolResult;
  expect(ok.isError).toBeFalsy();
  return client;
}

/**
 * Register a BRAND-NEW handle on its own fresh connection; return that connection (its session now
 * acts as the handle). `register` of a never-before-seen handle establishes the session in one
 * call — this is how a distinct peer joins the negotiation in the sibling integration tests.
 */
async function registerPeer(handle: string): Promise<Client> {
  const { client } = await connect();
  const reg = (await client.callTool({
    name: 'register',
    arguments: { handle, current_focus: 'negotiating a boundary' },
  })) as CallToolResult;
  expect(reg.isError).toBeFalsy();
  return client;
}

/** Move: Need — post the seeding announcement (proto-room); return its room_id. */
async function postNeed(
  client: Client,
  projectId: string,
  subject: string,
  body: string,
): Promise<string> {
  const result = (await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: projectId, subject, body },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { room: { room_id: string } }).room
    .room_id;
}

/** Move: Propose / Counter — post a (counter-)proposal as a `reply` in the room. */
async function proposeOrCounter(
  client: Client,
  roomId: string,
  body: string,
): Promise<void> {
  const r = (await client.callTool({
    name: 'reply',
    arguments: { room_id: roomId, body },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
}

/** Move: Ratify — place a live 👍 on a specific message (requires participation). */
async function ratify(client: Client, messageSeq: number): Promise<void> {
  const r = (await client.callTool({
    name: 'react',
    arguments: { message_seq: messageSeq },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
}

/** Retract a previously-placed 👍 (the only way a ratification comes back). */
async function retract(client: Client, messageSeq: number): Promise<void> {
  const r = (await client.callTool({
    name: 'unreact',
    arguments: { message_seq: messageSeq },
  })) as CallToolResult;
  expect(r.isError).toBeFalsy();
}

/** Read a room's full ordered history (as any established identity); return the messages array. */
async function readRoomMessages(
  client: Client,
  roomId: string,
): Promise<WireMessage[]> {
  const result = (await client.callTool({
    name: 'read_room',
    arguments: { room_id: roomId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { messages: WireMessage[] }).messages;
}

/** Move: Frozen — compute the room's current agreed contract via read_contract. */
async function readContract(
  client: Client,
  roomId: string,
): Promise<ContractEnvelope> {
  const result = (await client.callTool({
    name: 'read_contract',
    arguments: { room_id: roomId },
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  return result.structuredContent as ContractEnvelope;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-skillrules-protocol-int-'));
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

describe('skill-rules registry Rule B — the Negotiation Protocol convention is EXECUTABLE end-to-end (Story 8.3)', () => {
  it('Propose/Counter (reply) → Ratify (react 👍) → Frozen (read_contract) → Revert (unreact) → re-freeze a refinement', async () => {
    // === Need (M1) ============================================================================
    // ada opens the boundary: she announces the sub-board and posts the seeding need (message #1).
    const ada = await registerAndAnnounce('ada', 'calling-interface');
    const roomId = await postNeed(
      ada,
      'calling-interface',
      'Shape of the register() return',
      'Need to agree: does register() return the handle, or {handle, focus}?',
    );

    // === Propose (M2) — reply ================================================================
    // bob (a peer) dials in and posts the opening Proposal as a `reply`. Per the registry, the
    // FIRST reply activates the proto-room into a live room AND auto-joins bob (grant-on-act) —
    // so bob may later `react` without an explicit join.
    const bob = await registerPeer('bob');
    await proposeOrCounter(
      bob,
      roomId,
      'Proposal A: register() returns the bare handle string.',
    );

    // === Counter (M3) — reply ================================================================
    // ada posts a COMPETING alternative as another `reply`. The back-and-forth IS the seq-ordered
    // room history. Replying also auto-joins ada to the room (she announced the board but had not
    // participated in THIS room yet) — so she too may ratify.
    await proposeOrCounter(
      ada,
      roomId,
      'Proposal B (counter): register() returns {handle, current_focus}.',
    );

    // CAPTURE the real seqs from read_room: M1 announcement < M2 Proposal A < M3 Proposal B.
    const afterCounter = await readRoomMessages(bob, roomId);
    expect(afterCounter.map((m) => m.kind)).toEqual([
      'announcement',
      'reply',
      'reply',
    ]);
    const m1Seq = afterCounter[0]!.seq; // the need (announcement)
    const m2Seq = afterCounter[1]!.seq; // Proposal A (bob)
    const m3Seq = afterCounter[2]!.seq; // Proposal B / counter (ada)
    expect(afterCounter[1]!.actor).toBe('bob');
    expect(afterCounter[2]!.actor).toBe('ada');
    expect(m2Seq).toBeGreaterThan(m1Seq);
    expect(m3Seq).toBeGreaterThan(m2Seq);

    // Before any 👍 → "no contract yet" (read_contract returns null — the FR21 absence convention).
    expect((await readContract(bob, roomId)).contract).toBeNull();

    // === Ratify — react 👍 ===================================================================
    // bob places a live 👍 on Proposal A (M2). ada and bob both place a live 👍 on Proposal B
    // (M3) — the room converges on M3 as the accepted contract.
    await ratify(bob, m2Seq); // bob still likes his own Proposal A
    await ratify(ada, m3Seq); // ada ratifies her counter
    await ratify(bob, m3Seq); // bob agrees — both 👍 the convergence message

    // === Frozen — read_contract ==============================================================
    // The current agreed contract is the HIGHEST-seq message holding a live 👍 = M3 (Proposal B),
    // even though M2 ALSO holds a live 👍 (bob's). Most-recent agreement wins (FR21).
    {
      const env = await readContract(ada, roomId);
      expect(env.room_id).toBe(roomId);
      expect(env.contract).not.toBeNull();
      expect(env.contract!.seq).toBe(m3Seq);
      expect(env.contract!.kind).toBe('reply');
      expect(env.contract!.body).toBe(
        'Proposal B (counter): register() returns {handle, current_focus}.',
      );
      // Both ratifiers are on the frozen message (live reactors, sorted).
      expect(env.contract!.reactions).toEqual(['ada', 'bob']);
    }

    // A THIRD party (the operator / a downstream agent) who NEVER joined reads the SAME frozen
    // contract on demand (open read, FR9) — the agreement is mechanically locatable by anyone.
    {
      const reader = await registerPeer('cleo');
      const env = await readContract(reader, roomId);
      expect(env.contract!.seq).toBe(m3Seq);
    }

    // === Revert — unreact ====================================================================
    // The agreement on M3 is withdrawn: both ratifiers retract their 👍. The contract is COMPUTED
    // every call (never stored), so read_contract reverts to the next-highest live-👍'd message =
    // M2 (Proposal A, still holding bob's 👍). Reversion is just recomputation — no stored revert.
    await retract(ada, m3Seq);
    await retract(bob, m3Seq);
    {
      const env = await readContract(ada, roomId);
      expect(env.contract).not.toBeNull();
      expect(env.contract!.seq).toBe(m2Seq);
      expect(env.contract!.body).toBe(
        'Proposal A: register() returns the bare handle string.',
      );
      expect(env.contract!.reactions).toEqual(['bob']);
    }

    // === Re-freeze a refinement (M4) — reply + react 👍 ======================================
    // The team refines the decision: bob posts a NEW message (a refinement) and it earns a live
    // 👍. read_contract returns THAT one (higher seq) — ratifying a refinement supersedes the
    // earlier agreement automatically (most-recent-agreement-wins, the converse of revert).
    await proposeOrCounter(
      bob,
      roomId,
      'Refinement: register() returns {handle, current_focus, registered_at}.',
    );
    const afterRefine = await readRoomMessages(bob, roomId);
    const m4Seq = afterRefine[afterRefine.length - 1]!.seq;
    expect(m4Seq).toBeGreaterThan(m3Seq);
    await ratify(bob, m4Seq);
    {
      const env = await readContract(ada, roomId);
      expect(env.contract!.seq).toBe(m4Seq);
      expect(env.contract!.body).toBe(
        'Refinement: register() returns {handle, current_focus, registered_at}.',
      );
    }
  });
});
