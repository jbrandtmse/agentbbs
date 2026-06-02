// The `joinBoard` board operation (Story 3.3, Task 2 / AC #1, #2, #3, #4).
//
// Joining a sub-board makes `actor` a member — able to post (Story 3.5's write gate)
// and appear in the sub-board's directory (Story 3.4). It appends ONE `board.joined`
// event ({ projectId }) for the actor, after asserting the board exists.
//
// Unlike `announceProject` (which uses an ATOMIC `appendGuarded` — a uniqueness
// claim, where a concurrent duplicate MUST be rejected), `joinBoard` is a plain
// existence-check-then-`append`, and the two need NOT share a transaction:
//   - Projects are APPEND-ONLY and NEVER disappear (THE APPEND INVARIANT — no DELETE
//     against events). A board that EXISTS at the existence check therefore still
//     exists at the append, with no window in which it could vanish. So the check and
//     the append do not need to be atomic with each other.
//   - Membership is NOT uniqueness-constrained: a benign race in which two concurrent
//     joins both append a `board.joined` for the same actor is harmless — the
//     projection DE-DUPLICATES members (a handle joining twice stays a single member,
//     see projection.ts). So we need no atomic claim to keep membership a set.
// This is why a plain `append` after `findProject` is correct here, where
// `announceProject` needs the atomic dual guard.
//
// Idempotent re-join (DECISION 2 / AC #4): membership is a STATE, not a presence ping.
// If `actor` is ALREADY a member, this returns the project unchanged WITHOUT appending
// a redundant `board.joined` — keeping the ledger clean and "am I a member" unambiguous.
// (Append-only is preserved: we simply do not append a redundant event; nothing is
// mutated or deleted. The projection's de-dup is the defensive backstop for a race.)
//
// This is board LOGIC, so it lives in core (not the thin MCP handler). It depends ONLY
// on the DataAccess port. `actor` is supplied by the caller (the MCP tool passes the
// session handle); core stays session-agnostic, mirroring `announceProject`/`updateFocus`.

import { BoardError } from '../errors.js';
import { findProject } from './projection.js';

import type { DataAccess } from '../ports.js';
import type { Project } from './projection.js';

/**
 * Join `actor` to the sub-board `projectId` (AC #1/#2/#3/#4).
 *
 * Reads the full stream and folds it: if no project with `projectId` was ever
 * announced, throws `BoardError('BOARD_NOT_FOUND')` and appends NOTHING (AC #2). If
 * `actor` is already a member, returns the project unchanged — an idempotent no-op,
 * NO redundant `board.joined` (DECISION 2 / AC #4). Otherwise appends ONE `board.joined`
 * ({ projectId }) for `actor` via plain `append` (membership is not uniqueness-
 * constrained; the projection de-dups a benign double-join), then reads the project
 * back through the projection so the returned record's `members` come from the ledger
 * (now including `actor`). Joining a second, different board makes `actor` a member of
 * BOTH (AC #3) — each call appends an independent `board.joined`.
 *
 * @param dataAccess The persistence port (the only dependency).
 * @param actor The joining handle (the MCP tool supplies the session handle).
 * @param projectId The slug id of the sub-board to join.
 * @returns The joined {@link Project} (its `members` include `actor`).
 * @throws BoardError `BOARD_NOT_FOUND` if no such project was announced.
 */
export async function joinBoard(
  dataAccess: DataAccess,
  actor: string,
  projectId: string,
): Promise<Project> {
  // Existence check. Read the full stream and fold it for this board. A board never
  // disappears (append-only), so its existence here holds through the later append —
  // no transaction spanning the check and the append is needed (contrast
  // announceProject's atomic uniqueness claim).
  const events = await dataAccess.eventsSince(0);
  const existing = findProject(events, projectId);
  if (!existing) {
    throw new BoardError(
      'BOARD_NOT_FOUND',
      `No such sub-board: "${projectId}". It was never announced.`,
    );
  }

  // Idempotent re-join: already a member → return unchanged, NO redundant append
  // (DECISION 2 / AC #4). Membership is a state, not a repeatable ping.
  if (existing.members.includes(actor)) {
    return existing;
  }

  // Append the actor's membership. Plain `append` (not appendGuarded): membership is
  // not uniqueness-constrained, and the projection de-dups a benign concurrent double
  // join, so no atomic claim is required.
  await dataAccess.append([
    { type: 'board.joined', actor, payload: { projectId } },
  ]);

  // Read the project back through the projection so `members` comes from the ledger,
  // now including `actor`.
  const after = await dataAccess.eventsSince(0);
  const joined = findProject(after, projectId);
  if (!joined) {
    // Unreachable: the board existed at the check, append-only means it still exists,
    // and we just appended this actor's join. A miss would mean the append did not
    // persist or the read seam is broken — fail loudly rather than fabricate a record.
    throw new Error(
      `joinBoard: just-joined sub-board "${projectId}" not found after appending board.joined for "${actor}".`,
    );
  }
  return joined;
}
