// The projects directory projection (Story 3.1, Task 3 / AC #1).
//
// Folds the event stream into the projects directory: every `project.announced`
// becomes one project record, and every `board.joined` for that project adds a
// member. Derived state, NEVER stored (THE APPEND INVARIANT): callers re-fold (or
// fold a filtered read) every time they need the directory; there is no `projects`
// table and no `members` column anywhere. Mirrors `identity/projection.ts`.
//
// Ordering: the fold consumes events in `seq` order — the authoritative total order
// (`seq`, NEVER `createdAt`). The caller passes events already `seq`-ordered (every
// `DataAccess` read returns them so). The project record carries the announcing
// event's `seq` so Story 3.2 can list projects "ordered by seq" deterministically.
//
// ADDITIVE-by-design (Stories 3.3 / 3.4): the fold has extension seams the later
// project events slot into without reshaping anything:
//   - the `board.joined` branch already accretes members in join order — Story 3.3
//     (a second identity joins an existing board) needs no change here; a new
//     `board.joined` for an existing `projectId` simply appends to `members`.
//   - Story 3.4 (sub-board member directory with focus / last-seen) layers per-member
//     presence by JOINING this directory's membership against the identity projection;
//     it does not reshape the project record, so that lands as a separate read.
// This story folds `project.announced` (mints the record, announcer is first member
// via the Task-2 `board.joined`) + `board.joined` (accretes membership).

import type { Event } from '../events/event.js';

/**
 * One row of the projects directory — the folded project record. All camelCase
 * (the internal contract); the snake_case wire mapping lives at the MCP boundary.
 *
 * `members` is DERIVED from the `board.joined` stream for this project (the
 * announcer is the first member via the Task-2 join appended alongside
 * `project.announced`). `announcer` is the actor of the `project.announced` event.
 * `seq` is the announcing event's `seq` — the deterministic ordering key for Story
 * 3.2's "ordered by seq". None of this is a stored column.
 */
export interface Project {
  /** Slug id of the project (derived from the unique title) — the directory key. */
  projectId: string;
  /** Human-readable project title (the uniqueness key for PROJECT_EXISTS). */
  title: string;
  /** Project description. */
  description: string;
  /** The handle that announced the project (actor of `project.announced`). */
  announcer: string;
  /**
   * Member handles in join order. The announcer is first (the `board.joined`
   * appended atomically with `project.announced` by `announceProject`). Story 3.3
   * appends more as other identities join. Derived from `board.joined` events,
   * de-duplicated (a handle joining twice stays a single member).
   */
  members: string[];
  /** `seq` of this project's `project.announced` event — deterministic order key. */
  seq: number;
}

/**
 * Fold a `seq`-ordered event stream into the projects directory, keyed by
 * `projectId`. Pure: no I/O, deterministic for a given input.
 *
 * Contract: `events` MUST be ordered by `seq` ascending (every `DataAccess` read
 * guarantees this). A `Map` preserves first-announcement insertion order, so
 * iterating the result yields projects in announcement order (which equals `seq`
 * order; `Project.seq` is also carried for explicit sorting).
 *
 * A `board.joined` for an unknown project is ignored (no phantom project minted —
 * only `project.announced` creates a record). A duplicate `project.announced` for
 * the same `projectId` cannot occur (the dual `appendGuarded` guard in
 * `announceProject` forbids it); defensively, the FIRST announcement wins the
 * record and a later one does not clobber it.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @returns A `Map<projectId, Project>` — the projects directory.
 */
export function foldProjects(events: Event[]): Map<string, Project> {
  const directory = new Map<string, Project>();

  for (const event of events) {
    switch (event.type) {
      case 'project.announced': {
        const { projectId, title, description } = event.payload;
        // First announcement wins the record (the guard forbids a duplicate; this
        // is defensive so a stray later one cannot clobber title/seq/announcer).
        if (!directory.has(projectId)) {
          directory.set(projectId, {
            projectId,
            title,
            description,
            announcer: event.actor,
            members: [],
            seq: event.seq,
          });
        }
        break;
      }
      case 'board.joined': {
        const { projectId } = event.payload;
        const project = directory.get(projectId);
        // Ignore a join for an unknown project (mints no phantom). Accrete the
        // member in join order, de-duplicated (idempotent re-join stays one member).
        if (project && !project.members.includes(event.actor)) {
          project.members.push(event.actor);
        }
        break;
      }
      default:
        break;
    }
  }

  return directory;
}

/**
 * Look up a single project by its slug id from a `seq`-ordered event stream.
 * Convenience over {@link foldProjects} for the common "read one project back" case
 * (e.g. `announceProject` reading the just-announced record). Returns `undefined`
 * if no such project was announced.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param projectId The slug id to resolve.
 */
export function findProject(
  events: Event[],
  projectId: string,
): Project | undefined {
  return foldProjects(events).get(projectId);
}
