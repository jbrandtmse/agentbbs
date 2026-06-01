// Lead per-story smoke for Story 5.0 (Epic 4 deferred cleanup — room-tool input validation).
// Test-hardening story: the deliverable is the boundary-rejection coverage. The smoke drives
// the REAL stdio binary to confirm a malformed room_id is rejected at the Zod boundary with
// NOTHING appended (the behavior the new tests pin).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-5-0.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);
const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
const { createDataAccess } = await import(daUrl);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-5-0-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-5-0', version: '0.0.0' });

try {
  await client.connect(transport);
  await client.callTool({ name: 'register', arguments: { handle: 'alice', current_focus: 'x' } });
  await client.callTool({ name: 'announce_project', arguments: { title: 'Calling Interface', description: 'd' } });
  await client.callTool({ name: 'post_announcement', arguments: { project_id: 'calling-interface', subject: 'Need Help', body: 'b' } });
  await client.callTool({ name: 'reply', arguments: { room_id: 'need-help', body: 'a valid reply' } }); // room.replied = 1

  // Malformed room_id at the Zod boundary → isError, nothing appended.
  for (const bad of ['', '   ', 'Bad Room!', 'UPPER']) {
    const r = await client.callTool({ name: 'reply', arguments: { room_id: bad, body: 'should reject' } });
    ok(r.isError === true, `reply with malformed room_id ${JSON.stringify(bad)} → isError (Zod boundary)`);
  }
  // Malformed handle on add_participant → isError.
  const ap = await client.callTool({ name: 'add_participant', arguments: { room_id: 'need-help', handle: 'Bad Handle!' } });
  ok(ap.isError === true, 'add_participant with malformed handle → isError (Zod boundary)');

  await client.close();

  const da = createDataAccess({ dbPath, readonly: true });
  try {
    const replied = await da.eventsByType('room.replied');
    const added = await da.eventsByType('room.participant_added');
    ok(replied.length === 1, `exactly ONE room.replied — the malformed replies appended nothing (got ${replied.length})`);
    ok(added.length === 0, `ZERO room.participant_added — the malformed add appended nothing (got ${added.length})`);
  } finally { da.close(); }
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
