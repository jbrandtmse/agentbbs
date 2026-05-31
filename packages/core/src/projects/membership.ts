// The membership write-gate primitive (Story 3.5, Task 1 / AC #2, #3).
//
// Formalizes the visibility model's WRITE side: read is open board-wide (identity,
// not membership — already delivered by `list_projects`/`list_members`), but POSTING
// requires membership. This file ships the reusable authorization the Epic 4 post
// tools call BEFORE they append:
//   - `isMember(project, actor)` — the pure, I/O-free membership predicate (the cheap
//     check the UI + post ops reuse): is `actor` in this project's derived `members`?
//   - `requireMembership(dataAccess, actor, projectId)` — the throwing gate: reads the
//     ledger once, resolves the project, and either resolves (authorized) or throws
//     `BOARD_NOT_FOUND` (the board was never announced — you cannot be a member of a
//     board that does not exist) / `NOT_A_MEMBER` (the board exists but `actor` has not
//     joined it). DISTINCT codes by design (AC #3).
//
// PURE AUTHORIZATION — it performs NO append. It is the gate, not the action: the Epic 4
// post tools (post_announcement 4.1, reply 4.3, add_participant 4.5) call this first and
// THEN append. The "acting = joining" side effect (FR10) is the post tools' concern and
// is implemented in Epic 4 — NOT here (this story forward-declares it only). This mirrors
// Story 2.5's `recordSeen`: a primitive shipped with a declared future consumer (Rule 1
// escape clause).
//
// `actor` is a PARAMETER (session-agnostic core), mirroring the other ops — the server
// resolves "who am I" from the session and passes the canonical handle. The membership
// fold is NOT duplicated here: it reuses the Story 3.1 `findProject`/`Project.members`
// (the single source of truth for the projects-membership projection), exactly as
// `board-directory.ts` does the read+findProject+throw shape this mirrors.

import { findProject } from './projection.js';
import { BoardError } from '../errors.js';

import type { Project } from './projection.js';
import type { DataAccess } from '../ports.js';

/**
 * Is `actor` a member of `project`? The pure, I/O-free membership predicate — a thin
 * wrapper over the derived `project.members` (the announcer is first, joiners append,
 * de-duplicated; see {@link Project}). The cheap check post ops + the Epic 9/10 UI reuse
 * without paying for a ledger read when they already hold a folded {@link Project}.
 *
 * @param project A folded project record (from `findProject`/`foldProjects`).
 * @param actor The canonical handle to test for membership.
 * @returns `true` iff `actor` appears in `project.members`.
 */
export function isMember(project: Project, actor: string): boolean {
  return project.members.includes(actor);
}

/**
 * Authorize `actor` to act on (post into) the sub-board `projectId` — the membership
 * WRITE-gate the Epic 4 post tools call before they append (AC #2, #3). Resolves when
 * authorized; otherwise throws. Performs NO append: pure authorization.
 *
 * Reads the whole event stream once through the port (`eventsSince(0)` returns events
 * `seq`-ordered), resolves the project via the Story 3.1 {@link findProject} (reused,
 * NOT re-folded), then:
 *   - unknown `projectId` (never announced) → `BoardError('BOARD_NOT_FOUND')`. You
 *     cannot be a member of a board that does not exist — distinct from `NOT_A_MEMBER`.
 *   - the board exists but `actor` is not in its `members` (via {@link isMember}) →
 *     `BoardError('NOT_A_MEMBER')`.
 *   - otherwise → resolves `void` (authorized; the caller proceeds to append).
 *
 * @param dataAccess The persistence port (the only dependency); `eventsSince(0)` returns
 *   ALL events `seq`-ordered.
 * @param actor The canonical handle of the acting identity (session-agnostic: the server
 *   resolves it and passes it in).
 * @param projectId The slug id of the sub-board the actor wants to post into.
 * @returns A promise that resolves (void) iff `actor` is authorized to post.
 * @throws {BoardError} `BOARD_NOT_FOUND` if no project with `projectId` was announced;
 *   `NOT_A_MEMBER` if the project exists but `actor` has not joined it.
 */
export async function requireMembership(
  dataAccess: DataAccess,
  actor: string,
  projectId: string,
): Promise<void> {
  const events = await dataAccess.eventsSince(0);

  const project = findProject(events, projectId);
  if (project === undefined) {
    throw new BoardError(
      'BOARD_NOT_FOUND',
      `No sub-board with project_id "${projectId}" exists.`,
    );
  }

  if (!isMember(project, actor)) {
    throw new BoardError(
      'NOT_A_MEMBER',
      `Handle "${actor}" is not a member of sub-board "${projectId}"; join it before posting.`,
    );
  }
  // Authorized — the actor is a member. No append: this is the gate, not the action.
}
