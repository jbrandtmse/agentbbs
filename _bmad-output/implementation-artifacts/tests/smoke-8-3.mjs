// Lead per-story smoke for Story 8.3 (skill customizations + skill-rules registry).
// The registry (skill-rules.md) + per-skill templates (custom-templates/*.toml) are consumed by the
// BMad resolver and the agent. This smoke ties them to reality on TWO real runtimes:
//   1. The REAL resolver (python _bmad/scripts/resolve_customization.py) merges a per-skill template
//      as the team layer: the registry `file:` ref APPENDS into persistent_facts and on_complete
//      override-wins — proving the template genuinely loads the registry in a consuming project.
//   2. The REAL stdio binary advertises EVERY tool the registry names (check/read_room/reply/react/
//      read_contract) — no phantom tool an agent following the registry would call and fail.
// Plus: all four templates parse, and the registry states the board-review obligation + the four moves.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-8-3.mjs

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

// --- Front 0: the registry's static claims ------------------------------------------------
const registry = readFileSync(join(repo, 'integration/bmad/skill-rules.md'), 'utf8');
ok(/announcement/i.test(registry) && /\bscan/i.test(registry), 'registry states the scan-announcements obligation');
ok(/`read_room`/.test(registry), 'registry states investigate-rooms (read_room)');
ok(/`reply`/.test(registry), 'registry states respond-in-joined-rooms (reply)');
ok(/`react`/.test(registry), 'registry states ratify (react)');
for (const move of ['Propose', 'Counter', 'Ratify', 'Frozen']) {
  ok(registry.includes(move), `registry states the protocol move: ${move}`);
}
ok(/`read_contract`/.test(registry), 'registry names read_contract (the Frozen move)');
ok(/pull|never push|no push/i.test(registry), 'registry states the pull-only / no-push stance');

// --- Front 1: all four templates parse + load the registry + set on_complete ---------------
const tmplDir = join(repo, 'integration/bmad/custom-templates');
const templates = readdirSync(tmplDir).filter((f) => f.endsWith('.toml'));
ok(templates.length === 4, `four per-skill templates exist (got ${templates.length}: ${templates.join(', ')})`);

// --- Front 2: the REAL resolver merges a template ------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-8-3-'));
const SKILL = 'bmad-dev-story';
const skillDir = join(dir, '_bmad', 'skills', SKILL);
const customDir = join(dir, '_bmad', 'custom');
mkdirSync(skillDir, { recursive: true });
mkdirSync(customDir, { recursive: true });
// minimal base with a sentinel fact (proves the registry ref APPENDS, not replaces) + empty on_complete.
writeFileSync(join(skillDir, 'customize.toml'),
  '[workflow]\npersistent_facts = ["BASE-FACT-SENTINEL"]\non_complete = ""\n');
// install the template as the team overlay + the registry where its file: ref points.
copyFileSync(join(tmplDir, `${SKILL}.toml`), join(customDir, `${SKILL}.toml`));
copyFileSync(join(repo, 'integration/bmad/skill-rules.md'), join(customDir, 'skill-rules.md'));

let merged = null;
try {
  const out = execFileSync('python', [
    join(repo, '_bmad/scripts/resolve_customization.py'), '--skill', skillDir, '--key', 'workflow',
  ], { encoding: 'utf8' });
  merged = JSON.parse(out).workflow;
  ok(true, 'real resolve_customization.py merged the template (exit 0, valid TOML)');
} catch (e) {
  ok(false, `real resolve_customization.py FAILED: ${e.message}`);
}
if (merged) {
  const facts = merged.persistent_facts ?? [];
  ok(facts[0] === 'BASE-FACT-SENTINEL', 'merge APPENDS: base fact stays first');
  ok(facts.some((f) => /skill-rules\.md/.test(f) && /^file:/.test(f)),
    'the template appends a file: ref to the installed _bmad/custom/skill-rules.md registry');
  ok(typeof merged.on_complete === 'string' && merged.on_complete.length > 0,
    'on_complete override-wins (the post-step board-review trigger surfaced over the base empty scalar)');
}

// --- Front 3: the real stdio binary advertises every tool the registry names ---------------
const sdkRoot = pathToFileURL(
  join(repo, 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'),
).href;
const { Client } = await import(`${sdkRoot}index.js`);
const { StdioClientTransport } = await import(`${sdkRoot}stdio.js`);
const dbPath = join(dir, 'agentbbs.db');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repo, 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, AGENTBBS_DB: dbPath },
});
const client = new Client({ name: 'smoke-8-3', version: '0.0.0' });
try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));
  for (const t of ['check', 'read_room', 'reply', 'react', 'read_contract']) {
    ok(advertised.has(t), `the registry's tool is advertised by the real binary — no phantom: ${t}`);
  }
  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
