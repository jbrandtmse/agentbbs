// Project / sub-board slug derivation (Story 3.1, Task 1 / AR10).
//
// AR10 (architecture.md#Identifiers): a project / sub-board id is the SLUG of the
// project's unique title — lowercase `[a-z0-9]` words joined by `-`, mirroring the
// room-id convention (`calling-interface`). This helper is the single source of
// that derivation; `announceProject` derives `projectId` from the title through it.
//
// PURE + DETERMINISTIC: no I/O, no clock, no randomness. Given the same title it
// always yields the same slug, which is what makes the slug usable as the at-rest
// `project_id` payload key AND as an `appendGuarded` uniqueness guard value.
//
// Disambiguator policy (Story 3.1, Task 1 DECISION): this helper does NOT append a
// `-2`-style disambiguator. AC #2 makes the TITLE the uniqueness key, and
// `announceProject` ALSO guards the derived `project_id` (dual guard) — so two
// DISTINCT titles that slug to the SAME id surface `PROJECT_EXISTS` rather than
// silently sharing a board. The slug therefore stays a pure function of the title;
// collision handling lives in the op's guard, not here. (See announce-project.ts.)
//
// Unicode note: V1 folds only to ASCII `[a-z0-9]`. Accented / non-Latin characters
// that are not in `[a-z0-9]` after lowercasing collapse to separators (and so to
// `-`), exactly like punctuation. A title that is ENTIRELY non-`[a-z0-9]` slugs to
// the empty string — `slugify` returns `''` and the caller (the MCP boundary) is
// responsible for rejecting an empty title before core; `announceProject` guards on
// the derived id regardless, so an empty slug can never silently collide either.

/**
 * Derive a project / sub-board slug id from a human title (AR10).
 *
 * Algorithm: lowercase → replace every maximal run of non-`[a-z0-9]` characters
 * with a single `-` → strip a leading/trailing `-`. The result contains only
 * `[a-z0-9]` and single interior `-` separators (`"Calling Interface"` →
 * `"calling-interface"`, `"  Hello,  World! "` → `"hello-world"`).
 *
 * Pure and deterministic. Returns `''` for a title with no `[a-z0-9]` characters
 * (e.g. `"!!!"` or whitespace) — see the module note on empty slugs.
 *
 * @param title The project title to slugify.
 * @returns The lowercase-kebab slug id (possibly empty for a no-alphanumeric title).
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
