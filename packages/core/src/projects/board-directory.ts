// The sub-board member-directory read operation (Story 3.4, Task 1 / AC #1, #2, #3).
//
// JOINS two existing projections: the Story 3.1 projects membership (who is on the
// board — `findProject`/`Project.members`) ⋈ the Epic 2 identity directory (each
// member's current focus + last-seen — `foldIdentities`/`Identity`). Returns, for a
// given `projectId`, each member's `{ handle, currentFocus, lastSeen }` in join order
// (announcer first), all derived from the event stream. Pure read: no append.
//
// THIN: it reads the full event stream once via the DataAccess port (`eventsSince(0)`,
// which returns events already `seq`-ordered), resolves the project via the Story 3.1
// `findProject` (BOARD_NOT_FOUND if absent), folds the identity directory ONCE via the
// Epic 2 `foldIdentities`, and joins membership against that fold. NEITHER fold is
// duplicated here — each is the one source of truth for its projection.
//
// DECISION 1 (story Dev Notes): staleness is NOT computed here. core returns each
// member's derived `lastSeen` (ISO-8601); it does NOT compute a `stale` boolean. A
// `stale` flag needs a "now" clock + a threshold — both display/policy concerns, and
// core never fabricates time. Returning `lastSeen` makes members distinguishable; the
// consumer/UI thresholds against now (architecture: "staleness is a derived display
// value"). The session/membership gate is the tool's concern — this is board logic and
// stays session-agnostic.

import { foldIdentities } from '../identity/projection.js';
import { findProject } from './projection.js';
import { BoardError } from '../errors.js';

import type { DataAccess } from '../ports.js';

/**
 * One row of a sub-board's member directory — a member's handle joined with their
 * folded identity presence. A SUBSET of {@link Identity} (`createdAt` is omitted —
 * the directory surfaces who/what/last-seen, not the member's registration time).
 *
 * `currentFocus` and `lastSeen` are DERIVED from the identity projection (the member's
 * latest folded values by `seq`); never stored. `lastSeen` is ISO-8601. There is no
 * `stale` flag — staleness is a display value the consumer derives (see DECISION 1).
 */
export interface DirectoryMember {
  /** The member's canonical handle (the membership key from `Project.members`). */
  handle: string;
  /** The member's current focus statement (latest value from the identity fold). */
  currentFocus: string;
  /** The member's derived last-seen (ISO-8601) — distinguishes active vs stale. */
  lastSeen: string;
}

/**
 * Read a sub-board's member directory: each member of the project with their current
 * focus + derived last-seen, in join order (announcer first). The cross-projection
 * join at the heart of Story 3.4 (membership ⋈ identity).
 *
 * Reads the whole event stream once through the port, resolves the project via the
 * Story 3.1 {@link findProject} (reused, not duplicated), and folds the identity
 * directory once via the Epic 2 {@link foldIdentities} (reused, not duplicated). For
 * each handle in `project.members` (already in join order, announcer first) it emits
 * the member's `{ handle, currentFocus, lastSeen }` from the folded `Identity`.
 *
 * An unknown `projectId` (never announced) → `BoardError('BOARD_NOT_FOUND')` (AC #3).
 * No membership is consulted — the directory is board-wide readable (FR9); the only
 * precondition (an established identity) is enforced by the MCP tool, not core.
 *
 * Defensive: a member handle present in `project.members` but with NO folded identity
 * cannot occur in V1 (join requires an established, hence registered, session — so
 * every member handle has an `identity.registered`). If it somehow did, that handle is
 * SKIPPED rather than fabricated with empty focus — surfacing a phantom member with a
 * blank focus + missing last-seen would mask a real upstream bug, whereas an absent row
 * is an observable, non-fabricating signal. (We do NOT silently mint `{ '', '' }`.)
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)`
 *   returns ALL events `seq`-ordered.
 * @param projectId The slug id of the sub-board whose directory to read.
 * @returns The member directory as a `DirectoryMember[]` in join order.
 * @throws {BoardError} `BOARD_NOT_FOUND` if no project with `projectId` was announced.
 */
export async function boardDirectory(
  dataAccess: DataAccess,
  projectId: string,
): Promise<DirectoryMember[]> {
  const events = await dataAccess.eventsSince(0);

  const project = findProject(events, projectId);
  if (project === undefined) {
    throw new BoardError(
      'BOARD_NOT_FOUND',
      `No sub-board with project_id "${projectId}" exists.`,
    );
  }

  // Fold the identity directory ONCE, then join membership against it (do not re-fold
  // per member). `project.members` is already in join order (announcer first).
  const identities = foldIdentities(events);
  const members: DirectoryMember[] = [];
  for (const handle of project.members) {
    const identity = identities.get(handle);
    // Defensive (see doc): skip a member with no folded identity rather than fabricate
    // empty focus/last-seen. Not reachable in V1 (join requires a registered session).
    if (identity === undefined) continue;
    members.push({
      handle: identity.handle,
      currentFocus: identity.currentFocus,
      lastSeen: identity.lastSeen,
    });
  }

  return members;
}
