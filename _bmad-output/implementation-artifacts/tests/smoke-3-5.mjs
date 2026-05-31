// Lead per-story smoke for Story 3.5 (board-wide read + join-to-post gate).
// Two parts, both against real artifacts:
//  (A) READ-OPEN over the REAL stdio MCP server: a non-member identity reads
//      list_projects AND list_members successfully (FR9).
//  (B) The membership WRITE-GATE primitive (core, built dist) against the same
//      real SQLite ledger: announcer authorized; non-member → NOT_A_MEMBER;
//      unknown board → BOARD_NOT_FOUND; a real join flips NOT_A_MEMBER → authorized.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-5.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-5-'));
const dbPath = join(dir, 'agentbbs.db');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

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
  // Seed: alice announces a board; bob is a registered member of NOTHING.
  a = await session('smoke-3-5-a');
  await a.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'seeding' } });
  await a.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'the board' } });
  await a.close();

  b = await session('smoke-3-5-b');
  await b.callTool({ name: 'register', arguments: { handle: 'bob', current_focus: 'browsing' } });

  // (A) READ-OPEN — bob (member of nothing) reads both surfaces.
  const lp = await b.callTool({ name: 'list_projects', arguments: {} });
  ok(lp.isError !== true, 'FR9: non-member reads list_projects');
  const lm = await b.callTool({ name: 'list_members', arguments: { project_id: 'calling-interface' } });
  ok(lm.isError !== true, 'FR9: non-member reads list_members');
  await b.close();

  // (B) THE GATE — requireMembership/isMember against the real ledger.
  const coreUrl = pathToFileURL(join(process.cwd(), 'packages/core/dist/index.js')).href;
  const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
  const { requireMembership, isMember, findProject } = await import(coreUrl);
  const { createDataAccess } = await import(daUrl);

  const da = createDataAccess({ dbPath });
  try {
    // Announcer (alice) is auto-member → authorized (no throw).
    let threw = false;
    try { await requireMembership(da, 'alice', 'calling-interface'); } catch { threw = true; }
    ok(!threw, 'gate authorizes the announcer (alice, auto-joined)');

    // Non-member (bob) → NOT_A_MEMBER.
    let code = null;
    try { await requireMembership(da, 'bob', 'calling-interface'); } catch (e) { code = e?.code; }
    ok(code === 'NOT_A_MEMBER', `gate rejects a non-member with NOT_A_MEMBER (got ${code})`);

    // Unknown board → BOARD_NOT_FOUND (distinct from NOT_A_MEMBER).
    code = null;
    try { await requireMembership(da, 'bob', 'no-such-board'); } catch (e) { code = e?.code; }
    ok(code === 'BOARD_NOT_FOUND', `gate rejects an unknown board with BOARD_NOT_FOUND (got ${code})`);

    // Pure predicate agrees with the ledger.
    const events = await da.eventsSince(0);
    const proj = findProject(events, 'calling-interface');
    ok(isMember(proj, 'alice') === true && isMember(proj, 'bob') === false, 'isMember agrees with real membership state');
  } finally {
    da.close();
  }
} finally {
  for (const c of [a, b]) { try { await c?.close(); } catch { /* noop */ } }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
