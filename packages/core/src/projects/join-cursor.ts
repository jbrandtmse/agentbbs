// The per-(identity, board) JOIN-CURSOR projection (Story 6.1, Task 2) — the per-board
// announcement FLOOR `check` uses so a newly-joined sub-board member is NOT flooded with a
// board's pre-join back-history. The analogue of Story 4.6's per-ROOM `roomJoinSeq`, for
// sub-board ANNOUNCEMENTS instead of room messages.
//
// `boardJoinSeq(events, projectId, handle)` derives the `seq` of `handle`'s EARLIEST
// `board.joined` for `projectId` — the moment they FIRST became a member of that sub-board.
// `board.joined` is appended whenever a handle joins a board: the announcer (via
// `announceProject`, atomically with `project.announced`), an explicit `join_board`, the
// auto-join a `reply` performs ("acting = joining", FR10), and the auto-join
// `add_participant` performs for the pulled-in target. So EVERY member has a `board.joined`
// and therefore a floor; a handle that never joined the board has NONE → `undefined`.
//
// WHY a DERIVED per-board floor (not a stored cursor): mirrors the Story 4.6 rationale. The
// join event (`board.joined`) is assigned the NEWEST `seq` at append, so its `seq` IS the
// ledger position at the instant of join — the floor for "what announcements are new since I
// joined this board." Deriving it keeps the ledger append-only-pure (THE APPEND INVARIANT —
// no new event type, no mutation) and needs no change to the join-writing ops (the floor
// derives from their already-appended `board.joined`). The stored per-identity `check` cursor
// (the `cursors` table) is a DISTINCT mechanism: it prevents re-showing SEEN announcements;
// this per-board floor prevents back-history FLOOD. `check` (Story 6.1) combines them as
// `seq > max(checkCursor, boardJoinSeq)` — exactly the room-side composition Story 4.6
// forward-declared, applied to announcements.
//
// EARLIEST wins: a handle that joined a board more than once (e.g. an idempotent re-join, or
// joined-then-replied) has their floor at the EARLIEST `board.joined` — the moment they first
// became a member — so nothing posted between their join and a later re-join is lost. (In
// practice a re-join is an idempotent no-op that appends nothing, but taking the MIN is
// correct regardless and matches `roomJoinSeq`.)
//
// STRICT `seq > floor` (the consumer's filter): the floor is the join EVENT's own `seq`, so
// "new for me" is `seq > floor` (strict). An announcement posted BEFORE the actor joined
// (lower `seq`) is excluded — no flood; the full back-history remains available on demand via
// `list_announcements`.
//
// Pure: no I/O, deterministic for a given input; derived state, NEVER stored (THE APPEND
// INVARIANT). Cross-board isolated: only `board.joined` whose payload `projectId` matches
// contribute (a join in board A sets NO floor in board B). `core` imports only the `Event`
// type — the lint-enforced module boundary.

import type { Event } from '../events/event.js';

/**
 * The per-(identity, board) JOIN CURSOR: the `seq` of `handle`'s EARLIEST `board.joined` for
 * `projectId` — i.e. their per-board announcement FLOOR for `check` (Story 6.1). Pure fold over
 * a `seq`-ordered event stream; DERIVED, never stored (THE APPEND INVARIANT).
 *
 * The earliest joining event is the MIN `seq` over every `board.joined` for `projectId` whose
 * `actor` is `handle`. A handle that never joined the board (no matching `board.joined` —
 * including a non-member who only browsed it) has no join position → `undefined`: `check`
 * (Story 6.1) surfaces a board's announcements ONLY to its members, so a non-member is simply
 * not in that board's `check` scope (the consumer gates on `!== undefined`, never `?? 0` — a
 * `0` floor would flood; mirrors the Story 4.6 room-side contract).
 *
 * Only events for THIS `projectId` contribute (cross-board isolation): a join in board A does
 * NOT set a floor in board B. The handle is matched verbatim (callers pass the already-canonical
 * lowercased handle, as `actor`s are stored canonical).
 *
 * Contract: `events` SHOULD be the `seq`-ordered stream (every `DataAccess` read guarantees
 * this), but the result is the MIN over matching `seq`s regardless, so correctness does not
 * depend on the input ordering. The join-event `seq` equals `maxSeq()` at the instant of that
 * append, so this derived value IS the "board cursor set to the current max `seq` on join" —
 * without a stored cursor.
 *
 * @param events The event stream (or a relevant slice), ordered by `seq` asc.
 * @param projectId The slug id of the sub-board whose join cursor (for `handle`) to derive.
 * @param handle The canonical handle whose per-board join `seq` to compute.
 * @returns The `seq` of `handle`'s earliest `board.joined` for `projectId`, or `undefined` if
 *   `handle` is not a member of the board.
 */
export function boardJoinSeq(
  events: Event[],
  projectId: string,
  handle: string,
): number | undefined {
  let earliest: number | undefined;

  // Track the MIN `seq` across every `board.joined` that makes `handle` a member of
  // `projectId`. Order-independent (we take the minimum), so this holds even if `events`
  // were not seq-sorted.
  for (const event of events) {
    if (
      event.type === 'board.joined' &&
      event.payload.projectId === projectId &&
      event.actor === handle
    ) {
      if (earliest === undefined || event.seq < earliest) {
        earliest = event.seq;
      }
    }
  }

  // `undefined` iff no joining event was seen — `handle` is not a member of `projectId`.
  return earliest;
}
