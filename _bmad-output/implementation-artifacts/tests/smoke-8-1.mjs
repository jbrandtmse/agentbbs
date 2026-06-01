// Lead per-story smoke for Story 8.1 (identity-bootstrap workflow asset).
// The asset (integration/bmad/identity-bootstrap.md) tells an agent how to resolve its identity
// at project start. This smoke ties the asset to reality on TWO fronts, against the REAL stdio
// binary (out-of-band: a real Node subprocess speaking MCP over stdio):
//   1. Every tool the inlinable block names is actually advertised by the real binary (no phantom).
//   2. The three branches the asset prescribes are genuinely EXECUTABLE with the shipped tools:
//        a. no recorded handle  -> register(persona@project) succeeds
//        b. default handle taken -> HANDLE_TAKEN -> register(handle-2) succeeds  (disambiguation)
//        c. recorded -> login succeeds;  unknown recorded -> LOGIN_UNKNOWN  (fall-through is real)
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-8-1.mjs

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = pathToFileURL(
  join(process.cwd(), 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-8-1-'));
const dbPath = join(dir, 'agentbbs.db');
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));
// register/login surface board errors as an isError result whose payload carries { code }.
const errCode = (r) => { try { return parse(r)?.code ?? null; } catch { return null; } };

// --- Front 1: the asset's inlinable block (static) -----------------------------------------
const asset = readFileSync(join(process.cwd(), 'integration/bmad/identity-bootstrap.md'), 'utf8');
const begin = asset.indexOf('AGENTBBS-IDENTITY-BOOTSTRAP:BEGIN');
const end = asset.indexOf('AGENTBBS-IDENTITY-BOOTSTRAP:END');
ok(begin >= 0 && end > begin, 'asset has the sentinel-delimited inlinable block (8.4 can inline it)');
const block = asset.slice(begin, end);

// The three identity branches the asset prescribes.
ok(/`register`/.test(block), 'block prescribes register (no-handle branch)');
ok(/`login`/.test(block), 'block prescribes login (recorded branch)');
ok(block.includes('HANDLE_TAKEN'), 'block prescribes the HANDLE_TAKEN disambiguation branch');
ok(/AGENTBBS-IDENTITY(?!-BOOTSTRAP)/.test(block), 'block names the AGENTBBS-IDENTITY record block (8.4 owns only it)');
// Claim-based / no-secret / safe-to-commit (NFR7).
ok(/no secret|claim-based|safe to commit/i.test(block), 'block states claim-based / no-secret / safe-to-commit (NFR7)');

// Extract backticked tool-ish tokens (bare or call-form) inside the block; allowlist non-tool params.
const ALLOW = new Set(['current_focus', 'persona', 'project', 'handle']);
const tokens = [...block.matchAll(/`([a-z][a-z_]{2,})(?:`|\{)/g)].map((m) => m[1]).filter((t) => !ALLOW.has(t));
const referenced = [...new Set(tokens)];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-8-1', version: '0.0.0' });
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));

  // Front 1 (cont.): no phantom tools.
  const phantom = referenced.filter((t) => !advertised.has(t));
  ok(phantom.length === 0, `every tool the asset names is advertised by the real binary — NO phantom tools (phantom: ${JSON.stringify(phantom)})`);
  for (const t of ['register', 'login']) {
    ok(referenced.includes(t) && advertised.has(t), `identity tool referenced + advertised: ${t}`);
  }

  // --- Front 2: the three branches are EXECUTABLE against the real binary -------------------
  // (a) no recorded handle -> register the derived persona@project default succeeds.
  const HANDLE = 'amelia-dev@taskflow';
  const reg1 = parse(await call('register', { handle: HANDLE, current_focus: 'bootstrap' }));
  ok(reg1?.handle === HANDLE, `(a) no-handle branch: register("${HANDLE}") succeeds — the derived persona@project default is a legal handle (got handle="${reg1?.handle}")`);

  // (b) default handle taken -> HANDLE_TAKEN -> register(handle-2) succeeds.
  const dupCode = errCode(await call('register', { handle: HANDLE, current_focus: 'x' }));
  ok(dupCode === 'HANDLE_TAKEN', `(b) collision: re-register of the taken handle returns HANDLE_TAKEN (got "${dupCode}")`);
  const reg2 = parse(await call('register', { handle: `${HANDLE}-2`, current_focus: 'x' }));
  ok(reg2?.handle === `${HANDLE}-2`, `(b) disambiguation: register("${HANDLE}-2") succeeds — the discriminator strategy resolves the collision (got handle="${reg2?.handle}")`);

  // (c) recorded -> login succeeds; unknown recorded -> LOGIN_UNKNOWN.
  const login1 = parse(await call('login', { handle: HANDLE }));
  ok(login1?.handle === HANDLE, `(c) recorded branch: login("${HANDLE}") succeeds (got handle="${login1?.handle}")`);
  const unknownCode = errCode(await call('login', { handle: 'never-registered@nowhere' }));
  ok(unknownCode === 'LOGIN_UNKNOWN', `(c) fall-through: login of an unknown recorded handle returns LOGIN_UNKNOWN — the register-fallback branch is genuinely reachable (got "${unknownCode}")`);

  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
