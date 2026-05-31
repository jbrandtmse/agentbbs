// The boundary error mapper (Story 2.1, AC #2).
//
// core throws `BoardError(code, message)` with a CLOSED, core-owned `code`
// (BOARD_ERROR_CODES). This module maps a caught error into the MCP wire surface:
// a `CallToolResult` with `isError: true` carrying the uniform `{ code, message }`
// payload. This is the ONE place the closed-code error contract meets the MCP
// transport — handlers stay thin and never build error results themselves.
//
// WHY map explicitly (vs. letting the SDK turn a thrown handler error into an
// isError result): the SDK's catch-all (`createToolError`) keeps ONLY the
// `error.message` and drops the `code` (see @modelcontextprotocol/sdk
// server/mcp.js). The closed-code contract REQUIRES the `code` survive to the
// client, so `registerCoreTool` catches the error and RETURNS this mapped result
// rather than rethrowing.
//
// Wire representation (the public error contract — chosen and fixed here):
//   - `structuredContent: { code, message }` — the machine-readable payload.
//   - one `text` content block holding `JSON.stringify({ code, message })` — so a
//     human/LLM reading the content (and any client that ignores structuredContent)
//     still sees the same `{ code, message }`.
//   Both carry the IDENTICAL payload. `code`/`message` are already lowercase
//   single-word field names, so the snake_case wire boundary is a no-op for them
//   (no camel↔snake transform needed); the `code` VALUE is SCREAMING_SNAKE.

import { BoardError } from '@agentbbs/core';
import type { BoardErrorCode } from '@agentbbs/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The non-board sentinel `code` for an UNEXPECTED (non-`BoardError`) failure.
 *
 * Deliberately NOT a member of {@link BOARD_ERROR_CODES} — the closed board set
 * is owned by `core` and must not be widened here. A client can therefore
 * distinguish a known domain error (board code) from an internal fault
 * (`INTERNAL_ERROR`) purely by inspecting `code`.
 */
export const INTERNAL_ERROR = 'INTERNAL_ERROR';

/** A fixed, internals-free message for unexpected failures (never leaks the cause). */
const INTERNAL_ERROR_MESSAGE = 'An internal error occurred.';

/**
 * The uniform error payload carried on the wire: `{ code, message }`.
 *
 * `code` is either a closed {@link BoardErrorCode} (a mapped domain error) or the
 * {@link INTERNAL_ERROR} sentinel (an unexpected fault).
 */
export interface ErrorPayload {
  readonly code: BoardErrorCode | typeof INTERNAL_ERROR;
  readonly message: string;
}

/**
 * Build the `CallToolResult` (the MCP error surface) for a given error payload.
 * Carries the payload in BOTH `structuredContent` and a JSON `text` block so the
 * representation is uniform regardless of how a client reads the result.
 */
function toErrorResult(payload: ErrorPayload): CallToolResult {
  return {
    isError: true,
    structuredContent: { code: payload.code, message: payload.message },
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/**
 * Map a caught error to the structured MCP error result.
 *
 * - A {@link BoardError} maps to `{ code, message }` with the code carried through
 *   EXACTLY (the closed-code contract; AC #2).
 * - Anything else (a plain `Error`, a thrown string, etc.) maps to a generic
 *   {@link INTERNAL_ERROR} result that does NOT leak the underlying message or any
 *   internals, and is distinguishable from a domain error by its non-board `code`.
 *
 * @param error The value thrown by the core delegate (or anywhere in the handler).
 */
export function mapErrorToResult(error: unknown): CallToolResult {
  if (error instanceof BoardError) {
    return toErrorResult({ code: error.code, message: error.message });
  }
  return toErrorResult({
    code: INTERNAL_ERROR,
    message: INTERNAL_ERROR_MESSAGE,
  });
}

/**
 * Read the `{ code, message }` payload back out of a mapped error result.
 *
 * Prefers `structuredContent`; falls back to parsing the JSON `text` block so the
 * payload is recoverable even from a client view that drops structured content.
 * Returns `undefined` if the result carries no recoverable error payload.
 */
export function readErrorPayload(
  result: CallToolResult,
): ErrorPayload | undefined {
  const structured = result.structuredContent;
  if (
    structured &&
    typeof structured.code === 'string' &&
    typeof structured.message === 'string'
  ) {
    return {
      code: structured.code as ErrorPayload['code'],
      message: structured.message,
    };
  }

  const textBlock = result.content.find(
    (block): block is { type: 'text'; text: string } => block.type === 'text',
  );
  if (!textBlock) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(textBlock.text);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      'message' in parsed &&
      typeof (parsed as Record<string, unknown>).code === 'string' &&
      typeof (parsed as Record<string, unknown>).message === 'string'
    ) {
      const obj = parsed as { code: string; message: string };
      return { code: obj.code as ErrorPayload['code'], message: obj.message };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
