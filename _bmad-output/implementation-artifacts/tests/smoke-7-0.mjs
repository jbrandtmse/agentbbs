// Lead per-story smoke for Story 7.0 (ratify the MCP tool contract).
// Drives the REAL stdio binary: its advertised tools/list MUST equal the 17-tool surface the
// ratified docs/mcp-tool-contract.md pins (cross-checks the doc's machine-readable list AND
// the real running server, not just the in-process McpServer the drift test uses).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-7-0.mjs

import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-7-0-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

// Parse the contract's sentinel-delimited canonical tool-name list.
const doc = readFileSync(join(process.cwd(), 'docs/mcp-tool-contract.md'), 'utf8');
const begin = doc.indexOf('AGENTBBS-TOOL-CONTRACT:BEGIN');
const end = doc.indexOf('AGENTBBS-TOOL-CONTRACT:END');
const documented = doc.slice(begin, end).split('\n').map((l) => l.trim())
  .filter((l) => /^[a-z_]+$/.test(l));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-7-0', version: '0.0.0' });

try {
  await client.connect(transport);
  const advertised = (await client.listTools()).tools.map((t) => t.name).sort();

  ok(documented.length === 17, `the contract doc's canonical list has 17 tools (got ${documented.length})`);
  ok(advertised.length === 17, `the REAL stdio binary advertises 17 tools (got ${advertised.length})`);

  const docSet = new Set(documented);
  const advSet = new Set(advertised);
  const missingFromBinary = documented.filter((t) => !advSet.has(t));
  const undocumented = advertised.filter((t) => !docSet.has(t));
  ok(missingFromBinary.length === 0, `every documented tool is advertised by the real binary (missing: ${JSON.stringify(missingFromBinary)})`);
  ok(undocumented.length === 0, `every advertised tool is in the contract (undocumented: ${JSON.stringify(undocumented)})`);

  // Spot-check a few specific tools are present (the full negotiation loop + discovery).
  for (const t of ['register', 'post_announcement', 'reply', 'react', 'read_contract', 'check']) {
    ok(advSet.has(t), `key tool advertised: ${t}`);
  }

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
