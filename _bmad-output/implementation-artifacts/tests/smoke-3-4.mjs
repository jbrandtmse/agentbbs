// Lead per-story smoke for Story 3.4 (list_members — sub-board directory).
// Drives the REAL stdio MCP server across three sessions sharing one DB:
// alice announces a board + updates focus; bob joins + sets a DIFFERENT focus;
// carol (member of NEITHER) reads list_members and must see BOTH, announcer-first,
// with each member's latest current_focus and DISTINCT last_seen. Unknown board
// → BOARD_NOT_FOUND.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-4.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-4-'));
const dbPath = join(dir, 'agentbbs.db');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};
const parse = (res) => (res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? '{}'));

async function session(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
    env: { ...process.env, AGENTBBS_DB: dbPath },
  });
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(transport);
  return client;
}

let a, b, c;
try {
  a = await session('smoke-3-4-a');
  await a.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'announcing' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'the board' } });
  await a.callTool({ name: 'update_focus', arguments: { current_focus: 'drafting the call schema' } });
  await a.close();

  b = await session('smoke-3-4-b');
  await b.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'lurking' } });
  await b.callTool({ name: 'join_board', arguments: { project_id: 'calling-interface' } });
  await b.callTool({ name: 'update_focus', arguments: { current_focus: 'reviewing the call schema' } });
  await b.close();

  // carol: a member of NEITHER board, just reads.
  c = await session('smoke-3-4-c');
  await c.callTool({ name: 'register', arguments: { handle: 'carol', current_focus: 'observing' } });

  const unknown = await c.callTool({ name: 'list_members', arguments: { project_id: 'no-such-board' } });
  ok(unknown.isError === true && /BOARD_NOT_FOUND/.test(JSON.stringify(unknown)), 'list_members unknown board → BOARD_NOT_FOUND');

  const dirRes = await c.callTool({ name: 'list_members', arguments: { project_id: 'calling-interface' } });
  ok(dirRes.isError !== true, 'carol (member of neither) reads the directory (open read)');
  const members = parse(dirRes).members ?? [];
  ok(members.length === 2, `directory has both members (got ${members.length})`);
  ok(members[0]?.handle === 'alice' && members[1]?.handle === 'bob', 'members in join order, announcer (alice) first');
  ok(members[0]?.current_focus === 'drafting the call schema', "alice's LATEST focus is surfaced (not registration focus)");
  ok(members[1]?.current_focus === 'reviewing the call schema', "bob's LATEST focus is surfaced");
  ok(
    typeof members[0]?.last_seen === 'string' && typeof members[1]?.last_seen === 'string' &&
      members[0].last_seen !== members[1].last_seen,
    'each member has a DISTINCT derived last_seen (distinguishable for UI staleness)',
  );
  ok(!('stale' in (members[0] ?? {})), 'no stale boolean computed in core (display value only)');
  await c.close();
} finally {
  for (const cl of [a, b, c]) { try { await cl?.close(); } catch { /* noop */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
