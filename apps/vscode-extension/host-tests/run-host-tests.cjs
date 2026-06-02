// Story 10.2 — the real Extension Development Host smoke RUNNER (@vscode/test-electron).
//
// This is the Rule-12 real-runtime gate mechanism for Epic 10: it launches a GENUINE
// VS Code Electron extension host and runs an in-host test module (`extensionTestsPath`)
// inside it. It is a standalone Node script (NOT a vitest test) — the default `pnpm test`
// suite stays headless/fast; this is invoked explicitly via `pnpm --filter
// @agentbbs/vscode-extension test:host` (and at the lead's per-story smoke). The in-host
// module writes its findings to a JSON file (AGENTBBS_PROBE_OUT) which this runner reads
// + asserts out-of-band, so a host failure surfaces with the empirical evidence attached.
//
// HOST SELECTION (load-bearing — see the Dev Agent Record "Real-host harness" note):
//   - We let @vscode/test-electron DOWNLOAD a test-capable build (the stock installed
//     Code.exe is the STABLE product launcher; it does NOT accept the internal test-CLI
//     flags and, while a stable instance is RUNNING, forwards args to it as a CLI client →
//     "Code.exe: bad option" / exit 9. Verified empirically.).
//   - SINGLE-INSTANCE COLLISION: VS Code's single-instance lock is keyed by product QUALITY.
//     This dev machine has a STABLE VS Code instance already running, so a downloaded STABLE
//     test build collides with it (same quality → CLI forwarding → bad option). The fix
//     (the documented one) is to run the test host as a DIFFERENT QUALITY: 'insider' has a
//     distinct application id and boots its own Electron main process alongside the running
//     stable editor. 'insider' is a genuine VS Code Electron host (Rule 12 real-runtime
//     evidence); the in-host probe RECORDS the actual electron/node/ABI it ran on (never
//     guessed). On a CI box / a machine with no running stable instance, set
//     AGENTBBS_VSCODE_VERSION='1.122.1' to pin the exact stable build instead.
//   - AGENTBBS_VSCODE_VERSION selects the build: 'insider' (default here, runs concurrently
//     with the user's stable editor) or a pinned stable version like '1.122.1'.
//
// Verified against the INSTALLED @vscode/test-electron 2.5.2 types (Rule 3):
//   runTests({ vscodeExecutablePath?, extensionDevelopmentPath, extensionTestsPath,
//              extensionTestsEnv?, launchArgs? }): Promise<number>  // exit code, 0 = pass
//   extensionTestsPath → a module exporting `run(): Promise<void>` the host calls.

'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

// NODE-24 SPAWN FIX (load-bearing): @vscode/test-electron 2.5.2's own runTests() spawns
// Code.exe with `child_process.spawn('"<exe>"', args, { shell: true })`. On Node 24 the
// `shell:true` + `args` pattern (DEP0190) MANGLES the arguments on Windows, so every flag
// arrives at Code.exe garbled → "Code.exe: bad option: --no-sandbox" / exit 9 (even for a
// clean download with nothing running). We therefore do NOT call runTests(); we resolve the
// downloaded executable + its CLI args ourselves and spawn with `shell:false` (the Node-24-
// correct argument passing). This is the documented workaround for the Node-24 regression.

const EXT_ROOT = path.resolve(__dirname, '..');
// The build to download/launch. Default 'insider' so the test host runs CONCURRENTLY with
// the developer's already-running STABLE editor (distinct single-instance lock). Set to a
// pinned stable version (e.g. '1.122.1') on a host with no running stable instance.
const VSCODE_VERSION = process.env.AGENTBBS_VSCODE_VERSION || 'insiders';

/**
 * Launch the real Electron host and run one in-host test module, asserting its JSON
 * result out-of-band. `assert` is invoked with the parsed result object; throw inside
 * it to fail. Returns the parsed result for logging.
 */
async function runInHost(testsPath, label, assert, extraEnv = {}) {
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'agentbbs-host-probe-')),
    'probe-result.json',
  );

  // Download (or reuse cached) a test-capable VS Code build and get its GUI executable path.
  const exePath = await downloadAndUnzipVSCode(VSCODE_VERSION);

  // Isolated profile dirs (so the test host never touches the dev's real profile). These
  // mirror what runTests() would add via getProfileArguments.
  const cacheRoot = path.resolve(EXT_ROOT, '.vscode-test');
  const userDataDir = path.join(cacheRoot, 'user-data');
  const extensionsDir = path.join(cacheRoot, 'extensions');

  // The exact flag set runTests() builds (runTest.js), passed via shell:false so Node 24
  // does NOT mangle them. --extensionTestsPath points at our in-host module; the host calls
  // its exported run().
  const args = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-extensions',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${EXT_ROOT}`,
    `--extensionTestsPath=${testsPath}`,
  ];

  // CONTAMINATING-ENV STRIP (load-bearing): this runner is itself launched from INSIDE a VS
  // Code session (the agent's integrated terminal / extension host), whose env carries
  // ELECTRON_RUN_AS_NODE=1 + a family of VSCODE_* vars. If those leak into the child, the
  // spawned Code.exe runs AS PLAIN NODE (ELECTRON_RUN_AS_NODE) and treats every flag as a
  // node/script arg → "Code.exe: bad option: --no-sandbox" / exit 9. We build a CLEAN env
  // that drops ELECTRON_RUN_AS_NODE and all VSCODE_*/ELECTRON_* vars so the child boots as a
  // real Electron extension host. (This was the true cause of the bad-option failures, not
  // shell quoting or the single-instance lock.)
  const childEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (/^VSCODE_/.test(k)) continue;
    if (/^ELECTRON_/.test(k)) continue;
    childEnv[k] = v;
  }
  childEnv.AGENTBBS_PROBE_OUT = outFile;
  // Per-probe env (e.g. AGENTBBS_DB → an isolated temp ledger for the open-ledger probe).
  for (const [k, v] of Object.entries(extraEnv)) childEnv[k] = v;

  let exitCode;
  let runError;
  try {
    exitCode = await new Promise((resolve, reject) => {
      const child = cp.spawn(exePath, args, {
        // shell:false — the Node-24-correct path (no DEP0190 arg mangling) — plus the
        // cleaned env above so the child is a real Electron host, not ELECTRON_RUN_AS_NODE.
        shell: false,
        env: childEnv,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve(code ?? signal));
    });
  } catch (err) {
    runError = err;
  }

  // Read the evidence the in-host module wrote (present even when run() threw).
  let result = null;
  if (fs.existsSync(outFile)) {
    result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  }

  console.log(`\n[${label}] in-host result:`, JSON.stringify(result, null, 2));
  console.log(`[${label}] host exit code: ${String(exitCode)}`);

  if (result === null) {
    throw new Error(
      `[${label}] the in-host module produced no result file — the host did not run ` +
        `the probe (runError=${runError ? runError.message : 'none'}, exit=${String(exitCode)}).`,
    );
  }

  assert(result);

  if (runError) throw runError;
  if (exitCode !== 0) {
    throw new Error(`[${label}] host exited non-zero (${String(exitCode)}).`);
  }
  return result;
}

async function main() {
  // GATE (Task 1): node:sqlite must be exposed + usable in the real host.
  const gate = await runInHost(
    path.join(__dirname, 'probe-node-sqlite.in-host.cjs'),
    'GATE node:sqlite',
    (r) => {
      if (!r.nodeSqliteResolved) {
        throw new Error('node:sqlite did NOT resolve in the Electron host.');
      }
      if (!r.memoryOpenOk || typeof r.sqliteVersion !== 'string') {
        throw new Error(
          'node:sqlite resolved but could not open :memory: / query.',
        );
      }
    },
  );

  // AC1 / AC3 (Task 3): the host opens the REAL ledger via the data-access node:sqlite
  // adapter and reads back seeded state. This module is bundled (it imports
  // @agentbbs/data-access) — see host-tests/build-host-tests.cjs.
  const ledgerProbePath = path.join(
    __dirname,
    'dist',
    'open-ledger.in-host.cjs',
  );
  if (fs.existsSync(ledgerProbePath)) {
    // Isolated temp ledger so the in-host probe never touches a real `.agentbbs/` board.
    const ledgerDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentbbs-host-ledger-'),
    );
    const ledgerDb = path.join(ledgerDir, '.agentbbs', 'agentbbs.db');
    await runInHost(
      ledgerProbePath,
      'AC1 host-opens-ledger',
      (r) => {
        if (!r.opened) {
          throw new Error(
            `host did not open the ledger via data-access: ${r.error || 'unknown'}`,
          );
        }
        if (!Array.isArray(r.projects)) {
          throw new Error('host read did not return a projects array.');
        }
        if (r.seededProjectFound !== true) {
          throw new Error(
            'host read did not find the seeded project in the ledger.',
          );
        }
      },
      { AGENTBBS_DB: ledgerDb },
    );
  } else {
    console.log(
      '\n[AC1 host-opens-ledger] SKIPPED — bundle not built. Run ' +
        '`node host-tests/build-host-tests.cjs` first (the test:host script does this).',
    );
  }

  // Story 10.3 (AC1/AC2/AC3): the native tree MODEL — built host-side via data-access + core
  // ops DIRECTLY — produces the correct node tree against a seeded ledger in the real host,
  // INCLUDING a NAVIGABLE proto-room row (Rule 15) + the NEEDS-YOU decoration source state.
  const treeProbePath = path.join(__dirname, 'dist', 'tree-model.in-host.cjs');
  if (fs.existsSync(treeProbePath)) {
    const treeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentbbs-host-tree-'),
    );
    const treeDb = path.join(treeDir, '.agentbbs', 'agentbbs.db');
    await runInHost(
      treeProbePath,
      'AC2 tree-proto-room-navigable',
      (r) => {
        if (!r.opened || !r.projectFound) {
          throw new Error(
            `host did not build the tree model: opened=${r.opened} projectFound=${r.projectFound} ${r.error || ''}`,
          );
        }
        if (!r.activeRoomIsRow || r.activeRoomNotPending !== true) {
          throw new Error(
            'the active room is not a non-pending row in the host tree.',
          );
        }
        // RULE 15 — the load-bearing real-host assertion: the proto-room is a NAVIGABLE ROW.
        if (r.protoRoomIsNavigableRow !== true || r.protoRoomPending !== true) {
          throw new Error(
            'the proto-room is NOT a navigable pending row in the host tree (Rule-15 regression).',
          );
        }
        if (r.activeBeforePending !== true) {
          throw new Error(
            'active rooms do not render before pending proto-rooms.',
          );
        }
        // AC3 decoration source: the escalated room is NEEDS-YOU flagged + bucketed.
        if (r.needsYouFlagged !== true || r.needsYouBucketHasRoom !== true) {
          throw new Error(
            'the NEEDS-YOU escalation state is wrong in the host tree.',
          );
        }
      },
      { AGENTBBS_DB: treeDb },
    );
  } else {
    console.log(
      '\n[AC2 tree-proto-room-navigable] SKIPPED — bundle not built. Run ' +
        '`node host-tests/build-host-tests.cjs` first (the test:host script does this).',
    );
  }

  // Story 10.4 (AC1/AC2/AC4): the room WebviewPanel — a REAL panel opens (one per room,
  // reveal-not-duplicate), its HTML shell carries the nonce CSP + the room id + no unsafe-*, and a
  // real reply through the panel bridge ACTIVATES a proto-room (out-of-band active flip).
  const panelProbePath = path.join(__dirname, 'dist', 'room-panel.in-host.cjs');
  if (fs.existsSync(panelProbePath)) {
    const panelDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentbbs-host-panel-'),
    );
    const panelDb = path.join(panelDir, '.agentbbs', 'agentbbs.db');
    await runInHost(
      panelProbePath,
      'AC4 room-panel-reply-activates',
      (r) => {
        if (!r.opened || !r.panelCreated || !r.panelHasWebview) {
          throw new Error(
            `the room WebviewPanel was not created in the host: ${JSON.stringify(r)}`,
          );
        }
        if (!r.htmlHasNonceCsp || !r.htmlHasRoomId || !r.htmlNoUnsafe) {
          throw new Error(
            `the panel HTML shell is wrong (nonce CSP / room id / no-unsafe): ${JSON.stringify(r)}`,
          );
        }
        // Story 10.5 AC1 — the STRICT CSP holds in a real webview (every directive pinned).
        if (!r.cspStrict) {
          throw new Error(
            `the real-webview CSP is not strict (default-src none / nonce / pinned img/font / connect none / no unsafe/wildcard/data:): ${JSON.stringify(r.cspString)}`,
          );
        }
        if (!r.revealNotDuplicate) {
          throw new Error(
            're-opening the same room did NOT reveal the existing panel (duplicate created).',
          );
        }
        // AC4 — the load-bearing Rule-15 real-host assertion: a reply ACTIVATES the proto-room.
        if (!r.protoInactiveBefore) {
          throw new Error('the proto-room was not inactive before the reply.');
        }
        if (!r.activeAfterReply || !r.activatedByOperator) {
          throw new Error(
            'the reply did NOT activate the proto-room in the host (Rule-15 respond-parity regression).',
          );
        }
        // Story 10.5 AC2 — the serializer registers + a deserialize round-trip re-attaches the
        // restored panel to its room (reveal-not-duplicate post-restore). The TRUE window-reload
        // restore is a manual lead-reload step (see the in-host probe note); this proves the
        // registration API + the deserialize→adopt logic on a REAL panel in the host.
        if (!r.serializerRegistered) {
          throw new Error(
            'registerWebviewPanelSerializer did not return a Disposable in the host.',
          );
        }
        if (!r.deserializeReattached) {
          throw new Error(
            'the serializer deserialize round-trip did NOT re-attach the restored panel to its room.',
          );
        }
        // Story 10.6 (AC2) — ColorThemeKind is read in-host + flows into the panel HTML; a live
        // theme switch (postThemeKind) pushes a real frame to the real webview.
        if (!r.themeKindRead || !r.htmlHasThemeKind) {
          throw new Error(
            `ColorThemeKind was not read / did not flow into the panel HTML (themeKindRead=${JSON.stringify(r.themeKindRead)}, htmlHasThemeKind=${r.htmlHasThemeKind}).`,
          );
        }
        if (!r.themeKindPushed) {
          throw new Error(
            'postThemeKind did NOT push a themeKind frame to the real webview (live re-theme regression).',
          );
        }
        // Story 10.6 (AC1) — the bridge MAX(seq) poll pushed a delta host→webview on a real appended
        // event (the live-fold producer half) over the REAL node:sqlite handle.
        if (!r.livePollPushedDelta) {
          throw new Error(
            'the bridge MAX(seq) poll did NOT push a delta when a real event was appended (live-fold producer regression).',
          );
        }
      },
      { AGENTBBS_DB: panelDb },
    );
  } else {
    console.log(
      '\n[AC4 room-panel-reply-activates] SKIPPED — bundle not built. Run ' +
        '`node host-tests/build-host-tests.cjs` first (the test:host script does this).',
    );
  }

  // Story 10.7 (AC1/AC2/AC3): the compose panel — a REAL single reused panel, each of the 4
  // INITIATE writes LANDS in the ledger, and a posted announcement is a NAVIGABLE proto-room that
  // reply-activates (the initiate→respond loop, Rule 15 both directions).
  const composeProbePath = path.join(
    __dirname,
    'dist',
    'compose-panel.in-host.cjs',
  );
  if (fs.existsSync(composeProbePath)) {
    const composeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentbbs-host-compose-'),
    );
    const composeDb = path.join(composeDir, '.agentbbs', 'agentbbs.db');
    await runInHost(
      composeProbePath,
      'AC1/AC3 compose-initiate-writes-land',
      (r) => {
        if (!r.opened || !r.panelCreated || !r.singlePanelReused) {
          throw new Error(
            `the compose panel was not created / not single-reused in the host: ${JSON.stringify(r)}`,
          );
        }
        if (!r.htmlHasComposeKind || !r.htmlHasNonceCsp || !r.htmlNoUnsafe) {
          throw new Error(
            `the compose panel HTML shell is wrong (compose-kind / nonce CSP / no-unsafe): ${JSON.stringify(r)}`,
          );
        }
        // AC1 — each of the 4 INITIATE writes landed in the ledger (out-of-band).
        if (
          !r.announceLanded ||
          !r.postAnnouncementLanded ||
          !r.joinBoardLanded ||
          !r.updateFocusLanded
        ) {
          throw new Error(
            `not all 4 INITIATE writes landed in the ledger: ${JSON.stringify(r)}`,
          );
        }
        // AC3 (Rule 15) — the load-bearing assertion: the posted announcement is a NAVIGABLE
        // proto-room (not just counted) AND it reply-activates (the initiate→respond loop).
        if (!r.protoRoomNavigable) {
          throw new Error(
            'the posted announcement is NOT a navigable proto-room in the host tree (Rule-15 initiate→respond regression).',
          );
        }
        if (!r.protoRoomActivatesByReply) {
          throw new Error(
            'the posted proto-room did NOT activate on a reply (the respond half of the loop is broken).',
          );
        }
        if (!r.watchingOnlyGated) {
          throw new Error(
            'a watching-only initiate write did NOT yield the host-surface NO_OPERATOR gate.',
          );
        }
      },
      { AGENTBBS_DB: composeDb },
    );
  } else {
    console.log(
      '\n[AC1/AC3 compose-initiate-writes-land] SKIPPED — bundle not built. Run ' +
        '`node host-tests/build-host-tests.cjs` first (the test:host script does this).',
    );
  }

  // END-OF-EPIC Rule-14 INTEGRATED EXPLORATORY SMOKE — the WHOLE operator journey across ALL
  // surface managers (compose + tree + room panel) in ONE session, crossing every seam between
  // stories (the Epic-9 proto-room gap lived in exactly this between-stories space).
  const integratedProbePath = path.join(
    __dirname,
    'dist',
    'integrated-flow.in-host.cjs',
  );
  if (fs.existsSync(integratedProbePath)) {
    const intDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentbbs-host-integrated-'),
    );
    const intDb = path.join(intDir, '.agentbbs', 'agentbbs.db');
    await runInHost(
      integratedProbePath,
      'Rule-14 integrated-operator-flow',
      (r) => {
        // The probe self-asserts each seam + throws naming the failed seam(s); re-assert the
        // load-bearing cross-surface seams here so a regression surfaces with a clear message.
        const seams = [
          'opened',
          'projectCreated',
          'projectInTree',
          'announcementPosted',
          'protoRoomNavigableInTree',
          'roomPanelOpened',
          'roomPanelShowsAnnouncement',
          'replyActivatedRoom',
          'treeRowActiveAfterReply',
          'agreedMarkComputed',
          'focusSetAndReflected',
          'foreignProjectJoined',
          'foreignProjectInTreeAsMember',
          'composeAndRoomPanelsCoexist',
        ];
        const failed = seams.filter((s) => !r[s]);
        if (failed.length > 0) {
          throw new Error(
            `Rule-14 integrated flow broke at seam(s): ${failed.join(', ')} — ${JSON.stringify(r)}`,
          );
        }
      },
      { AGENTBBS_DB: intDb },
    );
  } else {
    console.log(
      '\n[Rule-14 integrated-operator-flow] SKIPPED — bundle not built. Run ' +
        '`node host-tests/build-host-tests.cjs` first (the test:host script does this).',
    );
  }

  console.log('\nAll in-host probes passed. Electron host:', {
    electron: gate.electron,
    modules: gate.modules,
    node: gate.node,
    sqliteVersion: gate.sqliteVersion,
  });
}

main().catch((err) => {
  console.error('\nHOST TEST RUN FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
