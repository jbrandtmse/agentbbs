// Lead per-story smoke for Story 6.1 (check — pull-only delta + cursor + no-flood floor).
// Drives the REAL stdio binary: a late joiner's first check is NOT flooded with the board's
// pre-join announcements; a new announcement after the join surfaces on the next check; an
// empty check leaves the cursor unchanged; last_seen advances; check before register →
// NO_IDENTITY; check never pushes (it's a pull request/response).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-6-1.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-6-1-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-6-1', version: '0.0.0' });
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

try {
  await client.connect(transport);
  ok((await client.listTools()).tools.map((t) => t.name).includes('check'), 'check advertised');

  // check before register → NO_IDENTITY.
  const noId = await call('check', {});
  ok(noId.isError === true && /NO_IDENTITY/.test(JSON.stringify(noId)), 'check before register → NO_IDENTITY');

  // alice creates a board with OLD announcements (before bob joins).
  await call('register', { handle: 'alice', current_focus: 'x' });
  await call('announce_project', { title: 'Calling Interface', description: 'd' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Old Need One', body: 'b' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Old Need Two', body: 'b' });

  // bob registers and joins the board AFTER the old announcements → his floor excludes them.
  await call('register', { handle: 'bob', current_focus: 'x' });
  await call('join_board', { project_id: 'calling-interface' });

  // bob's FIRST check: NOT flooded with the 2 pre-join announcements.
  const c1 = parse(await call('check', {}));
  ok(Array.isArray(c1.announcements) && c1.announcements.length === 0, `first check is NOT flooded with pre-join announcements (got ${c1.announcements?.length})`);
  const cursor1 = c1.cursor;

  // bob is now present in the board directory (last_seen advanced by check's recordSeen).
  const m1 = parse(await call('list_members', { project_id: 'calling-interface' })).members.find((x) => x.handle === 'bob');
  ok(m1 && m1.last_seen, 'check advanced bob\'s last_seen (present in list_members)');

  // alice posts a NEW announcement (after bob's join floor).
  await call('login', { handle: 'alice' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Fresh Need', body: 'b' });

  // bob's next check returns the new announcement (seq > his floor) and advances the cursor.
  await call('login', { handle: 'bob' });
  const c2 = parse(await call('check', {}));
  ok(c2.announcements.length === 1 && c2.announcements[0].subject === 'Fresh Need', `next check returns ONLY the post-join announcement (got ${JSON.stringify(c2.announcements.map((a) => a.subject))})`);
  ok(c2.cursor > cursor1, `cursor advanced (${cursor1} → ${c2.cursor})`);

  // A third check with no new activity → empty delta, cursor unchanged.
  const c3 = parse(await call('check', {}));
  ok(c3.announcements.length === 0 && (c3.messages?.length ?? 0) === 0, 'no-activity check → empty delta');
  ok(c3.cursor === c2.cursor, `no-activity check → cursor UNCHANGED (${c2.cursor})`);

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
