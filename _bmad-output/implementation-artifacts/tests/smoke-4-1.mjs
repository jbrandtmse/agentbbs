// Lead per-story smoke for Story 4.1 (post_announcement + proto-room).
// Drives the REAL stdio MCP server (the exact production path an agent host uses):
// spawns `node packages/mcp-server/dist/main.js` over StdioClientTransport, with
// AGENTBBS_DB pointed at a throwaway temp ledger. Asserts the user-observable tool
// results AND the out-of-band ledger state (real SQLite).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-4-1.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-4-1-'));
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
const client = new Client({ name: 'smoke-4-1', version: '0.0.0' });

try {
  await client.connect(transport);

  // Tool advertised on the discovery surface.
  const tools = (await client.listTools()).tools.map((t) => t.name);
  ok(tools.includes('post_announcement'), 'post_announcement advertised in tools/list');

  // No identity yet → NO_IDENTITY (session precondition).
  const noId = await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'whatever', subject: 'x', body: 'y' },
  });
  ok(noId.isError === true && /NO_IDENTITY/.test(JSON.stringify(noId)), 'post before register → NO_IDENTITY');

  // Establish identity + a sub-board (announcer is its first member).
  await client.callTool({ name: 'register', arguments: { handle: 'scout', current_focus: 'booting' } });
  await client.callTool({
    name: 'announce_project',
    arguments: { title: 'Calling Interface', description: 'design the calling interface' },
  });

  // BOARD_NOT_FOUND — post to a board that does not exist.
  const noBoard = await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'does-not-exist', subject: 'hi', body: 'there' },
  });
  ok(noBoard.isError === true && /BOARD_NOT_FOUND/.test(JSON.stringify(noBoard)), 'post to unknown board → BOARD_NOT_FOUND');

  // Happy path — member posts an announcement; roomId = subject slug.
  const a = await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'calling-interface', subject: 'Need a Reviewer', body: 'who can review the PR?' },
  });
  ok(a.isError !== true, 'member post_announcement succeeds');
  const room1 = parse(a).room;
  ok(room1?.room_id === 'need-a-reviewer', `roomId is the subject slug → "need-a-reviewer" (got "${room1?.room_id}")`);
  ok(room1?.project_id === 'calling-interface', 'room carries the board scope project_id');
  ok(room1?.subject === 'Need a Reviewer', 'subject stored verbatim');
  ok(room1?.body === 'who can review the PR?', 'body stored verbatim');
  ok(room1?.posted_by === 'scout', 'posted_by is the session identity');
  ok(room1?.active === false, 'a fresh announcement is a proto-room (active=false)');

  // Same subject again → disambiguated roomId (-2), no error.
  const a2 = await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'calling-interface', subject: 'Need a Reviewer', body: 'second one' },
  });
  ok(a2.isError !== true, 'same-subject post succeeds (no error)');
  ok(parse(a2).room?.room_id === 'need-a-reviewer-2', `same-subject disambiguates → "need-a-reviewer-2" (got "${parse(a2).room?.room_id}")`);

  // A second identity that did NOT join → NOT_A_MEMBER.
  await client.callTool({ name: 'register', arguments: { handle: 'outsider', current_focus: 'lurking' } });
  const notMember = await client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'calling-interface', subject: 'sneaky', body: 'let me in' },
  });
  ok(notMember.isError === true && /NOT_A_MEMBER/.test(JSON.stringify(notMember)), 'non-member post → NOT_A_MEMBER');

  await client.close();

  // === Out-of-band ledger assertions (real SQLite, after the server closed) ===
  const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
  const { createDataAccess } = await import(daUrl);
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const posted = await da.eventsByType('announcement.posted');
    ok(posted.length === 2, `exactly two announcement.posted in ledger (the non-member + bad-board attempts appended nothing) — got ${posted.length}`);
    ok(posted[0]?.payload?.projectId === 'calling-interface', 'stored announcement.posted carries projectId (board scope)');
    ok(posted[0]?.payload?.roomId === 'need-a-reviewer', 'stored announcement.posted carries the slug roomId');
    const roomIds = posted.map((e) => e.payload?.roomId).sort();
    ok(roomIds[0] === 'need-a-reviewer' && roomIds[1] === 'need-a-reviewer-2', 'the two proto-rooms have distinct disambiguated ids');
  } finally {
    da.close();
  }
} finally {
  try { await client.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
