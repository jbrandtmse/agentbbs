// Lead per-story smoke for Story 7.2 (seed + surface the protocol announcement).
// Drives the REAL stdio binary, which SEEDS the protocol at bootstrap (main.ts). Proves a
// fresh agent meets the protocol: first check surfaces it, second does not, join_board
// surfaces it, and it is open-readable. (No manual seeding — the real binary does it.)
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-7-2.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-7-2-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-7-2', version: '0.0.0' });
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

try {
  await client.connect(transport); // main.ts seeds the protocol here

  // alice sets up a board to join later.
  await call('register', { handle: 'alice', current_focus: 'x' });
  await call('announce_project', { title: 'Test Board', description: 'd' });

  // bob is fresh — his FIRST check surfaces the protocol.
  await call('register', { handle: 'bob', current_focus: 'x' });
  const c1 = parse(await call('check', {}));
  ok(c1.protocol != null, 'fresh identity\'s FIRST check surfaces the protocol announcement');
  ok(c1.protocol?.room_id === 'how-this-board-works', `the surfaced protocol is the how-this-board-works announcement (got "${c1.protocol?.room_id}")`);

  // bob's SECOND check does NOT re-surface it (he's seen it).
  const c2 = parse(await call('check', {}));
  ok(c2.protocol == null, 'the SECOND check does NOT re-surface the protocol (already seen)');

  // bob join_board → the protocol is surfaced in the join result.
  const jb = parse(await call('join_board', { project_id: 'test-board' }));
  ok(jb.protocol != null && jb.protocol.room_id === 'how-this-board-works', 'join_board surfaces the protocol announcement');

  // The protocol is OPEN-readable (FR9) and states the four moves.
  const room = parse(await call('read_room', { room_id: 'how-this-board-works' }));
  const body = room.messages?.[0]?.body ?? '';
  ok(room.messages?.[0]?.kind === 'announcement', 'the protocol announcement is message #1 of how-this-board-works');
  for (const move of ['Propose', 'Counter', 'Ratify', 'Frozen']) {
    ok(body.includes(move), `the protocol body states the move: ${move}`);
  }

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
