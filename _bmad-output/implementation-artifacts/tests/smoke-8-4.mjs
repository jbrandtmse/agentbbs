// Lead per-story smoke for Story 8.4 (the self-contained installation kit — the Epic 8 capstone).
// The kit (install-agentbbs.md) WRITES files in a stranger's project, so this smoke exercises the
// kit's OWN extracted helper end-to-end against a temp project with PLANTED foreign assets, then
// proves the connection record the kit writes actually starts the real server. Five fronts:
//   0. Self-contained: the kit carries no network-fetch instruction.
//   1. Install: the kit's applyBlock + mergeMcpServer write the owned artifacts.
//   2. Idempotency: re-running identical content is a byte no-op (no new backup).
//   3. Backup + foreign-safety: a content change makes a timestamped backup + replaces ONLY the
//      owned block/key; a planted epic-cycle file + a foreign .mcp.json server + an unrelated key
//      survive BYTE-IDENTICAL.
//   4. Connection record is real: spawn the REAL dist/main.js with the kit's written .mcp.json
//      agentbbs command/args/env — it connects + advertises the tools the kit references.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-8-4.mjs

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-8-4-'));

// --- Front 0: the kit is self-contained ----------------------------------------------------
const kit = readFileSync(join(repo, 'integration/bmad/install-agentbbs.md'), 'utf8');
ok(!/\bcurl\b|\bwget\b|fetch\(|https?:\/\/[^\s)]*\/(raw|blob)/i.test(kit),
  'kit carries no network-fetch instruction (self-contained, no sibling files)');
ok(kit.includes('AGENTBBS-IDENTITY') && /mcpServers/.test(kit), 'kit inlines the identity block + the MCP connection record');

// Extract the kit's OWN helper: every ```js fenced block whose body has `export function`.
const jsBlocks = [...kit.matchAll(/```(?:js|javascript)\n([\s\S]*?)```/g)].map((m) => m[1]);
const helperSrc = jsBlocks.filter((b) => /export function/.test(b)).join('\n\n');
ok(/export function applyBlock/.test(helperSrc) && /export function mergeMcpServer/.test(helperSrc),
  'kit ships an inline helper exporting applyBlock + mergeMcpServer');
const helperPath = join(dir, 'apply-agentbbs.mjs');
writeFileSync(helperPath, helperSrc);
const { applyBlock, mergeMcpServer } = await import(pathToFileURL(helperPath).href);

// --- temp consuming project with PLANTED foreign assets ------------------------------------
const proj = join(dir, 'consumer');
const customDir = join(proj, '_bmad', 'custom');
mkdirSync(customDir, { recursive: true });
// a foreign epic-cycle kit file the install must NEVER touch
const epicCyclePath = join(proj, '_bmad', 'custom', 'epic-cycle-kit.md');
const epicCycleBytes = '# epic-cycle install kit\nDO NOT TOUCH — foreign asset.\n';
writeFileSync(epicCyclePath, epicCycleBytes);
// a .mcp.json with a FOREIGN server + an unrelated top-level key
const mcpPath = join(proj, '.mcp.json');
writeFileSync(mcpPath, JSON.stringify({ mcpServers: { 'other-server': { command: 'other', args: [] } }, unrelatedKey: 'keep-me' }, null, 2) + '\n');
const agentsPath = join(proj, 'AGENTS.md');
writeFileSync(agentsPath, '# AGENTS\nProject agent notes.\n');

const serverCfg = { command: 'node', args: [join(repo, 'packages/mcp-server/dist/main.js')], env: { AGENTBBS_DB: join(dir, 'consumer.db') } };
const ID_BEGIN = '<!-- AGENTBBS-IDENTITY:BEGIN -->';
const ID_END = '<!-- AGENTBBS-IDENTITY:END -->';
const install = (handle) => {
  applyBlock(join(customDir, 'skill-rules.md'), '<!-- AGENTBBS-SKILL-RULES:BEGIN -->', '<!-- AGENTBBS-SKILL-RULES:END -->',
    readFileSync(join(repo, 'integration/bmad/skill-rules.md'), 'utf8'));
  applyBlock(agentsPath, ID_BEGIN, ID_END, `handle: ${handle}`); // blockContent is the INNER content; applyBlock adds the markers
  mergeMcpServer(mcpPath, 'agentbbs', serverCfg);
};
const snapshot = () => {
  const files = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name); e.isDirectory() ? walk(p) : (files[p] = readFileSync(p)); } };
  walk(proj);
  return files;
};
const countBackups = () => { const b = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name); e.isDirectory() ? walk(p) : (/\.agentbbs-bak-/.test(e.name) && b.push(p)); } }; walk(proj); return b.length; };

// --- Front 1: install --------------------------------------------------------------------
install('amelia-dev@consumer');
ok(readFileSync(join(customDir, 'skill-rules.md'), 'utf8').includes('Negotiation Protocol'), 'install wrote the skill-rules registry');
ok(readFileSync(agentsPath, 'utf8').includes('handle: amelia-dev@consumer'), 'install wrote the AGENTS.md AGENTBBS-IDENTITY handle');
const mcpDoc = JSON.parse(readFileSync(mcpPath, 'utf8'));
ok(mcpDoc.mcpServers.agentbbs?.command === 'node', 'install wrote the agentbbs MCP server record');

// --- Front 2: idempotency (byte no-op on identical re-run, no new backup) -----------------
const before = snapshot();
const baksBefore = countBackups();
install('amelia-dev@consumer'); // identical
const after = snapshot();
const changed = Object.keys(after).filter((p) => !before[p] || !after[p].equals(before[p]));
ok(changed.length === 0, `idempotent: identical re-run is a byte no-op (changed files: ${JSON.stringify(changed.map((p) => p.replace(proj, '.')))})`);
ok(countBackups() === baksBefore, 'idempotent re-run makes NO new backup');

// --- Front 3: backup-before-overwrite + foreign-safety ------------------------------------
install('amelia-dev@consumer-2'); // changes the identity block only
ok(readFileSync(agentsPath, 'utf8').includes('handle: amelia-dev@consumer-2'), 'a content change is applied to the owned block');
ok(countBackups() > baksBefore, 'a real content change makes a timestamped backup BEFORE overwrite');
ok(readFileSync(epicCyclePath) .equals(Buffer.from(epicCycleBytes)), 'NEVER-TOUCH-FOREIGN: the planted epic-cycle kit file is byte-identical');
const mcpAfter = JSON.parse(readFileSync(mcpPath, 'utf8'));
ok(mcpAfter.mcpServers['other-server']?.command === 'other', 'foreign .mcp.json server preserved');
ok(mcpAfter.unrelatedKey === 'keep-me', 'unrelated .mcp.json top-level key preserved');

// --- Front 4: the written connection record actually starts the real server ----------------
const rec = mcpAfter.mcpServers.agentbbs;
const sdkRoot = pathToFileURL(join(repo, 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/')).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);
const transport = new StdioClientTransport({ command: rec.command === 'node' ? process.execPath : rec.command, args: rec.args, env: { ...process.env, ...rec.env } });
const client = new Client({ name: 'smoke-8-4', version: '0.0.0' });
try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));
  ok(advertised.size > 0, 'the kit-written connection record STARTS the real server + it advertises tools');
  for (const t of ['register', 'login', 'check', 'read_room', 'reply', 'react', 'read_contract', 'unreact']) {
    ok(advertised.has(t), `connection record's server advertises the kit-referenced tool: ${t}`);
  }
  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
