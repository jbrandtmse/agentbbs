// Room-id base derivation (Story 4.1, Task 2 / AC #1, #5).
//
// A room id is the SLUG of the announcement subject (architecture.md#Identifiers,
// the `calling-interface` convention) plus a short disambiguator on collision. This
// helper derives ONLY the deterministic BASE — `slugify(subject)` — with one extra
// rule the project-id slug does not need: an empty slug falls back to the literal
// base `room`, so an all-punctuation / non-`[a-z0-9]` subject (e.g. `"!!!"`) still
// yields a non-empty base instead of `''` (AC #5).
//
// REUSE, do not duplicate: the slug algorithm is the single `slugify`
// (`../projects/slug.ts`); this wraps it. The two id families share one slug
// derivation so the convention cannot drift.
//
// Disambiguation is NOT done here. Appending `-2`/`-3` requires a LEDGER read (which
// ids already exist), and this helper is PURE — no I/O, no clock, no randomness —
// mirroring how `slug.ts` keeps collision handling out of the pure helper. The
// disambiguator-with-uniqueness-guard retry lives in the op (`post-announcement.ts`),
// exactly as `announceProject` keeps its uniqueness guard in the op, not in `slugify`.
//
// WHY a fallback base rather than rejecting an empty subject (contrast Story 3.1,
// where the MCP boundary REJECTS a title that slugs to empty): an announcement never
// rejects on the slug — it always creates a proto-room and disambiguates. Many
// announcements may share a subject (or have an unsluggable one); the id is allocated,
// not asserted-unique-by-the-author. So an empty slug yields a usable base here.

import { slugify } from '../projects/slug.js';

/**
 * The fallback base for a subject that slugs to the empty string (no `[a-z0-9]`
 * characters). A proto-room is ALWAYS created (AC #5), so the base must be non-empty;
 * `room` is the deterministic stand-in, disambiguated by the op (`room`, `room-2`, …).
 */
export const EMPTY_SUBJECT_ROOM_BASE = 'room';

/**
 * Derive the deterministic room-id BASE from an announcement subject (AC #1/#5).
 *
 * `slugify(subject)` — lowercase `[a-z0-9]` words joined by `-` — with the
 * empty-subject fallback to {@link EMPTY_SUBJECT_ROOM_BASE}: a subject with no
 * `[a-z0-9]` characters slugs to `''`, and this returns `room` instead so the base is
 * always non-empty.
 *
 * Pure and deterministic (no I/O). Does NOT disambiguate — the returned base is what
 * the op then makes globally unique via an `appendGuarded` retry (`base`, `base-2`, …).
 *
 * @param subject The announcement subject to derive a room-id base from.
 * @returns The non-empty room-id base (`slugify(subject)`, or `room` when empty).
 */
export function roomIdBase(subject: string): string {
  const slug = slugify(subject);
  return slug === '' ? EMPTY_SUBJECT_ROOM_BASE : slug;
}
