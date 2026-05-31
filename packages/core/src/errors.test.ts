// Error model contract (Story 1.3, AC3).
//
// Verifies BoardError is throwable/catchable with reliable `instanceof`, exposes
// `code` + `message`, and that the closed code set contains the required codes.

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BOARD_ERROR_CODES,
  BoardError,
  type BoardErrorCode,
} from './errors.js';

describe('BoardError (AC3)', () => {
  it('is an Error subclass — instanceof works for both BoardError and Error', () => {
    const err = new BoardError('HANDLE_TAKEN', 'handle "alice" is taken');
    expect(err).toBeInstanceOf(BoardError);
    expect(err).toBeInstanceOf(Error);
  });

  it('is throwable and catchable as BoardError with code + message', () => {
    try {
      throw new BoardError('ROOM_NOT_FOUND', 'no such room: #ghost');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (caught: any) {
      expect(caught).toBeInstanceOf(BoardError);
      expect(caught.code).toBe('ROOM_NOT_FOUND');
      expect(caught.message).toBe('no such room: #ghost');
      expect(caught.name).toBe('BoardError');
    }
  });

  it('exposes a typed, readonly code', () => {
    const err = new BoardError('BODY_TOO_LARGE', 'body exceeds 256 KB');
    expectTypeOf(err.code).toEqualTypeOf<BoardErrorCode>();
    expect(err.code).toBe('BODY_TOO_LARGE');
  });

  it('the closed code set contains every required AC3 code', () => {
    const required = [
      'HANDLE_TAKEN',
      'LOGIN_UNKNOWN',
      'PROJECT_EXISTS',
      'NOT_A_MEMBER',
      'ROOM_NOT_FOUND',
      'BODY_TOO_LARGE',
      // Story 2.4 (additive): the reusable "no established identity" code for
      // every session-required tool (update_focus is its first consumer).
      'NO_IDENTITY',
      // Story 3.3 (additive): the referenced sub-board (project_id) does not
      // exist — join/post against an unannounced board (join_board is its first
      // consumer). Distinct from ROOM_NOT_FOUND (Epic 4 rooms).
      'BOARD_NOT_FOUND',
      // Story 4.5 (additive): a referenced TARGET identity handle is not
      // registered — add_participant by an unknown handle (add_participant is its
      // first consumer). Distinct from LOGIN_UNKNOWN (the session actor's own
      // handle at login) and NOT_A_MEMBER (actor lacks participation).
      'HANDLE_NOT_FOUND',
    ] as const;
    for (const code of required) {
      expect(BOARD_ERROR_CODES).toContain(code);
    }
  });

  it('has no duplicate codes', () => {
    expect(new Set(BOARD_ERROR_CODES).size).toBe(BOARD_ERROR_CODES.length);
  });

  it('BoardErrorCode is the union derived from BOARD_ERROR_CODES', () => {
    expectTypeOf<
      (typeof BOARD_ERROR_CODES)[number]
    >().toEqualTypeOf<BoardErrorCode>();
    // @ts-expect-error 'NOPE' is not a member of the closed code set.
    const bad: BoardErrorCode = 'NOPE';
    expect(bad).toBe('NOPE');
  });
});
