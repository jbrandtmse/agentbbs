// Lead per-story smoke for Story 5.1 (verbatim message + 256 KB BODY_TOO_LARGE cap).
// Drives the REAL stdio binary: a near-cap unicode/markdown body round-trips byte-identical
// through reply → read_room; an over-cap body → BODY_TOO_LARGE with nothing appended (both
// reply and post_announcement). Asserts the real-SQLite ledger out-of-band.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-5-1.mjs

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

const MAX = 256 * 1024;
const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-5-1-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-5-1', version: '0.0.0' });

// A near-cap body: a unicode prefix + ASCII fill to exactly MAX bytes.
const prefix = '# Proposal 🤝 你好\n\n```ts\nconst x = 1;\n```\n';
const nearCap = prefix + 'a'.repeat(MAX - Buffer.byteLength(prefix, 'utf8'));
const overCap = 'a'.repeat(MAX + 1);

try {
  await client.connect(transport);
  await client.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'x' } });
  await client.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'd' } });
  await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Need Help', body: 'seed' } });

  // Near-cap reply (exactly MAX bytes) → accepted + verbatim.
  ok(Buffer.byteLength(nearCap, 'utf8') === MAX, `near-cap body is exactly ${MAX} bytes`);
  const r = await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: nearCap } });
  ok(r.isError !== true, 'at-cap reply (262144 bytes) is accepted');

  // read_room returns it byte-for-byte.
  const h = parse(await client.callTool({ name: 'read_room', arguments: { room_id: 'need-help' } }));
  const replyMsg = h.messages.find((m) => m.kind === 'reply');
  ok(replyMsg?.body === nearCap && Buffer.byteLength(replyMsg.body, 'utf8') === MAX, 'read_room returns the at-cap body BYTE-FOR-BYTE (verbatim, no transform)');

  // Over-cap reply → BODY_TOO_LARGE.
  const ro = await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: overCap } });
  ok(ro.isError === true && /BODY_TOO_LARGE/.test(JSON.stringify(ro)), 'over-cap reply → BODY_TOO_LARGE');

  // Over-cap announcement → BODY_TOO_LARGE.
  const ao = await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Big', body: overCap } });
  ok(ao.isError === true && /BODY_TOO_LARGE/.test(JSON.stringify(ao)), 'over-cap post_announcement → BODY_TOO_LARGE');

  await client.close();

  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const replied = await da.eventsByType('room.replied');
    const announced = await da.eventsByType('announcement.posted');
    ok(replied.length === 1, `exactly ONE room.replied (the at-cap one; over-cap appended nothing) — got ${replied.length}`);
    ok(announced.length === 1, `exactly ONE announcement.posted (the seed; over-cap appended nothing) — got ${announced.length}`);
    ok(Buffer.byteLength(replied[0].payload.body, 'utf8') === MAX, 'the stored room.replied body is the full 262144 bytes (verbatim at rest)');
  } finally { da.close(); }
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
