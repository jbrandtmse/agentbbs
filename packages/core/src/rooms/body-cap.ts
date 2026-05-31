// The message body-size cap (Story 5.1 / AC #2; NFR6 / AR7).
//
// "256 KB per message body" is a MEASURABLE, specified NFR — every `reply` (`room.replied`)
// and `post_announcement` (`announcement.posted`) body shares the same cap. This module is
// the SINGLE source of that limit + the guard both core ops call before they append.
//
// Two load-bearing decisions live here (Story 5.1 Design decisions 1-2):
//   1. The cap is a CORE check that throws `BoardError('BODY_TOO_LARGE')` — the closed,
//      versioned code (already in BOARD_ERROR_CODES). It is NOT a Zod `.max` boundary check:
//      a Zod rejection is an `InvalidParams` carrying NO closed `{code}` (Story 5.0 proved a
//      Zod rejection yields `readErrorPayload === undefined`), so the architecture's
//      `BODY_TOO_LARGE` contract can only be honored by raising the code from core, for every
//      client. The interim Zod char `.max` is therefore dropped (not lowered) at the tool
//      boundary so an over-cap body REACHES this check.
//   2. The cap measures UTF-8 BYTE length, NOT character count. "256 KB" is bytes; a
//      char-count cap would let a multi-byte (emoji/CJK) body exceed 256 KB on disk, or
//      wrongly reject a long-but-small ASCII body. `Buffer.byteLength(body, 'utf8')` is the
//      exact at-rest UTF-8 size.
//
// Pure, no I/O. `Buffer.byteLength` is a Node BUILTIN (not a client or better-sqlite3 import
// — the module-boundary lint/intent forbids those, not a Node global used for pure
// computation). core compiles WITHOUT `@types/node` (its tsconfig leaves `types` unset and
// `node_modules/@types/node` is not in core's pnpm closure — core declares no Node
// dependency, deliberately keeping `fs`/`process`/better-sqlite3 types unreachable). So
// rather than pull ALL Node types into core (which `"types": ["node"]` or a triple-slash
// reference would), we declare the SINGLE builtin this module uses. This is the minimal
// type surface that honors the boundary: ONLY `Buffer.byteLength` is visible, nothing else
// of Node. The runtime `Buffer` is Node's real global (the unit tests exercise it directly).

import { BoardError } from '../errors.js';

/**
 * Minimal ambient type for the ONE Node builtin this module uses (`Buffer.byteLength`), so
 * core need not depend on `@types/node` (which would expose all of Node — `fs`, `process`,
 * etc. — and erode the module boundary). Matches the real `Buffer.byteLength(string, 'utf8')`
 * signature; the runtime value is Node's global `Buffer`.
 */
declare const Buffer: {
  byteLength(string: string, encoding: 'utf8'): number;
};

/**
 * The maximum allowed message-body size, in UTF-8 bytes: 256 KB (`256 * 1024 = 262144`).
 *
 * The formal NFR6/AR7 body cap. A body whose UTF-8 byte length is `<= MAX_BODY_BYTES` is
 * accepted; strictly greater is rejected with `BODY_TOO_LARGE`. KiB (1024-based), matching
 * the "256 KB" the architecture commits to.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Assert a message body is within {@link MAX_BODY_BYTES} (AC #2). The cap is on the body's
 * UTF-8 BYTE length (`Buffer.byteLength(body, 'utf8')`), NOT its character count, so a
 * multi-byte (emoji/CJK) body is measured by its true at-rest size.
 *
 * Called by the body-bearing core ops (`reply`, `postAnnouncement`) BEFORE any append, so an
 * over-cap body appends NOTHING (THE APPEND INVARIANT — the throw precedes `dataAccess.append`).
 *
 * @param body The message body to check (verbatim; this never transforms it).
 * @throws {BoardError} `BODY_TOO_LARGE` iff `Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES`.
 *   The message states the cap and the actual size so a client can surface a useful diagnostic.
 */
export function assertBodyWithinCap(body: string): void {
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength > MAX_BODY_BYTES) {
    throw new BoardError(
      'BODY_TOO_LARGE',
      `Message body is ${byteLength} bytes, exceeding the ${MAX_BODY_BYTES}-byte (256 KB) cap.`,
    );
  }
}
