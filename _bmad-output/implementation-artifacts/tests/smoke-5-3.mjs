// Lead per-story smoke for Story 5.3 (compute the current agreed contract, FR21).
// Drives the REAL stdio binary: the contract = the highest-seq live-👍'd message, computed
// by query, reverting on retraction: 👍M1→M1, 👍M2→M2, retract M2→M1, retract M1→null.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-5-3.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-5-3-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-5-3', version: '0.0.0' });
const call = (n, a) => client.callTool({ name: n, arguments: a });
const contract = async () => parse(await call('read_contract', { room_id: 'need-help' })).contract;

try {
  await client.connect(transport);
  ok((await client.listTools()).tools.map((t) => t.name).includes('read_contract'), 'read_contract advertised');

  await call('register', { handle: 'alice', current_focus: 'x' });
  await call('announce_project', { title: 'Calling Interface', description: 'd' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Need Help', body: 'PROPOSAL A (the announcement)' });
  await call('register', { handle: 'bob', current_focus: 'x' });
  await call('reply', { room_id: 'need-help', body: 'PROPOSAL B (a counter)' });  // bob participates; session = bob

  const h = parse(await call('read_room', { room_id: 'need-help' }));
  const m1 = h.messages[0].seq; // announcement (Proposal A)
  const m2 = h.messages[1].seq; // bob's reply (Proposal B)
  ok(m1 < m2, 'M1 (announcement) has a lower seq than M2 (reply)');

  // No reactions yet → no contract.
  ok((await contract()) === null, 'no live 👍 yet → contract is null ("no contract yet")');

  // bob 👍 M1 → contract = M1.
  await call('react', { message_seq: m1 });
  ok((await contract())?.seq === m1, 'after 👍 M1 → contract is M1 (Proposal A)');

  // bob 👍 M2 → contract = M2 (highest-seq live-👍 wins).
  await call('react', { message_seq: m2 });
  const c2 = await contract();
  ok(c2?.seq === m2 && c2?.body === 'PROPOSAL B (a counter)', 'after 👍 M2 → contract is M2 (higher seq wins; returns the agreed BODY)');

  // retract M2's 👍 → contract REVERTS to M1.
  await call('unreact', { message_seq: m2 });
  ok((await contract())?.seq === m1, 'after retracting M2 → contract REVERTS to M1 (Proposal A still live-👍\'d)');

  // retract M1's 👍 → no contract.
  await call('unreact', { message_seq: m1 });
  ok((await contract()) === null, 'after retracting M1 → contract is null again (no live 👍 anywhere)');

  // Open read by a non-member; unknown room → ROOM_NOT_FOUND.
  await call('register', { handle: 'reader', current_focus: 'lurking' });
  const openRead = await call('read_contract', { room_id: 'need-help' });
  ok(openRead.isError !== true, 'a non-member can read_contract (open read, FR9)');
  const noRoom = await call('read_contract', { room_id: 'no-such-room' });
  ok(noRoom.isError === true && /ROOM_NOT_FOUND/.test(JSON.stringify(noRoom)), 'unknown room → ROOM_NOT_FOUND (distinct from contract:null)');

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
