// The `listProjects` board read operation (Story 3.2, Task 1 / AC #1, #3).
//
// Returns the projects directory — the main-board's list of sub-boards — as an
// array ordered by `seq` (announcement order; NEVER `createdAt`). This is the read
// surface `list_projects` (the thin MCP tool) consumes; browsing requires no
// membership, only an established identity (the session gate lives in the tool, not
// here — core stays session-agnostic).
//
// It is a THIN read: it reads the full event stream via the DataAccess port
// (`eventsSince(0)`, which returns events already `seq`-ordered), folds it via the
// Story 3.1 `foldProjects` projection (NEVER duplicated here — the fold is the one
// source of truth for the directory shape), and returns the records as an array.
// Derived state, NEVER stored (THE APPEND INVARIANT): the directory is recomputed
// from events every call; there is no `projects` table.
//
// Ordering: `foldProjects` already yields `Map` insertion order = announcement order
// = `seq` order, but we ALSO sort by `Project.seq` ascending explicitly so the
// contract is order-independent of `Map` iteration internals (AC #1's "ordered
// deterministically by seq"). Empty ledger → `[]` (AC #3), never an error.

import { foldProjects } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Project } from './projection.js';

/**
 * List the projects directory (the main-board sub-board listing), ordered by `seq`
 * ascending — the deterministic announcement order (AC #1). An empty ledger yields
 * an empty array (AC #3).
 *
 * Reads the whole event stream through the port, folds it with the Story 3.1
 * {@link foldProjects} projection (reused, not duplicated), and returns the records
 * as a `seq`-sorted array. No membership is consulted — the directory is board-wide
 * readable (FR9); the only precondition (an established identity) is enforced by the
 * MCP tool, not core.
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)`
 *   returns ALL events `seq`-ordered.
 * @returns The projects directory as a `Project[]` sorted by `seq` ascending.
 */
export async function listProjects(dataAccess: DataAccess): Promise<Project[]> {
  const events = await dataAccess.eventsSince(0);
  const directory = foldProjects(events);
  // Map iteration already preserves announcement (=seq) order, but sort explicitly
  // so the contract does not depend on Map internals.
  return [...directory.values()].sort((a, b) => a.seq - b.seq);
}
