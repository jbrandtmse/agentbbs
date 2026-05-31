// Unit tests for the boundary error mapper (Story 2.1, Task 2 / AC #2).
//
// Verifies the closed-code contract directly: a BoardError round-trips its exact
// { code, message } into the structured CallToolResult; an unexpected (non-board)
// throw maps to a generic INTERNAL_ERROR result that leaks no internals and is
// distinguishable from a domain error.

import { describe, expect, it } from 'vitest';
import { BOARD_ERROR_CODES, BoardError } from '@agentbbs/core';

import {
  INTERNAL_ERROR,
  mapErrorToResult,
  readErrorPayload,
} from './error-map.js';

describe('mapErrorToResult', () => {
  it('maps a BoardError to an isError result carrying the exact { code, message }', () => {
    const error = new BoardError(
      'HANDLE_TAKEN',
      'handle "amelia" is already registered',
    );

    const result = mapErrorToResult(error);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: 'HANDLE_TAKEN',
      message: 'handle "amelia" is already registered',
    });
    // The code is a member of the closed, core-owned set.
    expect(BOARD_ERROR_CODES).toContain(result.structuredContent?.code);
  });

  it('round-trips the board code exactly (no remap/normalization)', () => {
    for (const code of BOARD_ERROR_CODES) {
      const result = mapErrorToResult(new BoardError(code, `msg for ${code}`));
      expect(result.structuredContent?.code).toBe(code);
      expect(result.structuredContent?.message).toBe(`msg for ${code}`);
    }
  });

  it('also serializes the payload as a JSON text content block', () => {
    const result = mapErrorToResult(
      new BoardError('LOGIN_UNKNOWN', 'no such handle'),
    );

    const textBlock = result.content.find((block) => block.type === 'text');
    expect(textBlock).toBeDefined();
    expect(JSON.parse((textBlock as { text: string }).text)).toEqual({
      code: 'LOGIN_UNKNOWN',
      message: 'no such handle',
    });
  });

  it('maps a plain Error to a generic INTERNAL_ERROR result that does not leak the message', () => {
    const result = mapErrorToResult(
      new Error('connect ECONNREFUSED 127.0.0.1:5432 secret-host'),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe(INTERNAL_ERROR);
    // The raw internal message must NOT appear anywhere in the wire result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('secret-host');
  });

  it('uses a non-board sentinel for unexpected errors (INTERNAL_ERROR is not a board code)', () => {
    expect(BOARD_ERROR_CODES).not.toContain(INTERNAL_ERROR as never);
  });

  it('maps a non-Error throw (string) to the generic INTERNAL_ERROR result', () => {
    const result = mapErrorToResult('boom');

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe(INTERNAL_ERROR);
  });

  it('readErrorPayload extracts the { code, message } from a mapped result', () => {
    const result = mapErrorToResult(new BoardError('ROOM_NOT_FOUND', 'gone'));
    expect(readErrorPayload(result)).toEqual({
      code: 'ROOM_NOT_FOUND',
      message: 'gone',
    });
  });
});
