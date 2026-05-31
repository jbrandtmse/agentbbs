// Lead per-story smoke for Story 4.3 (reply → activate room, "acting = joining").
// Drives the REAL stdio MCP server. alice announces a board + posts a proto-room; bob
// (NOT a member) replies → room activates, bob auto-joins as member + is the activator;
// alice (already a member) replies → NO second board.joined. Asserts tool results AND
// the out-of-band real-SQLite ledger.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-4-3.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-4-3-'));
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
const client = new Client({ name: 'smoke-4-3', version: '0.0.0' });

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  ok(tools.includes('reply'), 'reply advertised in tools/list');

  // alice announces a board (becomes a member) + posts a proto-room.
  await client.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'leading' } });
  await client.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'design it' } });
  await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Need Help', body: 'who can help?' } });

  // Before any reply: it's a proto-room.
  ok(parse(await client.callTool({ name: 'list_rooms', arguments: { project_id: 'calling-interface' } })).rooms.length === 0, 'no active rooms before any reply');

  // bob registers (NOT a member of calling-interface) and replies → activates + auto-joins.
  await client.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'helping' } });

  // reply to a non-existent room → ROOM_NOT_FOUND.
  const noRoom = await client.callTool({ name: 'reply', arguments: { room_id: 'no-such-room', body: 'hello?' } });
  ok(noRoom.isError === true && /ROOM_NOT_FOUND/.test(JSON.stringify(noRoom)), 'reply to unknown room → ROOM_NOT_FOUND');

  const r = await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'I can help!' } });
  ok(r.isError !== true, 'bob reply succeeds');
  const room = parse(r).room;
  ok(room?.active === true, 'room is now ACTIVE after the first reply');
  ok(room?.activated_by === 'bob', `activator is bob (got "${room?.activated_by}")`);

  // The room moved from list_announcements to list_rooms.
  ok(parse(await client.callTool({ name: 'list_rooms', arguments: { project_id: 'calling-interface' } })).rooms.length === 1, 'room now appears in list_rooms');
  ok(parse(await client.callTool({ name: 'list_announcements', arguments: { project_id: 'calling-interface' } })).announcements.length === 0, 'room no longer in list_announcements');

  // bob auto-joined the sub-board (acting = joining).
  const members = parse(await client.callTool({ name: 'list_members', arguments: { project_id: 'calling-interface' } })).members.map((m) => m.handle);
  ok(members.includes('bob'), 'bob auto-joined the sub-board as a member (acting = joining)');
  ok(members.includes('alice'), 'alice (announcer) is a member');

  // alice (already a member) logs back in and replies → ordinary message, NO second board.joined, activator unchanged.
  await client.callTool({ name: 'login', arguments: { handle: 'alice' } });
  const r2 = await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'thanks bob' } });
  ok(r2.isError !== true, 'alice (already-member) reply succeeds');
  ok(parse(r2).room?.activated_by === 'bob', 'activator UNCHANGED after a later reply (still bob, the min-seq)');

  await client.close();

  // === Out-of-band ledger assertions (real SQLite) ===
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const replied = await da.eventsByType('room.replied');
    const joined = await da.eventsByType('board.joined');
    ok(replied.length === 2, `two room.replied events (bob + alice) — got ${replied.length}`);
    ok(replied[0].actor === 'bob' && replied[0].seq < replied[1].seq, 'the min-seq reply is bob (the activator), alice second');
    const aliceJoins = joined.filter((e) => e.actor === 'alice').length;
    const bobJoins = joined.filter((e) => e.actor === 'bob').length;
    ok(aliceJoins === 1, `alice has exactly ONE board.joined (from announce; her reply added NO 2nd) — got ${aliceJoins}`);
    ok(bobJoins === 1, `bob has exactly ONE board.joined (from his reply auto-join) — got ${bobJoins}`);
  } finally {
    da.close();
  }
} finally {
  try { await client.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
