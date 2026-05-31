// The uniform error model (Story 1.3, AC3).
//
// core throws `BoardError(code, message)`. Every client maps it to its own
// surface (MCP error result, CLI exit, JSON API body). The wire shape is uniform
// `{ code: SCREAMING_SNAKE, message }` — a CLOSED, versioned public contract:
// adding a code is additive; renaming/removing one is a breaking change.

/**
 * The closed set of error codes, in canonical declaration order. SCREAMING_SNAKE.
 * Single runtime source of truth; {@link BoardErrorCode} is derived from it so
 * the union and the runtime list cannot drift.
 *
 * Additively extensible (append new codes); renaming/removing is a breaking
 * change to the public error contract.
 */
export const BOARD_ERROR_CODES = [
  /** Handle already registered (registration uniqueness). */
  'HANDLE_TAKEN',
  /** Login referenced an unknown handle. */
  'LOGIN_UNKNOWN',
  /** Project title/id already exists. */
  'PROJECT_EXISTS',
  /** Actor is not a member of the board/room required for the action. */
  'NOT_A_MEMBER',
  /** Referenced room id does not exist. */
  'ROOM_NOT_FOUND',
  /**
   * Referenced sub-board (project_id) does not exist — join/post against an
   * unannounced board (Story 3.3 `join_board` is its first consumer). DISTINCT
   * from {@link ROOM_NOT_FOUND}: a sub-board (a project) and a room (an Epic 4
   * announcement/thread within a board) are separate concepts with separate
   * "not found" codes — do not conflate them.
   */
  'BOARD_NOT_FOUND',
  /** Message body exceeds the configured size cap. */
  'BODY_TOO_LARGE',
  /**
   * The action requires an established identity (register or login first); none
   * is set for this session. Reusable by every session-required tool (Story 2.4
   * `update_focus` is its first consumer; Epics 3–6 tools reuse it).
   */
  'NO_IDENTITY',
  /**
   * A referenced TARGET identity handle does not correspond to any registered
   * identity. Distinct from {@link LOGIN_UNKNOWN} (the SESSION actor's own handle
   * is unknown at login) and from {@link NOT_A_MEMBER} (the actor lacks membership/
   * participation): this is "the OTHER handle you named is not a registered
   * identity". Story 4.5 `add_participant` is its first consumer (pulling a peer
   * into a room by handle — an unregistered handle is rejected, nothing appended).
   *
   * ADDITIVE (Story 4.5): the closed set is additively extensible (adding a code is
   * non-breaking; renaming/removing is breaking — see the file header). The Story
   * 4.5 spec's Source-fact claim that this code already existed at `errors.ts:29`
   * was incorrect (line 29 is `BOARD_NOT_FOUND`'s doc; the set had no
   * `HANDLE_NOT_FOUND`). Its AC #2/#6 NAME this exact code for the target-unknown
   * case, distinct from `NOT_A_MEMBER`, so the faithful implementation ADDS it here
   * — the smallest, contract-sanctioned change — rather than overloading an
   * existing code. See the story's Dev Agent Record for the full rationale.
   */
  'HANDLE_NOT_FOUND',
] as const;

/**
 * The closed union of valid {@link BoardError} codes. Derived from
 * {@link BOARD_ERROR_CODES} so the union and the runtime tuple stay identical.
 */
export type BoardErrorCode = (typeof BOARD_ERROR_CODES)[number];

/**
 * The uniform error thrown by core. Carries a closed `code` plus a human-readable
 * `message`. Clients map `code` to their surface; the `{ code, message }` shape
 * is the versioned public error contract.
 *
 * `instanceof BoardError` is reliable: under the project's ES2023 target native
 * `class extends Error` wires the prototype chain correctly, and the explicit
 * `Object.setPrototypeOf` below is a defensive guard that also keeps `instanceof`
 * working should a consumer ever transpile this to an older target.
 */
export class BoardError extends Error {
  /** The closed, SCREAMING_SNAKE error code (the discriminant for clients). */
  readonly code: BoardErrorCode;

  constructor(code: BoardErrorCode, message: string) {
    super(message);
    // Defensive: guarantees `instanceof BoardError` across transpilation targets.
    Object.setPrototypeOf(this, BoardError.prototype);
    this.name = 'BoardError';
    this.code = code;
  }
}
