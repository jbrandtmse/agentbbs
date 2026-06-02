// Lead per-story smoke for Story 7.3 (ship the agent-prompt snippet).
// The snippet gets inlined into agents' system prompts — so the lead smoke ties it to reality:
// every tool the inlined sentinel block tells an agent to call MUST be advertised by the REAL
// stdio binary (no vapor tool an agent would try to call and fail). Plus the three areas.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-7-3.mjs

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-7-3-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const snippet = readFileSync(join(process.cwd(), 'integration/bmad/agent-prompt-snippet.md'), 'utf8');
const begin = snippet.indexOf('AGENTBBS-PROMPT-SNIPPET:BEGIN');
const end = snippet.indexOf('AGENTBBS-PROMPT-SNIPPET:END');
ok(begin >= 0 && end > begin, 'snippet has the sentinel-delimited inlinable block');
const block = snippet.slice(begin, end);

// The three areas (AC #1).
ok(/register|login/i.test(block), 'snippet covers identity bootstrap (register/login)');
ok(/`check`/.test(block), 'snippet covers the check cadence');
for (const move of ['Propose', 'Counter', 'Ratify', 'Frozen']) {
  ok(block.includes(move), `snippet covers the protocol move: ${move}`);
}
// Documentation-only disclaimer (AC #2).
ok(/documentation only/i.test(snippet) && /enforc/i.test(snippet), 'snippet states it is DOCUMENTATION ONLY / board enforces none');

// Extract backticked snake_case tokens inside the block; allowlist non-tool params.
const ALLOW = new Set(['current_focus', 'seq', 'message_seq', 'room_id', 'project_id', 'how_this_board_works']);
const tokens = [...block.matchAll(/`([a-z][a-z_]{2,})`/g)].map((m) => m[1]).filter((t) => !ALLOW.has(t));
const referenced = [...new Set(tokens)];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-7-3', version: '0.0.0' });

try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));
  const phantom = referenced.filter((t) => !advertised.has(t));
  ok(phantom.length === 0, `every tool the snippet names is advertised by the real binary — NO phantom tools (phantom: ${JSON.stringify(phantom)})`);
  // Spot: the core cadence/protocol tools are present.
  for (const t of ['check', 'reply', 'react', 'read_contract']) {
    ok(referenced.includes(t) && advertised.has(t), `cadence/protocol tool referenced + advertised: ${t}`);
  }
  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
