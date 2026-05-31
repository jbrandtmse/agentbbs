// @agentbbs/data-access — the NFR2 swap seam. The ONLY package that imports
// better-sqlite3. Implements the DataAccess port from @agentbbs/core; no
// SQL/SQLite type leaks past this barrel. Consumers import from
// "@agentbbs/data-access", never deep paths.
//
// Story 1.4 populates the connection substrate: DB path discovery (AR6), the
// WAL + busy_timeout connection + bounded busy-retry (NFR3/AR4), and the typed
// store-busy exhaustion error (the NFR2 graduation signal). The events schema,
// append, read queries, and the full DataAccess implementation land in Stories
// 1.5–1.7.

// --- DB path discovery (AC1, AR6) ---
export {
  AGENTBBS_DIR,
  DB_FILENAME,
  DB_PATH_ENV,
  ensureDbDirectory,
  findProjectRoot,
  resolveDbPath,
} from './path.js';
export type { ResolveDbPathOptions } from './path.js';

// --- Connection: WAL + busy_timeout + bounded retry (AC1, AC2) ---
export {
  BUSY_TIMEOUT_MS,
  getBusyTimeout,
  getJournalMode,
  MAX_WRITE_ATTEMPTS,
  openDatabase,
  runWithRetry,
} from './sqlite/connection.js';
export type { OpenDatabaseOptions } from './sqlite/connection.js';

// --- Typed exhaustion error (AC2) ---
export { STORE_BUSY, StoreBusyError } from './errors.js';
