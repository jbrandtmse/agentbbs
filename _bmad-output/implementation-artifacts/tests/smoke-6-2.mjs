// Lead per-story smoke for Story 6.2 (bounded pull-only delivery + dead-letter).
// Drives the REAL stdio binary: a late joiner's check delta is BOUNDED by NEW activity (not
// the ledger's back-history size); and the back-history needs PERSIST + stay open-readable
// (the durable dead-letter) even though check never delivered them.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-6-2.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-6-2-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-6-2', version: '0.0.0' });
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

const BACK = 10; // large pre-floor back-history of announcements

try {
  await client.connect(transport);

  // alice builds a large back-history of announcements.
  await call('register', { handle: 'alice', current_focus: 'x' });
  await call('announce_project', { title: 'Calling Interface', description: 'd' });
  for (let i = 0; i < BACK; i++) {
    await call('post_announcement', { project_id: 'calling-interface', subject: `Old Need ${i}`, body: 'b' });
  }

  // carol joins the board AFTER the back-history (floor) and dials in.
  await call('register', { handle: 'carol', current_focus: 'x' });
  await call('join_board', { project_id: 'calling-interface' });

  // BOUNDED: carol's first check delta is 0 (the BACK old announcements are pre-floor),
  // NOT BACK — the delta tracks new activity, not the ledger's back-history size.
  const c1 = parse(await call('check', {}));
  ok(c1.announcements.length === 0, `bounded: first check delta is 0, NOT the ${BACK}-announcement back-history (got ${c1.announcements.length})`);

  // A couple of NEW announcements after carol's join.
  await call('login', { handle: 'alice' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Fresh A', body: 'b' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Fresh B', body: 'b' });

  // BOUNDED: carol's check returns exactly the 2 new ones — bounded by NEW activity, not the
  // 12 total announcements now in the ledger.
  await call('login', { handle: 'carol' });
  const c2 = parse(await call('check', {}));
  ok(c2.announcements.length === 2, `bounded: check returns the 2 NEW announcements, not all ${BACK + 2} (got ${c2.announcements.length})`);

  // DEAD-LETTER PERSISTS: all BACK+2 announcements remain durable + OPEN-readable (the
  // operator backstop) — the old BACK were never delivered to carol via check, but nothing
  // is lost (append-only). A non-member open read sees the full set.
  await call('register', { handle: 'operator', current_focus: 'overseeing' }); // not a member
  const all = parse(await call('list_announcements', { project_id: 'calling-interface' })).announcements;
  ok(all.length === BACK + 2, `dead-letter persists: all ${BACK + 2} needs are durable + open-readable by a non-member operator (got ${all.length})`);
  ok(all.some((a) => a.subject === 'Old Need 0'), 'an undelivered (pre-floor) need is still present in the ledger (durable, not lost)');

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
