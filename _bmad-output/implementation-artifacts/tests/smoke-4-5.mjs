// Lead per-story smoke for Story 4.5 (add_participant — pull a peer into a room).
// Drives the REAL stdio MCP server: alice announces+posts, bob replies (becomes a
// participant), bob add_participants cleo (a registered non-member) → cleo becomes a
// participant + sub-board member. Error paths: HANDLE_NOT_FOUND, ROOM_NOT_FOUND,
// NOT_A_MEMBER (alice is a board member but NOT a room participant). Idempotent re-add.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-4-5.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);
const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
const { createDataAccess } = await import(daUrl);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-4-5-'));
const dbPath = join(dir, 'agentbbs.db');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};
const parse = (res) => (res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-4-5', version: '0.0.0' });

try {
  await client.connect(transport);
  ok((await client.listTools()).tools.map((t) => t.name).includes('add_participant'), 'add_participant advertised (12th tool)');

  // alice announces (board member) + posts a proto-room; bob replies (participant + member).
  await client.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'leading' } });
  await client.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'design it' } });
  await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Need Help', body: 'who can help?' } });
  await client.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'helping' } });
  await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'on it' } });

  // cleo registers but never joins calling-interface.
  await client.callTool({ name: 'register', arguments: { handle: 'cleo', current_focus: 'idle' } });
  // login back as bob (a participant) to do the add.
  await client.callTool({ name: 'login', arguments: { handle: 'bob' } });

  // bob pulls cleo into the room.
  const add = await client.callTool({ name: 'add_participant', arguments: { room_id: 'need-help', handle: 'cleo' } });
  ok(add.isError !== true, 'participant bob add_participant cleo succeeds');
  const parts = parse(add).participants;
  ok(Array.isArray(parts) && parts.includes('cleo') && parts.includes('bob'), `participants now include bob + cleo (got ${JSON.stringify(parts)})`);

  // cleo is now a sub-board member (auto-joined).
  const members = parse(await client.callTool({ name: 'list_members', arguments: { project_id: 'calling-interface' } })).members.map((m) => m.handle);
  ok(members.includes('cleo'), 'cleo is now a sub-board member (pulled-in peer auto-joins the board)');

  // HANDLE_NOT_FOUND — unregistered target.
  const noHandle = await client.callTool({ name: 'add_participant', arguments: { room_id: 'need-help', handle: 'ghostzzz' } });
  ok(noHandle.isError === true && /HANDLE_NOT_FOUND/.test(JSON.stringify(noHandle)), 'unregistered target → HANDLE_NOT_FOUND');

  // ROOM_NOT_FOUND — unknown room.
  const noRoom = await client.callTool({ name: 'add_participant', arguments: { room_id: 'no-such-room', handle: 'cleo' } });
  ok(noRoom.isError === true && /ROOM_NOT_FOUND/.test(JSON.stringify(noRoom)), 'unknown room → ROOM_NOT_FOUND');

  // NOT_A_MEMBER — alice is a board member but NOT a room participant (announced, never replied).
  await client.callTool({ name: 'login', arguments: { handle: 'alice' } });
  const notPart = await client.callTool({ name: 'add_participant', arguments: { room_id: 'need-help', handle: 'cleo' } });
  ok(notPart.isError === true && /NOT_A_MEMBER/.test(JSON.stringify(notPart)), 'board-member-but-not-room-participant adder → NOT_A_MEMBER');

  // Idempotent re-add — bob adds cleo again, no error, no duplicate participant.
  await client.callTool({ name: 'login', arguments: { handle: 'bob' } });
  const re = await client.callTool({ name: 'add_participant', arguments: { room_id: 'need-help', handle: 'cleo' } });
  ok(re.isError !== true, 're-add of an existing participant is a no-op (no error)');

  await client.close();

  // === Out-of-band ledger (real SQLite) ===
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const added = await da.eventsByType('room.participant_added');
    const joined = await da.eventsByType('board.joined');
    ok(added.length === 1, `exactly ONE room.participant_added (idempotent re-add appended nothing) — got ${added.length}`);
    ok(added[0]?.payload?.handle === 'cleo' && added[0]?.actor === 'bob', 'the participant_added names cleo (handle) added by bob (actor)');
    const cleoJoins = joined.filter((e) => e.actor === 'cleo').length;
    ok(cleoJoins === 1, `cleo has exactly ONE board.joined (from the pull-in) — got ${cleoJoins}`);
  } finally {
    da.close();
  }
} finally {
  try { await client.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
