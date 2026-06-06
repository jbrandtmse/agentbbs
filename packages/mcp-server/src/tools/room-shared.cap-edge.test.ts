// Length cap-edge unit test for the shared `roomIdSchema` (room-shared.ts).
//
// Closes the `5.1-roomid-cap-edge` debt carried since Story 4.3 / 5.1: the
// `roomIdSchema` has a `.max(ROOM_ID_MAX_LENGTH)` (200) defensive boundary cap, but
// no test pinned its EDGE — that a `room_id` of exactly the cap length is accepted
// while one of cap+1 is rejected. A `.safeParse` unit test is sufficient and matches
// the schema's role (a boundary validator), so no full per-tool integration call is
// needed; `roomIdSchema` is the single source of truth reused by `reply`,
// `add_participant`, `read_room`, and `read_contract`, so pinning it here pins all of
// them. Pure (no DOM, no ledger) — runs in the node project.

import { describe, expect, it } from 'vitest';

import { ROOM_ID_MAX_LENGTH, roomIdSchema } from './room-shared.js';

/**
 * Build a syntactically VALID slug `room_id` of exactly `length` characters, so the
 * ONLY thing under test is the length cap (not the slug regex). An all-`a` string is a
 * valid slug (lowercase alphanumerics, no hyphens), so its length is the sole variable.
 */
function slugOfLength(length: number): string {
  return 'a'.repeat(length);
}

describe('roomIdSchema — length cap edge (ROOM_ID_MAX_LENGTH)', () => {
  it('the cap constant is 200 (the documented defensive bound)', () => {
    expect(ROOM_ID_MAX_LENGTH).toBe(200);
  });

  it('ACCEPTS a room_id of exactly the cap length (at-cap = 200)', () => {
    const atCap = slugOfLength(ROOM_ID_MAX_LENGTH);
    expect(atCap.length).toBe(200);
    const result = roomIdSchema.safeParse(atCap);
    expect(result.success).toBe(true);
  });

  it('REJECTS a room_id of cap+1 length (over-cap = 201)', () => {
    const overCap = slugOfLength(ROOM_ID_MAX_LENGTH + 1);
    expect(overCap.length).toBe(201);
    const result = roomIdSchema.safeParse(overCap);
    expect(result.success).toBe(false);
  });

  // QA boundary-completion (Story 11.0): the cap is a length RANGE `[1, 200]`, so the
  // EDGE has two ends. The three cases above pin the upper edge (200 in / 201 out); the
  // two below pin the LOWER edge and the just-inside point so the upper-cap accept above
  // cannot pass merely because the schema accepts everything. These exercise the same
  // single source-of-truth `roomIdSchema` — genuinely additive, no new surface.

  it('ACCEPTS a room_id of cap-1 length (just inside = 199)', () => {
    const underCap = slugOfLength(ROOM_ID_MAX_LENGTH - 1);
    expect(underCap.length).toBe(199);
    const result = roomIdSchema.safeParse(underCap);
    expect(result.success).toBe(true);
  });

  it('REJECTS an empty room_id (the lower length bound)', () => {
    // Empty is rejected by the schema's length floor / slug regex (the `.min(1)` and the
    // `^[a-z0-9]+...` both forbid a zero-length id) — the observable contract is that a
    // zero-length room_id never reaches core, which this pins regardless of which
    // constraint enforces it.
    const result = roomIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});
