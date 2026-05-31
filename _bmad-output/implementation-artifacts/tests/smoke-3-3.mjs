// Lead per-story smoke for Story 3.3 (join_board — single & multiple).
// Drives the REAL stdio MCP server across two sessions sharing one DB:
// alice announces X and Y; bob (not the announcer) joins BOTH → is a member of
// both; an unknown board → BOARD_NOT_FOUND (nothing appended); a re-join of X is
// idempotent (no second board.joined). Verified via list_projects AND out-of-band
// against the real SQLite ledger.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-3.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-3-'));
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
  a = await session('smoke-3-3-a');
  await a.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'seeding' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Project X', description: 'x board' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Project Y', description: 'y board' } });
  await a.close();

  b = await session('smoke-3-3-b');
  await b.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'joining' } });

  // Unknown board → BOARD_NOT_FOUND.
  const unknown = await b.callTool({ name: 'join_board', arguments: { project_id: 'no-such-board' } });
  ok(unknown.isError === true && /BOARD_NOT_FOUND/.test(JSON.stringify(unknown)), 'join unknown board → BOARD_NOT_FOUND');

  // Join X then Y.
  const jx = await b.callTool({ name: 'join_board', arguments: { project_id: 'project-x' } });
  ok(jx.isError !== true && (parse(jx).members ?? []).includes('bob'), 'bob joins project-x and appears as a member');
  const jy = await b.callTool({ name: 'join_board', arguments: { project_id: 'project-y' } });
  ok(jy.isError !== true && (parse(jy).members ?? []).includes('bob'), 'bob joins project-y and appears as a member');

  // Idempotent re-join of X.
  const rejoin = await b.callTool({ name: 'join_board', arguments: { project_id: 'project-x' } });
  ok(rejoin.isError !== true, 're-join of project-x succeeds (idempotent)');

  // Member of BOTH, via list_projects.
  const listed = parse(await b.callTool({ name: 'list_projects', arguments: {} })).projects ?? [];
  const x = listed.find((p) => p.project_id === 'project-x');
  const y = listed.find((p) => p.project_id === 'project-y');
  ok(x?.members?.includes('bob') && y?.members?.includes('bob'), 'bob is simultaneously a member of BOTH boards');
  ok(x?.members?.[0] === 'alice' && y?.members?.[0] === 'alice', 'announcer (alice) stays first member of each');
  await b.close();

  // Out-of-band: bob has exactly ONE board.joined per board (idempotent re-join added none).
  const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
  const { createDataAccess } = await import(daUrl);
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const joins = await da.eventsByType('board.joined');
    const bobX = joins.filter((e) => e.actor === 'bob' && e.payload?.projectId === 'project-x');
    ok(bobX.length === 1, `exactly one board.joined for bob@project-x despite the re-join (got ${bobX.length})`);
    const bobTotal = joins.filter((e) => e.actor === 'bob');
    ok(bobTotal.length === 2, `bob has exactly 2 board.joined total (x + y), not 3 (got ${bobTotal.length})`);
  } finally {
    da.close();
  }
} finally {
  for (const c of [a, b]) { try { await c?.close(); } catch { /* noop */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
