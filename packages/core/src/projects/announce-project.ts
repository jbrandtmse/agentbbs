// The `announceProject` board operation (Story 3.1, Task 2 / AC #1, #2).
//
// Announcing a project creates a new sub-board with the announcer as its first
// member. It appends TWO events ATOMICALLY in ONE `appendGuarded` transaction:
//   1. `project.announced` — carries the derived `projectId` slug, the `title`, and
//      the `description`;
//   2. `board.joined` — the announcer's membership in the new sub-board (first member).
// Both share the single transaction so AC #2's "nothing appended on conflict" holds
// atomically: if a uniqueness guard trips, NEITHER event lands.
//
// Uniqueness — DUAL guard (Story 3.1, Task 1 DECISION): AC #2 makes the TITLE the
// uniqueness key ("a title that already exists"). We ALSO guard the derived
// `project_id`, so two DISTINCT titles that slug to the SAME id (e.g. "Hello World"
// and "hello, world!") also reject with `PROJECT_EXISTS` rather than silently
// sharing a board id (which would corrupt the projection keyed by `projectId`). The
// guard `field` is the AT-REST (snake_case) payload key — `title` and `project_id`
// (NOT `projectId`) — because `appendGuarded` inspects the stored payload (see
// data-access/mapping.ts: `project.announced` → `{ project_id, title, description }`).
//
// This is board LOGIC, so it lives in core (not the thin MCP handler). It depends
// ONLY on the DataAccess port; the uniqueness-conflict signal is detected by its
// stable `code` discriminant (duck-typed), exactly like `register` — core must not
// import the data-access error class (the lint-enforced module boundary).
//
// `actor` is supplied by the caller (the MCP tool passes the session handle); core
// stays session-agnostic, mirroring `updateFocus`/`recordSeen`.

import { BoardError } from '../errors.js';
import { findProject } from './projection.js';
import { slugify } from './slug.js';

import type { DataAccess } from '../ports.js';
import type { Project } from './projection.js';

/** The stable discriminant the data-access adapter stamps on a uniqueness conflict. */
const UNIQUENESS_CONFLICT_CODE = 'UNIQUENESS_CONFLICT';

/** Input to {@link announceProject} (camelCase; the MCP boundary maps snake_case → this). */
export interface AnnounceProjectInput {
  /**
   * The project title. The MCP boundary's Zod schema has already enforced
   * non-empty + a length cap before this runs; the title is the uniqueness key for
   * `PROJECT_EXISTS` and the source the `projectId` slug is derived from (AR10).
   */
  title: string;
  /** The project description (boundary-validated non-empty + length-capped). */
  description: string;
}

/**
 * True when a value rejected by the DataAccess port is the adapter's uniqueness
 * conflict, identified by its stable `code`. Duck-typed: core must not import the
 * data-access package to get the concrete error class (the lint-enforced module
 * boundary), so it matches the documented public discriminant instead — identical
 * to `register`'s detector.
 */
function isUniquenessConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === UNIQUENESS_CONFLICT_CODE
  );
}

/**
 * Announce a new project and create its sub-board (AC #1/#2).
 *
 * Derives the `projectId` slug from `title` (AR10), then appends
 * `project.announced` + the announcer's `board.joined` in ONE `appendGuarded`
 * transaction, guarded for uniqueness on BOTH the title AND the derived
 * `project_id` (the dual guard). On a uniqueness conflict the transaction rolls
 * back (nothing appended) and this throws `BoardError('PROJECT_EXISTS')`. On
 * success it reads the project back through the projection so the returned record's
 * members/seq come from the ledger, with the announcer as the first member.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The announcing handle (the MCP tool supplies the session handle).
 * @param input The project `title` + `description` (boundary-validated).
 * @returns The announced {@link Project} (announcer as first member).
 * @throws BoardError `PROJECT_EXISTS` if the title or derived id already exists.
 */
export async function announceProject(
  dataAccess: DataAccess,
  actor: string,
  input: AnnounceProjectInput,
): Promise<Project> {
  const { title, description } = input;
  const projectId = slugify(title);

  try {
    await dataAccess.appendGuarded(
      [
        {
          type: 'project.announced',
          actor,
          payload: { projectId, title, description },
        },
        {
          type: 'board.joined',
          actor,
          payload: { projectId },
        },
      ],
      // Dual uniqueness guard, scoped to project.announced. The at-rest payload is
      // snake_case-keyed, so the fields are `title` and `project_id` (NOT projectId).
      [
        { type: 'project.announced', field: 'title', value: title },
        { type: 'project.announced', field: 'project_id', value: projectId },
      ],
    );
  } catch (err) {
    // An atomic guard tripped → the title or the derived id is taken; surface the
    // domain error. Nothing was appended (the transaction rolled back) — AC #2.
    if (isUniquenessConflict(err)) {
      throw new BoardError(
        'PROJECT_EXISTS',
        `A project with title "${title}" (id "${projectId}") already exists.`,
      );
    }
    // Anything else (e.g. StoreBusyError, an unexpected fault) propagates as-is.
    throw err;
  }

  // Read the just-announced project back so members/seq come from the ledger. Both
  // appended events carry this projectId, so the actor's own stream folds to the
  // record with the announcer as first member.
  const own = await dataAccess.eventsByActor(actor);
  const project = findProject(own, projectId);
  if (!project) {
    // Unreachable: we just appended the announcement + join for this actor. A miss
    // would mean the append did not persist or the read seam is broken — fail
    // loudly rather than return a fabricated record.
    throw new Error(
      `announceProject: just-announced project "${projectId}" not found in actor "${actor}"'s event stream.`,
    );
  }
  return project;
}
