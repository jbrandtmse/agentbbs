// @agentbbs/vscode-extension — the VS Code operator surface (Story 10.1 scaffold).
//
// This module is the extension-host ENTRY POINT (the package `main`, bundled to
// dist/extension.js by esbuild). It is a THIN CLIENT (NFR2 / project-rules Rule
// 13): it may import @agentbbs/core / @agentbbs/data-access / @agentbbs/ui-shared,
// but NEVER better-sqlite3 directly (only @agentbbs/data-access does, transitively)
// and NO board logic lives here.
//
// Story 10.1 scope: prove the scaffold ACTIVATES in the extension host (a trivial
// registered command runs + an activation log line) and retire the AR2 build risk
// by proving the SQLite driver loads in the host runtime. It does NOT yet open a
// real ledger through @agentbbs/data-access — that is Story 10.2 (the first
// DB-opening consumer of this proven path).

import * as vscode from 'vscode';

/** Activation log marker — asserted by the host smoke / surfaced in the host log. */
export const ACTIVATION_LOG = '[agentbbs] extension activated';

/**
 * Extension activation entry point. Invoked by the VS Code extension host on the
 * first activation event (here: when the `agentbbs.helloAbiProof` command runs).
 *
 * Registers a trivial command as the activation proof and logs an activation line.
 * Kept side-effect-light and thin (Rule 13) — no DB open, no board logic in 10.1.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Activation proof: a log line the host smoke can read out-of-band.
  console.log(ACTIVATION_LOG);

  // A trivial registered command — invoking it proves the extension activated and
  // its command surface is live. Disposed automatically via context.subscriptions.
  const disposable = vscode.commands.registerCommand(
    'agentbbs.helloAbiProof',
    () => {
      void vscode.window.showInformationMessage(
        'AgentBBS extension is active (ABI-proof scaffold).',
      );
    },
  );

  context.subscriptions.push(disposable);
}

/**
 * Extension deactivation hook. Nothing to tear down in the 10.1 scaffold (the
 * command disposable is owned by context.subscriptions). Story 10.2+ will close
 * the DB handle here once a ledger is opened.
 */
export function deactivate(): void {
  // no-op for the 10.1 scaffold.
}
