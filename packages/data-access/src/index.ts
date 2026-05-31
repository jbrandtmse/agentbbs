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
// the WRITE-direction wire mapping.
//
// Story 1.6 adds the READ half + completes the seam: the `seq`-ordered read
// queries, the READ-direction wire mapping, and `createDataAccess` — the composed
// object implementing the full `@agentbbs/core` `DataAccess` port. This barrel is
// the package's ONLY public surface; better-sqlite3 never escapes it.

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

// --- Read queries: the READ half of the seam (Story 1.6, AC1) ---
export { createReadQueries } from './sqlite/queries.js';
export type { ReadQueries } from './sqlite/queries.js';

// --- Wire mapping (Story 1.5 WRITE direction + Story 1.6 READ direction) ---
export {
  newEventToRow,
  payloadToWire,
  rowToEvent,
  wireToPayload,
} from './mapping.js';
export type { EventRowInput, StoredEventRow } from './mapping.js';

// --- Composed DataAccess: the full @agentbbs/core port (Story 1.6, AC1/AC2) ---
export { createDataAccess, fromConnection } from './data-access.js';
export type { DataAccessHandle } from './data-access.js';
