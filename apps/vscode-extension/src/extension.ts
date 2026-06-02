// @agentbbs/vscode-extension — the VS Code operator surface.
//
// This module is the extension-host ENTRY POINT (the package `main`, bundled to
// dist/extension.cjs by esbuild). It is a THIN CLIENT (NFR2 / project-rules Rule 13): it
// imports @agentbbs/core / @agentbbs/data-access / @agentbbs/ui-shared, but NEVER a SQLite
// driver directly (only @agentbbs/data-access does, transitively) and NO board logic lives
// here.
//
// Story 10.1 scope: prove the scaffold ACTIVATES + the SQLite driver loads in the host.
// Story 10.2 scope (this): on activate, OPEN the shared ledger via @agentbbs/data-access's
// node:sqlite adapter (AC1), reusing resolveDbPath (AGENTBBS_DB / project-root walk-up); close
// it on deactivate. The postMessage bridge (src/bridge.ts) is ready for the webview-bearing
// stories (10.4) to bind to a real webview — its dispatch + delta-poll logic is proven by
// bridge.test.ts and the real-host ledger probe.

import * as vscode from 'vscode';

import { openLedger } from './db.js';

import type { OpenedLedger } from './db.js';

/** Activation log marker — asserted by the host smoke / surfaced in the host log. */
export const ACTIVATION_LOG = '[agentbbs] extension activated';

/** The host's single opened ledger handle, held for the lifetime of the activation. */
let ledger: OpenedLedger | undefined;

/**
 * Extension activation entry point. Invoked by the VS Code extension host on the first
 * activation event.
 *
 * Opens the shared SQLite ledger via @agentbbs/data-access (node:sqlite adapter; AC1) and holds
 * the handle for the session. Registers a trivial command as the activation proof + logs an
 * activation line. Kept thin (Rule 13) — no board logic; the DB handle is the seam the bridge
 * (and the 10.3+ views) delegate every op to.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Open the shared ledger (AGENTBBS_DB / project-root walk-up, via data-access). A failure to
  // open must not crash activation — log it; the views/bridge surface the error to the operator.
  try {
    ledger = openLedger();
    console.log(`${ACTIVATION_LOG} (ledger: ${ledger.dbPath})`);
  } catch (err) {
    ledger = undefined;
    console.error(
      `[agentbbs] failed to open the ledger: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log(ACTIVATION_LOG);
  }

  // A trivial registered command — invoking it proves the extension activated and its command
  // surface is live. Disposed automatically via context.subscriptions.
  const disposable = vscode.commands.registerCommand(
    'agentbbs.helloAbiProof',
    () => {
      void vscode.window.showInformationMessage(
        'AgentBBS extension is active.',
      );
    },
  );

  context.subscriptions.push(disposable);
}

/**
 * Extension deactivation hook. Closes the ledger handle opened at activation (Story 10.2) so the
 * node:sqlite connection is released cleanly on shutdown. The command disposable is owned by
 * context.subscriptions and torn down by the host.
 */
export function deactivate(): void {
  if (ledger !== undefined) {
    try {
      ledger.dataAccess.close();
    } catch {
      /* a double-close / already-closed connection is harmless on shutdown */
    }
    ledger = undefined;
  }
}
