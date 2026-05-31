// Lead per-story smoke for Story 3.1 (announce_project + sub-board).
// Drives the REAL stdio MCP server (the exact production path an agent host uses):
// spawns `node packages/mcp-server/dist/main.js` over StdioClientTransport, with
// AGENTBBS_DB pointed at a throwaway temp ledger. Asserts the user-observable tool
// results AND the out-of-band ledger state (real SQLite).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-1.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve the MCP SDK from the mcp-server package's node_modules (pnpm does not
// hoist it to a node_modules ancestor of this artifacts dir).
const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-1-'));
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
const client = new Client({ name: 'smoke-3-1', version: '0.0.0' });

try {
  await client.connect(transport);

  // Tool is advertised with snake_case params (discovery surface).
  const tools = (await client.listTools()).tools.map((t) => t.name);
  ok(tools.includes('announce_project'), 'announce_project advertised in tools/list');

  // No identity yet → NO_IDENTITY (session precondition).
  const noId = await client.callTool({
    name: 'announce_project',
    arguments: { title: 'Premature', description: 'before register' },
  });
  ok(noId.isError === true && /NO_IDENTITY/.test(JSON.stringify(noId)), 'announce before register → NO_IDENTITY');

  // Establish identity.
  await client.callTool({ name: 'register', arguments: { handle: 'scout', current_focus: 'booting' } });

  // Announce a project.
  const a = await client.callTool({
    name: 'announce_project',
    arguments: { title: 'Calling Interface', description: 'design the calling interface' },
  });
  ok(a.isError !== true, 'first announce_project succeeds');
  const proj = parse(a);
  ok(proj.project_id === 'calling-interface', `slug derived from title → "calling-interface" (got "${proj.project_id}")`);
  ok(proj.announcer === 'scout', 'announcer recorded as the session identity');

  // Duplicate title → PROJECT_EXISTS.
  const dup = await client.callTool({
    name: 'announce_project',
    arguments: { title: 'Calling Interface', description: 'a clashing second announce' },
  });
  ok(dup.isError === true && /PROJECT_EXISTS/.test(JSON.stringify(dup)), 'duplicate title → PROJECT_EXISTS');

  // Invalid input (empty title) → rejected before core.
  const bad = await client.callTool({ name: 'announce_project', arguments: { title: '', description: 'x' } });
  ok(bad.isError === true, 'empty title rejected (invalid input)');

  await client.close();

  // === Out-of-band ledger assertions (real SQLite, after the server closed) ===
  const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
  const { createDataAccess } = await import(daUrl);
  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const announced = await da.eventsByType('project.announced');
    const joined = await da.eventsByType('board.joined');
    ok(announced.length === 1, `exactly one project.announced in ledger (got ${announced.length})`);
    ok(joined.length === 1, `exactly one board.joined (announcer first member) in ledger (got ${joined.length})`);
    ok(announced[0]?.payload?.projectId === 'calling-interface', 'stored project.announced payload carries the slug');
    ok(joined[0]?.actor === 'scout', 'board.joined attributed to the announcer');
  } finally {
    da.close();
  }
} finally {
  try { await client.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
