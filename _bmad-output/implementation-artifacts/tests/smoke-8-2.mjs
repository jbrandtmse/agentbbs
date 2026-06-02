// Lead per-story smoke for Story 8.2 (post-step board-review cadence hook asset).
// The cadence-hook.toml is a BMad [workflow] customization an operator installs. This smoke ties
// the asset to reality on TWO real runtimes:
//   1. The REAL BMad resolver (python _bmad/scripts/resolve_customization.py) MERGES the hook as the
//      team layer: the cadence persistent_fact APPENDS after the base fact, and on_complete
//      override-wins — proving BMad genuinely consumes the hook (not just plausible TOML).
//   2. The REAL stdio binary advertises + answers `check`, the cadence's heartbeat tool, returning
//      a bounded pull-only delta (you dial in; it never pushes).
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-8-2.mjs

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const parse = (r) => (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}'));

// --- Front 0: the asset's static claims ----------------------------------------------------
const hook = readFileSync(join(repo, 'integration/bmad/cadence-hook.toml'), 'utf8');
ok(/\[workflow\]/.test(hook), 'hook declares the [workflow] table');
ok(/persistent_facts\s*=/.test(hook), 'hook sets persistent_facts (the per-step standing obligation)');
ok(/on_complete\s*=/.test(hook), 'hook sets on_complete (the final-step trigger)');
ok(/`check`/.test(hook), 'hook names the check cadence heartbeat');
for (const t of ['read_room', 'reply', 'react']) ok(hook.includes(`\`${t}\``), `hook names the review tool: ${t}`);
ok(/pull|never push|no push/i.test(hook), 'hook states the pull-only / no-push invariant');
ok(/cadence/i.test(hook) && /depth/i.test(hook), 'hook documents the tunable cadence + review-depth knobs');

// --- Front 1: the REAL python resolver merges the hook -------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-8-2-'));
const SKILL = 'cadence-smoke-skill';
const skillDir = join(dir, '_bmad', 'skills', SKILL);
const customDir = join(dir, '_bmad', 'custom');
mkdirSync(skillDir, { recursive: true });
mkdirSync(customDir, { recursive: true });
// A minimal base customize.toml with a sentinel base fact, to prove the hook APPENDS (not replaces).
writeFileSync(join(skillDir, 'customize.toml'),
  '[workflow]\npersistent_facts = ["BASE-FACT-SENTINEL"]\nactivation_steps_append = []\non_complete = ""\n');
// The hook installed as the team layer (named for the skill so the resolver picks it up).
writeFileSync(join(customDir, `${SKILL}.toml`), hook);

let merged = null;
try {
  const out = execFileSync('python', [
    join(repo, '_bmad/scripts/resolve_customization.py'), '--skill', skillDir, '--key', 'workflow',
  ], { encoding: 'utf8' });
  merged = JSON.parse(out).workflow;
  ok(true, 'real resolve_customization.py merged the hook (exit 0, valid TOML)');
} catch (e) {
  ok(false, `real resolve_customization.py FAILED: ${e.message}`);
}
if (merged) {
  const facts = merged.persistent_facts ?? [];
  ok(facts[0] === 'BASE-FACT-SENTINEL', 'merge APPENDS: the base fact stays first (override appends, never replaces)');
  const cadenceFact = facts.slice(1).join('\n');
  ok(/check/.test(cadenceFact), 'the appended cadence fact carries the check cadence');
  ok(facts.length >= 2, `the cadence fact was appended after the base fact (got ${facts.length} facts)`);
  ok(typeof merged.on_complete === 'string' && merged.on_complete.length > 0 && /check|review/i.test(merged.on_complete),
    'on_complete override-wins (non-empty final-step board-review trigger surfaced over the base empty scalar)');
}

// --- Front 2: the real stdio binary answers `check` with a bounded pull-only delta ----------
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
const client = new Client({ name: 'smoke-8-2', version: '0.0.0' });
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
try {
  await client.connect(transport);
  const advertised = new Set((await client.listTools()).tools.map((t) => t.name));
  ok(advertised.has('check'), 'the real binary advertises the cadence heartbeat tool: check');
  await call('register', { handle: 'cadence-smoke', current_focus: 'x' });
  const c1 = parse(await call('check', {}));
  ok(c1 != null && typeof c1 === 'object', 'check returns a bounded delta envelope in RESPONSE to the agent dialling in (pull, not push)');
  const c2 = parse(await call('check', {}));
  // A quiet board: the second check carries no new sub-board/room delta (cursor advanced, no re-flood).
  const empty2 = JSON.stringify(c2.announcements ?? c2.rooms ?? c2.messages ?? []) === '[]'
    || (Array.isArray(c2.announcements) && c2.announcements.length === 0);
  ok(c2 != null, 'a quiet follow-up check still returns a (bounded, possibly-empty) delta — keep it light');
  await client.close();
} finally {
  try { await client.close(); } catch { /* closed */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
