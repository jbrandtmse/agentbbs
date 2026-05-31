// Lead per-story smoke for Story 3.0 (Epic 2 Deferred Cleanup).
// Library/harness exercise (no new MCP tool): proves the guard-before-append
// hardening against a REAL SQLite ledger, out-of-band from the vitest suite.
//
// Run: node _bmad-output/implementation-artifacts/tests/smoke-3-0.mjs
// (imports the BUILT dist of @agentbbs/core + @agentbbs/data-access).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import built dist directly (smoke = production artifact, not the src alias).
const coreUrl = pathToFileURL(join(process.cwd(), 'packages/core/dist/index.js')).href;
const daUrl = pathToFileURL(join(process.cwd(), 'packages/data-access/dist/index.js')).href;
const { register, recordSeen, updateFocus } = await import(coreUrl);
const { createDataAccess } = await import(daUrl);

const dir = mkdtempSync(join(tmpdir(), 'agentbbs-smoke-3-0-'));
const dbPath = join(dir, 'board.sqlite');
const da = createDataAccess({ dbPath });

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

try {
  // --- Baseline: empty ledger ---
  ok((await da.maxSeq()) === 0, 'fresh ledger maxSeq === 0');

  // === (1) recordSeen on UNREGISTERED handle: throws, writes NO orphan ===
  let threw = false;
  try {
    await recordSeen(da, 'ghost-seen');
  } catch {
    threw = true;
  }
  ok(threw, 'recordSeen("ghost-seen") THROWS for an unregistered handle');
  ok((await da.maxSeq()) === 0, 'no orphan identity.seen written (maxSeq still 0)');
  ok((await da.eventsByType('identity.seen')).length === 0, 'zero identity.seen rows in ledger');

  // === (2) updateFocus on UNREGISTERED handle: throws, writes NO orphan ===
  threw = false;
  try {
    await updateFocus(da, 'ghost-focus', 'anything');
  } catch {
    threw = true;
  }
  ok(threw, 'updateFocus("ghost-focus") THROWS for an unregistered handle');
  ok((await da.maxSeq()) === 0, 'no orphan identity.focus_updated written (maxSeq still 0)');
  ok(
    (await da.eventsByType('identity.focus_updated')).length === 0,
    'zero identity.focus_updated rows in ledger',
  );

  // === (3) Happy path unchanged: register, then recordSeen / updateFocus ===
  const reg = await register(da, { handle: 'Scout', currentFocus: 'booting' });
  ok(reg.handle === 'scout', 'register canonicalizes handle to "scout"');
  const afterReg = await da.maxSeq();
  ok(afterReg === 1, 'register appended exactly one event (maxSeq 1)');

  const seen = await recordSeen(da, 'scout');
  ok((await da.maxSeq()) === 2, 'recordSeen appended exactly one identity.seen (maxSeq 2)');
  ok(seen.currentFocus === 'booting', 'recordSeen preserves currentFocus');
  ok(seen.lastSeen >= reg.lastSeen, 'recordSeen advances (non-regressing) lastSeen');

  const focused = await updateFocus(da, 'scout', 'reviewing PR #7');
  ok((await da.maxSeq()) === 3, 'updateFocus appended exactly one event (maxSeq 3)');
  ok(focused.currentFocus === 'reviewing PR #7', 'updateFocus sets the new currentFocus');

  // Append-only: the registered + seen rows are all retained.
  ok((await da.eventsByType('identity.registered')).length === 1, 'one identity.registered retained');
  ok((await da.eventsByType('identity.seen')).length === 1, 'one identity.seen retained');
  ok(
    (await da.eventsByType('identity.focus_updated')).length === 1,
    'one identity.focus_updated retained',
  );
} finally {
  da.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSMOKE PASS — all assertions green' : `\nSMOKE FAIL — ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
