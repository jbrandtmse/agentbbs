// @agentbbs/data-access — the NFR2 swap seam. The ONLY package that imports
// better-sqlite3. Implements the DataAccess port from @agentbbs/core; no
// SQL/SQLite type leaks past this barrel. Consumers import from
// "@agentbbs/data-access", never deep paths.
//
// Story 1.4 populates the connection substrate: DB path discovery (AR6), the
// WAL + busy_timeout connection + bounded busy-retry (NFR3/AR4), and the typed
// store-busy exhaustion error (the NFR2 graduation signal).
//
// Story 1.5 adds the WRITE half of the seam: the append-only `events` schema, the
// forward-only idempotent migration, the transactional `append` (write half), and
// the WRITE-direction wire mapping. Read queries + the READ-direction mapping land
// in Story 1.6; the full composed DataAccess follows there.

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

// --- Schema + forward-only idempotent migration (Story 1.5, AC1) ---
export { EVENTS_TABLE, SCHEMA_SQL } from './sqlite/schema.js';
export { migrate } from './sqlite/migrate.js';

// --- Transactional append: the WRITE half of the seam (Story 1.5, AC2) ---
export { createAppend } from './sqlite/append.js';

// --- Wire mapping, WRITE direction (Story 1.5; READ direction lands in 1.6) ---
export { newEventToRow, payloadToWire } from './mapping.js';
export type { EventRowInput } from './mapping.js';
