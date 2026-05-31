// Lead per-story smoke for Story 4.2 (list_announcements + list_rooms).
// Drives the REAL stdio MCP server. Phase 1: post two announcements (proto-rooms),
// assert list_announcements returns both + list_rooms is empty + open-read for a
// non-member + BOARD_NOT_FOUND. Then seed ONE activating room.replied directly via the
// DataAccess port (the reply TOOL is Story 4.3). Phase 2: a fresh server/session asserts
// the proto/activated SPLIT — list_announcements drops the activated room, list_rooms
// returns it. Strongest evidence tier (real production binary).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-4-2.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-4-2-'));
const dbPath = join(dir, 'agentbbs.db');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};
const parse = (res) => (res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? '{}'));
const newClient = (name) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
    env: { ...process.env, AGENTBBS_DB: dbPath },
  });
  return { transport, client: new Client({ name, version: '0.0.0' }) };
};

try {
  // === Phase 1: post two proto-rooms, browse them over the real binary ===
  const s1 = newClient('smoke-4-2-p1');
  await s1.client.connect(s1.transport);

  const tools = (await s1.client.listTools()).tools.map((t) => t.name);
  ok(tools.includes('list_announcements'), 'list_announcements advertised');
  ok(tools.includes('list_rooms'), 'list_rooms advertised');

  await s1.client.callTool({ name: 'register', arguments: { handle: 'scout', current_focus: 'booting' } });
  await s1.client.callTool({
    name: 'announce_project',
    arguments: { title: 'Calling Interface', description: 'design the calling interface' },
  });
  await s1.client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'calling-interface', subject: 'Need a Reviewer', body: 'review the PR' },
  });
  await s1.client.callTool({
    name: 'post_announcement',
    arguments: { project_id: 'calling-interface', subject: 'Need a Tester', body: 'test the build' },
  });

  const annP1 = parse(await s1.client.callTool({ name: 'list_announcements', arguments: { project_id: 'calling-interface' } }));
  ok(annP1.announcements?.length === 2, `list_announcements returns 2 proto-rooms (got ${annP1.announcements?.length})`);
  ok(annP1.announcements?.every((r) => r.active === false), 'all listed announcements are proto (active=false)');
  ok(annP1.announcements?.[0]?.seq < annP1.announcements?.[1]?.seq, 'announcements ordered by seq');

  const roomsP1 = parse(await s1.client.callTool({ name: 'list_rooms', arguments: { project_id: 'calling-interface' } }));
  ok(roomsP1.rooms?.length === 0, `list_rooms empty before any activation (got ${roomsP1.rooms?.length})`);

  // BOARD_NOT_FOUND for an unknown board.
  const noBoard = await s1.client.callTool({ name: 'list_announcements', arguments: { project_id: 'no-such-board' } });
  ok(noBoard.isError === true && /BOARD_NOT_FOUND/.test(JSON.stringify(noBoard)), 'list on unknown board → BOARD_NOT_FOUND');

  // Open read (FR9): a non-member identity sees the same listing.
  await s1.client.callTool({ name: 'register', arguments: { handle: 'outsider', current_focus: 'lurking' } });
  const annOutsider = parse(await s1.client.callTool({ name: 'list_announcements', arguments: { project_id: 'calling-interface' } }));
  ok(annOutsider.announcements?.length === 2, 'non-member sees the full announcement listing (open read, FR9)');

  await s1.client.close();

  // === Seed an activating reply for "need-a-reviewer" directly via the port (reply tool is 4.3) ===
  const da = createDataAccess({ dbPath });
  try {
    await da.append([{ type: 'room.replied', actor: 'scout', payload: { roomId: 'need-a-reviewer', body: 'on it' } }]);
  } finally {
    da.close();
  }

  // === Phase 2: fresh server/session — the split is now visible ===
  const s2 = newClient('smoke-4-2-p2');
  await s2.client.connect(s2.transport);
  await s2.client.callTool({ name: 'register', arguments: { handle: 'reader', current_focus: 'browsing' } });

  const annP2 = parse(await s2.client.callTool({ name: 'list_announcements', arguments: { project_id: 'calling-interface' } }));
  ok(annP2.announcements?.length === 1, `after activation, list_announcements drops to 1 proto (got ${annP2.announcements?.length})`);
  ok(annP2.announcements?.[0]?.room_id === 'need-a-tester', 'the remaining proto-room is need-a-tester');

  const roomsP2 = parse(await s2.client.callTool({ name: 'list_rooms', arguments: { project_id: 'calling-interface' } }));
  ok(roomsP2.rooms?.length === 1, `after activation, list_rooms returns 1 active room (got ${roomsP2.rooms?.length})`);
  ok(roomsP2.rooms?.[0]?.room_id === 'need-a-reviewer' && roomsP2.rooms?.[0]?.active === true, 'the activated room is need-a-reviewer (active=true)');

  await s2.client.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
