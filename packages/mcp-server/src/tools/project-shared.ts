// Shared project-tool boundary helpers (Story 3.1).
//
// The `announce_project` (3.1) tool — and the project tools that follow in Stories
// 3.2–3.4 (`list_projects`, `join_board`, the sub-board directory) — share the same
// MCP boundary concerns: the project-field Zod validators (title / description, with
// length caps) and the camelCase→snake_case project wire mapping. Extracting them
// here keeps the thin tools to ONE source of truth so the project contract and wire
// shape cannot drift across the epic.
//
// This is boundary plumbing (Zod shapes + a field rename), NOT board logic — it
// stays in the mcp-server layer. core never sees snake_case (the project wire rule).

import { z } from 'zod';

import type { Project } from '@agentbbs/core';

/**
 * Max project-title length — a defensive upper bound so a pathologically long title
 * is rejected at the boundary rather than stored (and rather than producing a
 * pathological slug). A sanity cap, not a product constraint.
 */
export const PROJECT_TITLE_MAX_LENGTH = 200;

/**
 * Max project-description length — a sane defensive upper bound. A description is a
 * short "what this board is for" statement, not a document; this is a sanity cap.
 */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * The shared Zod validator for a `title` wire param: a non-empty, length-bounded
 * string that ALSO contains at least one slug-able character. The SDK validates
 * against this and rejects invalid input BEFORE the delegate runs, so the derived
 * slug is never empty on the success path.
 *
 * The `.refine` closes a gap that `.min(1)` alone leaves open: `.min(1)` only
 * rejects the empty/missing raw string, but a title made entirely of non-`[a-z0-9]`
 * characters (e.g. `"!!!"`, `"日本語"`, whitespace) PASSES `.min(1)` yet `slugify`
 * collapses it to `''` — minting a project with an empty, unaddressable `project_id`
 * (AR10 / scrutiny item (g): "without producing an empty or unsafe id"). A title
 * with at least one ASCII alphanumeric always slugs to a non-empty id; the predicate
 * mirrors `slugify`'s charset (`core/src/projects/slug.ts`) so the boundary cannot
 * accept a title that core would slug to empty. (core also guards the derived
 * `project_id`, but that is a uniqueness guard, not an emptiness guard — this is the
 * emptiness gate the slug note delegates to the boundary.)
 */
export const projectTitleSchema = z
  .string()
  .min(1)
  .max(PROJECT_TITLE_MAX_LENGTH)
  .refine((title) => /[a-z0-9]/i.test(title), {
    message:
      'title must contain at least one alphanumeric character (it derives the project id)',
  });

/**
 * The shared Zod validator for a `description` wire param: a non-empty,
 * length-bounded string. The SDK validates against this and rejects invalid input
 * (missing/empty description) BEFORE the delegate runs.
 */
export const projectDescriptionSchema = z
  .string()
  .min(1)
  .max(PROJECT_DESCRIPTION_MAX_LENGTH);

/**
 * Max project-id length — mirrors the title cap (an id is derived from a title and is
 * never longer than its source). A defensive boundary so a pathologically long id is
 * rejected rather than scanned against the ledger.
 */
export const PROJECT_ID_MAX_LENGTH = PROJECT_TITLE_MAX_LENGTH;

/**
 * The shared Zod validator for a `project_id` wire param (Story 3.3, `join_board` is
 * its first consumer): a non-empty, length-bounded string in the slug charset. A
 * `project_id` is a slug `slugify` produces — lowercase ASCII alphanumerics joined by
 * single hyphens — so it matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The SDK validates
 * against this and rejects an invalid id (empty, uppercase, leading/trailing/double
 * hyphen, or non-slug characters) BEFORE the delegate runs, so core only ever sees a
 * well-formed id (an unknown-but-well-formed id is the BOARD_NOT_FOUND case core owns).
 */
export const projectIdSchema = z
  .string()
  .min(1)
  .max(PROJECT_ID_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'project_id must be a slug: lowercase alphanumerics separated by single hyphens',
  });

/** The snake_case project payload returned on the wire (camelCase mapped here). */
export interface ProjectWire {
  project_id: string;
  title: string;
  description: string;
  announcer: string;
  /** Member handles in join order (announcer first). A real array on the wire. */
  members: string[];
}

/** Map the camelCase core {@link Project} to its snake_case wire object. */
export function projectToWire(project: Project): ProjectWire {
  return {
    project_id: project.projectId,
    title: project.title,
    description: project.description,
    announcer: project.announcer,
    members: [...project.members],
  };
}
