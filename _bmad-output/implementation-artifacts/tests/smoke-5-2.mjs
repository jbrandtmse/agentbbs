// Lead per-story smoke for Story 5.2 (react / un-react 👍).
// Drives the REAL stdio binary: two participants react the same message and one retracts,
// observed via read_room reactions: [cleo] → [cleo,bob] → [cleo] (bob's retraction leaves
// cleo's 👍 intact). Plus MESSAGE_NOT_FOUND + NOT_A_MEMBER over the real binary.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-5-2.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-5-2-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-5-2', version: '0.0.0' });
const call = (name, args) => client.callTool({ name, arguments: args });
const reactionsOnMsg1 = async () => {
  const h = parse(await call('read_room', { room_id: 'need-help' }));
  return h.messages[0].reactions; // message #1 (the announcement)
};

try {
  await client.connect(transport);
  await call('register', { handle: 'alice', current_focus: 'x' });
  await call('announce_project', { title: 'Calling Interface', description: 'd' });
  await call('post_announcement', { project_id: 'calling-interface', subject: 'Need Help', body: 'seed' });
  await call('register', { handle: 'bob', current_focus: 'x' });
  await call('reply', { room_id: 'need-help', body: 'bob in' });   // bob participates
  await call('register', { handle: 'cleo', current_focus: 'x' });
  await call('reply', { room_id: 'need-help', body: 'cleo in' });  // cleo participates (session = cleo)

  // message #1 = the announcement; capture its seq.
  const h0 = parse(await call('read_room', { room_id: 'need-help' }));
  const msg1Seq = h0.messages[0].seq;
  ok(h0.messages[0].kind === 'announcement', 'message #1 is the announcement');
  ok(Array.isArray(h0.messages[0].reactions) && h0.messages[0].reactions.length === 0, 'message #1 starts with reactions: [] (default)');

  // cleo (current session) reacts message #1.
  await call('react', { message_seq: msg1Seq });
  ok(JSON.stringify(await reactionsOnMsg1()) === JSON.stringify(['cleo']), 'after cleo reacts → reactions [cleo]');

  // login bob; bob reacts the same message.
  await call('login', { handle: 'bob' });
  await call('react', { message_seq: msg1Seq });
  const both = await reactionsOnMsg1();
  ok(both.includes('cleo') && both.includes('bob') && both.length === 2, `after bob reacts → reactions [cleo, bob] (got ${JSON.stringify(both)})`);

  // bob retracts; cleo's 👍 stays live.
  await call('unreact', { message_seq: msg1Seq });
  ok(JSON.stringify(await reactionsOnMsg1()) === JSON.stringify(['cleo']), 'after bob un-reacts → reactions [cleo] (bob gone, cleo INTACT — cannot retract another\'s 👍)');

  // Idempotent: bob un-reacts again (no live 👍) → no-op, no error.
  const reUn = await call('unreact', { message_seq: msg1Seq });
  ok(reUn.isError !== true, 'bob un-react again is an idempotent no-op (no error)');

  // MESSAGE_NOT_FOUND: react a non-message seq.
  const noMsg = await call('react', { message_seq: 999999 });
  ok(noMsg.isError === true && /MESSAGE_NOT_FOUND/.test(JSON.stringify(noMsg)), 'react to a non-message seq → MESSAGE_NOT_FOUND');

  // NOT_A_MEMBER: a registered non-participant reacts.
  await call('register', { handle: 'dave', current_focus: 'lurking' });
  const notMember = await call('react', { message_seq: msg1Seq });
  ok(notMember.isError === true && /NOT_A_MEMBER/.test(JSON.stringify(notMember)), 'non-participant react → NOT_A_MEMBER');

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
