// Lead per-story smoke for Story 4.6 (join-cursor — no back-history flood).
// 4.6 is a CORE projection (no MCP tool; consumer `check` is Story 6.1). So the smoke
// BUILDS a real ledger via the REAL stdio MCP tools (announce/post/reply), then exercises
// the new core projection (roomJoinSeq / roomMessagesSince) against that REAL SQLite ledger
// to prove the per-room floor excludes back-history — exactly what 6.1's `check` will use.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-4-6.mjs

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
const coreUrl = pathToFileURL(join(process.cwd(), 'packages/core/dist/index.js')).href;
const { roomJoinSeq, roomMessagesSince } = await import(coreUrl);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-4-6-'));
const dbPath = join(dir, 'agentbbs.db');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-4-6', version: '0.0.0' });

try {
  await client.connect(transport);

  // Build real ledger history via the real tools: announce → post → alice/bob/cleo reply.
  await client.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'leading' } });
  await client.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'design it' } });
  await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Need Help', body: 'announcement body' } });
  await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'alice reply (r1)' } }); // alice joins at r1
  await client.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'helping' } });
  await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'bob reply (r2)' } });   // bob joins at r2
  await client.callTool({ name: 'register', arguments: { handle: 'cleo', current_focus: 'helping' } });
  await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'cleo reply (r3)' } });  // cleo joins last at r3
  await client.callTool({ name: 'register', arguments: { handle: 'reader', current_focus: 'lurking' } });  // never joins the room

  await client.close();

  // === Exercise the NEW projection against the REAL ledger ===
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const events = await da.eventsSince(0);

    const aliceCur = roomJoinSeq(events, 'need-help', 'alice');
    const bobCur = roomJoinSeq(events, 'need-help', 'bob');
    const cleoCur = roomJoinSeq(events, 'need-help', 'cleo');
    ok(typeof aliceCur === 'number' && aliceCur < bobCur && bobCur < cleoCur, `join cursors increase by join order (alice ${aliceCur} < bob ${bobCur} < cleo ${cleoCur})`);

    // No-flood: bob joined at r2 → "new for me" excludes the announcement + alice's r1 + bob's own r2; includes only cleo's r3.
    const bobNew = roomMessagesSince(events, 'need-help', bobCur).map((m) => m.body);
    ok(bobNew.length === 1 && bobNew[0] === 'cleo reply (r3)', `bob's "new for me" = only post-join messages (no back-history flood): ${JSON.stringify(bobNew)}`);

    // alice joined at r1 → new = bob r2 + cleo r3 (excludes announcement + her own r1).
    const aliceNew = roomMessagesSince(events, 'need-help', aliceCur).map((m) => m.body);
    ok(aliceNew.length === 2 && aliceNew[0] === 'bob reply (r2)' && aliceNew[1] === 'cleo reply (r3)', `alice's "new for me" excludes announcement + her own reply: ${JSON.stringify(aliceNew)}`);

    // cleo joined last → nothing new after her.
    const cleoNew = roomMessagesSince(events, 'need-help', cleoCur).map((m) => m.body);
    ok(cleoNew.length === 0, `cleo (joined last) has no new messages after her join: ${JSON.stringify(cleoNew)}`);

    // Non-participant → undefined cursor (not in check's room scope).
    ok(roomJoinSeq(events, 'need-help', 'reader') === undefined, 'a non-participant has an undefined join cursor (room not in their check scope)');

    // The announcer (alice) joined by REPLYING (r1), so her cursor is r1 — NOT the announcement seq.
    const annEvents = events.filter((e) => e.type === 'announcement.posted' && e.payload?.roomId === 'need-help');
    ok(annEvents.length === 1 && annEvents[0].seq < aliceCur, "announcer's cursor is her REPLY seq, not the announcement seq (announcement excluded from her 'new')");
  } finally {
    da.close();
  }
} finally {
  try { await client.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
