// Lead per-story smoke for Story 7.1 (document the Negotiation Protocol).
// The protocol maps four moves onto four SHIPPED tools — so the lead smoke ties the doc to
// reality: the doc exists + names the four moves, AND the four tools it references
// (reply / react / unreact / read_contract) are actually advertised by the REAL stdio binary.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-7-1.mjs

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-7-1-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const doc = readFileSync(join(process.cwd(), 'docs/negotiation-protocol.md'), 'utf8');
for (const move of ['Propose', 'Counter', 'Ratify', 'Frozen']) {
  ok(doc.includes(move), `protocol doc states the move: ${move}`);
}
ok(/convention/i.test(doc) && /enforc/i.test(doc), 'protocol doc states it is a CONVENTION the board does not enforce');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-7-1', version: '0.0.0' });

try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));
  // The four protocol tools must be real (the protocol references shipped tools, not vapor).
  for (const tool of ['reply', 'react', 'unreact', 'read_contract']) {
    ok(advertised.has(tool), `protocol move tool is advertised by the real binary: ${tool}`);
    ok(doc.includes(`\`${tool}\``) || doc.includes(tool), `protocol doc references the ${tool} tool`);
  }
  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
