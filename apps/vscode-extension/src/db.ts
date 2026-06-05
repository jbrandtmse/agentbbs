// Extension-host DB open (Story 10.2, AC1) — the host's single ledger handle.
//
// THIN CLIENT (Rule 13 / NFR2): this module imports `@agentbbs/data-access` ONLY — never a
// SQLite driver directly. It opens the SHARED ledger the MCP server + web host use, via the
// SAME path discovery (`AGENTBBS_DB` override / project-root walk-up through `resolveDbPath`),
// but through the node:sqlite-backed adapter (`createDataAccessNodeSqlite`) because the VS Code
// extension host runs an Electron-embedded Node where a native better-sqlite3 rebuild is not
// available on this machine (Story 10.1 / the Epic-10 driver decision). The agent backend keeps
// better-sqlite3 unchanged — only this host uses the node:sqlite adapter behind the IDENTICAL
// `DataAccess` port, so no board logic moves into the client.

import {
  createDataAccessNodeSqlite,
  resolveDbPath,
} from '@agentbbs/data-access';

import type { DataAccessHandle } from '@agentbbs/data-access';

/** The opened ledger handle + the resolved path it was opened at (for logging/diagnostics). */
export interface OpenedLedger {
  /** The composed `DataAccess` (node:sqlite-backed) the bridge delegates every op to. */
  dataAccess: DataAccessHandle;
  /** The absolute path the ledger was opened at (AGENTBBS_DB / project-root walk-up). */
  dbPath: string;
}

/**
 * Open the shared SQLite ledger for the extension host.
 *
 * Resolves the path with the SAME discovery the MCP server + web host use (so the extension
 * reads the SAME board: `AGENTBBS_DB` if set, else `<project-root>/.agentbbs/agentbbs.db` via
 * the walk-up), then opens it through the node:sqlite adapter (WAL + busy_timeout +
 * forward-only migration, all inside data-access). The caller owns the lifecycle and MUST call
 * `dataAccess.close()` on deactivate.
 *
 * @param dbPathOverride An explicit path (tests / a host that already resolved it). Omit to use
 *   the standard discovery — the production path.
 */
export function openLedger(dbPathOverride?: string): OpenedLedger {
  const dbPath = dbPathOverride ?? resolveDbPath();
  const dataAccess = createDataAccessNodeSqlite({ dbPath });
  return { dataAccess, dbPath };
}
