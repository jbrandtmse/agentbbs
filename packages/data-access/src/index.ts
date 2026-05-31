// @agentbbs/data-access — the NFR2 swap seam. The ONLY package that imports
// better-sqlite3 (added in Story 1.4). Implements the DataAccess port from
// @agentbbs/core; no SQL/SQLite type ever leaks past this barrel. Populated by
// Story 1.4+.

/** Package name marker; replaced by the real implementation in Story 1.4. */
export const DATA_ACCESS_PACKAGE = '@agentbbs/data-access';
