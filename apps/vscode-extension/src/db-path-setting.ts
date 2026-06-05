// Resolve the extension's SQLite ledger path with the in-plugin `agentbbs.databasePath`
// setting taking precedence (Epic 10 manual-smoke enhancement).
//
// WHY: the extension previously discovered the ledger via `AGENTBBS_DB` env only, with a
// `process.cwd()` walk-up default. In a GUI-launched / installed VS Code extension host, `cwd`
// is usually the VS Code INSTALL dir (NOT the workspace), so the walk-up reliably missed the
// project's `.agentbbs/`. The fix is twofold: (1) an explicit in-plugin setting the operator can
// point at the ledger, and (2) defaulting the walk-up start dir to the WORKSPACE folder instead
// of `cwd`.
//
// THIN CLIENT (Rule 13): this is client-layer PATH resolution only — it never touches board
// logic, and it does NOT modify `@agentbbs/data-access` (which already exposes the `env` /
// `startDir` options this consumes via `resolveDbPath`). This module is the pure, testable seam:
// `vscode.workspace`/`vscode.window` access stays in `extension.ts`/`db.ts`; everything path-shaped
// is decided here from plain inputs so it is unit-testable under the root `pnpm test`.

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { resolveDbPath } from '@agentbbs/data-access';

/** The contributed setting id that holds an explicit ledger path (empty = auto-discover). */
export const DATABASE_PATH_SETTING = 'agentbbs.databasePath';

/** A leading token in the setting value that expands to the first workspace folder's fsPath. */
const WORKSPACE_FOLDER_TOKEN = '${workspaceFolder}';

/** Plain inputs to {@link resolveExtensionDbPath} — all injectable for deterministic tests. */
export interface ResolveExtensionDbPathInput {
  /** The raw `agentbbs.databasePath` setting value (or `undefined`/empty = unset). */
  settingValue?: string | null;
  /** The environment to read `AGENTBBS_DB` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The first workspace folder's `uri.fsPath` (or `undefined` when no folder is open). */
  workspaceFolder?: string;
  /** The process CWD (fallback walk-up origin when no workspace folder). Defaults to `process.cwd()`. */
  cwd?: string;
  /** The user's home dir (for `~` expansion). Defaults to `os.homedir()`. */
  home?: string;
}

/**
 * Expand a setting value: a leading `${workspaceFolder}` token → the workspace folder, a leading
 * `~` → the home dir, then resolve a RELATIVE path against the workspace folder (else CWD).
 * Returns an absolute path. Exported for focused testing.
 */
export function expandSettingPath(
  value: string,
  opts: { workspaceFolder?: string; cwd: string; home: string },
): string {
  const base = opts.workspaceFolder ?? opts.cwd;
  let v = value.trim();

  // ${workspaceFolder} token (leading). Falls back to CWD when no folder is open so the token is
  // never left literal in a path.
  if (v === WORKSPACE_FOLDER_TOKEN) {
    v = base;
  } else if (v.startsWith(WORKSPACE_FOLDER_TOKEN)) {
    // Strip the token + the following separator, then resolve the remainder against the base.
    const rest = v.slice(WORKSPACE_FOLDER_TOKEN.length).replace(/^[\\/]+/, '');
    return resolve(base, rest);
  }

  // ~ home expansion (leading `~` alone or `~/...`).
  if (v === '~') {
    v = opts.home;
  } else if (v.startsWith('~/') || v.startsWith('~\\')) {
    return resolve(opts.home, v.slice(2));
  }

  // Absolute → verbatim (resolved/normalized); relative → resolve against the base.
  return isAbsolute(v) ? resolve(v) : resolve(base, v);
}

/**
 * Resolve the absolute ledger path for the extension host, in precedence order:
 *
 *   1. the `agentbbs.databasePath` SETTING (when non-empty) — the operator's explicit in-plugin
 *      intent WINS; expanded (`${workspaceFolder}` / `~` / relative-against-workspace).
 *   2. else the `AGENTBBS_DB` env var (parity with the MCP server + web host, so all surfaces can
 *      share one board) — honoured inside `resolveDbPath`.
 *   3. else a WORKSPACE-folder walk-up (`resolveDbPath({ startDir: workspaceFolder ?? cwd })`) —
 *      defaulting the discovery origin to the workspace folder, NOT `cwd` (the core reliability
 *      fix for the installed-extension host where `cwd` is the VS Code install dir).
 */
export function resolveExtensionDbPath(
  input: ResolveExtensionDbPathInput = {},
): string {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const home = input.home ?? homedir();
  const { workspaceFolder } = input;

  // (1) explicit in-plugin setting wins.
  const setting = input.settingValue?.trim();
  if (setting !== undefined && setting.length > 0) {
    return expandSettingPath(setting, { workspaceFolder, cwd, home });
  }

  // (2) AGENTBBS_DB env (handled verbatim inside resolveDbPath) / (3) workspace-folder walk-up.
  return resolveDbPath({ env, startDir: workspaceFolder ?? cwd });
}
