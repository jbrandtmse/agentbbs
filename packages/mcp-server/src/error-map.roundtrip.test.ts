// Round-trip + recovery tests for the boundary error mapper (Story 2.1, AC #2)
// — QA hardening.
//
// The dev's `error-map.test.ts` proves the forward mapping (BoardError /
// non-BoardError → CallToolResult) and that the board `code` round-trips. This
// file hardens the OTHER half of the documented public error contract:
//
//   - `readErrorPayload` recovers the payload from the JSON `text` block when a
//     client view has dropped `structuredContent` (the contract promises this
//     fallback — but it was never exercised; the existing test only reads the
//     happy `structuredContent` path).
//   - the two carriers (`structuredContent` and the `text` block) hold the
//     IDENTICAL payload (the contract's "both carry the identical payload").
//   - the content shape is exactly one `text` block of `{ code, message }`.
//   - `readErrorPayload` is total: it returns `undefined` (never throws) for a
//     success result, a malformed text block, or non-error content.
//   - non-`Error` throws of every shape (string / number / null / undefined /
//     plain object) all map to the INTERNAL_ERROR sentinel without leaking.

import { describe, expect, it } from 'vitest';
import { BoardError } from '@agentbbs/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  INTERNAL_ERROR,
  mapErrorToResult,
  readErrorPayload,
} from './error-map.js';

describe('error-map round-trip + recovery', () => {
  it('readErrorPayload recovers the payload from the text block when structuredContent is absent', () => {
    // Simulate a client/transport view that kept the content but dropped the
    // structured field — the documented fallback must still recover { code,
    // message } by parsing the JSON text block.
    const mapped = mapErrorToResult(new BoardError('NOT_A_MEMBER', 'denied'));
    const withoutStructured: CallToolResult = {
      isError: true,
      content: mapped.content,
    };
    expect(withoutStructured.structuredContent).toBeUndefined();

    expect(readErrorPayload(withoutStructured)).toEqual({
      code: 'NOT_A_MEMBER',
      message: 'denied',
    });
  });

  it('carries the IDENTICAL payload in both structuredContent and the text block', () => {
    const result = mapErrorToResult(
      new BoardError('BODY_TOO_LARGE', 'message body exceeds the cap'),
    );

    const textBlock = result.content.find((b) => b.type === 'text') as {
      text: string;
    };
    const fromText: unknown = JSON.parse(textBlock.text);

    // The structured carrier and the text carrier are byte-for-byte the same
    // payload object.
    expect(result.structuredContent).toEqual(fromText);
    expect(result.structuredContent).toEqual({
      code: 'BODY_TOO_LARGE',
      message: 'message body exceeds the cap',
    });
  });

  it('emits exactly one text content block (no extra/leaky content)', () => {
    const result = mapErrorToResult(new BoardError('PROJECT_EXISTS', 'dup'));
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('readErrorPayload returns undefined for a success (non-error) result without throwing', () => {
    const success: CallToolResult = {
      content: [{ type: 'text', text: 'all good' }],
    };
    expect(readErrorPayload(success)).toBeUndefined();
  });

  it('readErrorPayload returns undefined for a result whose text block is not JSON', () => {
    const garbled: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'not-json-at-all {' }],
    };
    expect(readErrorPayload(garbled)).toBeUndefined();
  });

  it('readErrorPayload returns undefined when there is no text block to parse', () => {
    const noText: CallToolResult = {
      isError: true,
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    };
    expect(readErrorPayload(noText)).toBeUndefined();
  });

  it('the INTERNAL_ERROR sentinel result is itself recoverable via readErrorPayload', () => {
    const result = mapErrorToResult(new Error('low-level cause'));
    const payload = readErrorPayload(result);
    expect(payload?.code).toBe(INTERNAL_ERROR);
    // The recovered message is the fixed internals-free text, not the cause.
    expect(payload?.message).not.toContain('low-level cause');
    expect(JSON.stringify(result)).not.toContain('low-level cause');
  });

  it.each([
    ['string', 'boom' as unknown],
    ['number', 42 as unknown],
    ['null', null as unknown],
    ['undefined', undefined as unknown],
    ['plain object', { secret: 'do-not-leak' } as unknown],
  ])(
    'maps a non-Error throw (%s) to the INTERNAL_ERROR sentinel without leaking it',
    (_label, thrown) => {
      const result = mapErrorToResult(thrown);
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.code).toBe(INTERNAL_ERROR);
      expect(JSON.stringify(result)).not.toContain('do-not-leak');
    },
  );
});
