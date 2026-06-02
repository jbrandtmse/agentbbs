// Lead per-story smoke for Story 3.2 (list_projects / browse the main board).
// Drives the REAL stdio MCP server. Two separate stdio sessions share one DB:
// session A (alice) announces two projects in a known NON-alphabetical order;
// session B (bob, a member of nothing) calls list_projects and must see BOTH,
// ordered by announcement seq — proving board-wide-open-read-without-membership.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-2.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-2-'));
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

let a, b;
try {
  // --- Session A: alice announces two projects (Zephyr first, Alpha second:
  // announcement-seq order is the REVERSE of alphabetical). ---
  a = await session('smoke-3-2-a');
  await a.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'seeding' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Zephyr Board', description: 'first' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Alpha Board', description: 'second' } });
  await a.close();

  // --- Session B: bob registers (member of NO sub-board) and browses. ---
  b = await session('smoke-3-2-b');
  // Before bob registers, list_projects must reject with NO_IDENTITY.
  const noId = await b.callTool({ name: 'list_projects', arguments: {} });
  ok(noId.isError === true && /NO_IDENTITY/.test(JSON.stringify(noId)), 'list_projects before register → NO_IDENTITY');

  await b.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'browsing' } });
  const listed = await b.callTool({ name: 'list_projects', arguments: {} });
  ok(listed.isError !== true, 'list_projects succeeds for a non-member identity');
  const projects = parse(listed).projects ?? [];
  ok(projects.length === 2, `bob (member of nothing) sees both projects (got ${projects.length})`);
  ok(
    projects[0]?.project_id === 'zephyr-board' && projects[1]?.project_id === 'alpha-board',
    `ordered by announcement seq, NOT alphabetically (got [${projects.map((p) => p.project_id).join(', ')}])`,
  );
  ok(projects[0]?.announcer === 'alice', 'directory entry carries the announcer (alice)');
  ok(projects[1]?.description === 'second', 'directory entry carries the description');
  await b.close();
} finally {
  for (const c of [a, b]) { try { await c?.close(); } catch { /* noop */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
