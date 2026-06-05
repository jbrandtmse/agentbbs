// Story 10.2, Task 1 — the GATING in-host probe (runs INSIDE the real VS Code
// 1.122.1 Extension Development Host via @vscode/test-electron).
//
// This module is the `extensionTestsPath` target: @vscode/test-electron launches the
// real Electron extension host and `require()`s this file, then calls its exported
// `run()`. So everything here executes in the GENUINE host runtime — the only place
// the load-bearing AC3 question can be answered: is `node:sqlite` exposed in VS Code
// 1.122.1's embedded Node/Electron, and what is the host ABI/electron version?
//
// It is CommonJS (.cjs) because the host loads `extensionTestsPath` via require().
// It is intentionally DEPENDENCY-FREE (only node builtins) so the GATE can run before
// any adapter exists — a clean probe. The result is written to a JSON file whose path
// the runner passes via AGENTBBS_PROBE_OUT (extensionTestsEnv), so the runner asserts
// the findings OUT-OF-BAND (Rule 12 — real-runtime evidence, never a green stub).

'use strict';

const fs = require('node:fs');

/**
 * The in-host probe. Records the real Electron host's versions + whether node:sqlite
 * is exposed and can open :memory: + SELECT sqlite_version(). Writes the result JSON
 * to AGENTBBS_PROBE_OUT. THROWS (failing the host run) if node:sqlite is absent OR
 * cannot run a trivial query — so an absent driver is a LOUD host-test failure, not a
 * silent pass. The runner reads the JSON regardless (it is written before any throw).
 */
async function run() {
  const out = process.env.AGENTBBS_PROBE_OUT;

  const result = {
    electron: process.versions.electron || null,
    modules: process.versions.modules || null,
    node: process.versions.node || null,
    nodeSqliteResolved: false,
    sqliteVersion: null,
    memoryOpenOk: false,
    error: null,
  };

  try {
    // Real require in the host: Electron CAN strip built-ins, so this is the actual
    // question. A computed specifier is unnecessary here (this is a runtime probe,
    // not a tsc target) — use the plain require so a genuine absence throws.
    const sqlite = require('node:sqlite');
    result.nodeSqliteResolved = typeof sqlite.DatabaseSync === 'function';

    if (result.nodeSqliteResolved) {
      const db = new sqlite.DatabaseSync(':memory:');
      try {
        const row = db.prepare('SELECT sqlite_version() AS v').get();
        result.sqliteVersion = row && typeof row.v === 'string' ? row.v : null;
        result.memoryOpenOk = typeof result.sqliteVersion === 'string';
      } finally {
        db.close();
      }
    }
  } catch (err) {
    result.error = err && err.message ? String(err.message) : String(err);
  }

  // Write the findings BEFORE any throw so the runner always has the evidence.
  if (out) {
    fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  }

  // Loud failure if the gate is not satisfied (absent / unusable node:sqlite).
  if (!result.nodeSqliteResolved || !result.memoryOpenOk) {
    throw new Error(
      `GATE FAILED: node:sqlite not usable in the Electron host — ` +
        `resolved=${result.nodeSqliteResolved} memoryOpenOk=${result.memoryOpenOk} ` +
        `error=${result.error || 'none'}`,
    );
  }
}

module.exports = { run };
