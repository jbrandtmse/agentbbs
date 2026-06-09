// Story 10.5, AC2 — QA SEAM coverage: the webview-state PRODUCER↔CONSUMER round-trip.
//
// The dev tests the two halves of the reload-restore contract in ISOLATION: serializer.test.ts
// proves `roomIdFromState` resolves a `{ roomId }` object (the CONSUMER side). The PRODUCER side —
// the bundle calling `acquireVsCodeApi().setState({ roomId })` on mount (main.tsx) — has NO test
// pinning its SHAPE. Nothing crosses the SEAM between them: nothing guarantees the EXACT shape the
// bundle PERSISTS is the EXACT shape the serializer RESOLVES on reload. A drift on either side (the
// bundle starts writing `{ room }`, or the serializer stops reading `roomId`) keeps every existing
// test GREEN yet silently breaks reload-restore (AR22): every restored panel deserializes to a
// no-op empty shell, the unread/identity state is lost, and the user's room tabs vanish on reload.
//
// Importing the real `main.tsx` to drive setState is too brittle at the unit tier (it imports the
// side-effecting ui-shared `.css` subpaths the test resolver can't load — that is exactly why the
// dev's inert test mounts `RoomApp.js`, NOT `main.js`). So this is a Rule-10 CONTENT-GUARD: it
// parses the bundle's ACTUAL `setState(...)` call out of main.tsx's source, reconstructs the
// persisted shape, and feeds it through the REAL `roomIdFromState` consumer — proving the producer's
// output IS the consumer's input. If main.tsx drifts to a key the serializer can't resolve, the
// reconstructed shape resolves to null and this fails. The MUTATION block proves non-vacuity.
//
// Pure node (no DOM, no vscode) — discoverable by ROOT `pnpm test` (Rule 8).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { roomIdFromState } from '../serializer.js';

const ROOM_ID = 'calling-interface';

/** The main.tsx bundle entry source — the PRODUCER of the persisted webview state. */
function mainTsxSource(): string {
  const path = fileURLToPath(new URL('./main.tsx', import.meta.url));
  return readFileSync(path, 'utf8');
}

describe('webview state round-trip — the bundle PERSISTS what the serializer RESOLVES (AC2 seam)', () => {
  it('main.tsx persists the state via acquireVsCodeApi().setState on mount (producer exists)', () => {
    const src = mainTsxSource();
    // The bundle MUST call setState on the acquired api — that is what VS Code hands back to the
    // serializer on reload. (getState/postMessage may also appear; setState is the load-bearing one.)
    expect(src).toMatch(/acquireVsCodeApi\s*\(\s*\)/u);
    expect(src).toMatch(/\.setState\s*\(/u);
  });

  it('the SHAPE main.tsx persists is resolvable by the serializer roomIdFromState (producer→consumer)', () => {
    const src = mainTsxSource();
    // Extract the object literal passed to setState(...). main.tsx writes `setState({ roomId })`
    // (shorthand) where `roomId` is the resolved room id — reconstruct that exact shape with a
    // concrete value and run it through the REAL consumer. This crosses the producer→consumer seam:
    // a future edit to a key the serializer can't read makes `keys` wrong → resolution fails.
    const m = src.match(/setState\s*\(\s*\{([^}]*)\}\s*\)/u);
    expect(
      m,
      'main.tsx must call setState with an object literal',
    ).not.toBeNull();
    const body = m![1];
    // The persisted object's keys (shorthand `roomId` or `roomId: x`). Reconstruct the shape with a
    // concrete room id for whichever key(s) the bundle writes.
    const keys = body
      .split(',')
      .map((part) => part.trim().split(':')[0]!.trim())
      .filter((k) => k.length > 0);
    expect(keys.length, 'setState persists at least one field').toBeGreaterThan(
      0,
    );
    const reconstructed: Record<string, string> = {};
    for (const k of keys) reconstructed[k] = ROOM_ID;

    // THE SEAM: the shape the producer writes must be resolvable by the real consumer.
    expect(
      roomIdFromState(reconstructed),
      `the serializer must resolve the room id from the persisted shape {${keys.join(', ')}}`,
    ).toBe(ROOM_ID);

    // And concretely: the contract today is `{ roomId }`.
    expect(keys).toContain('roomId');
    expect(roomIdFromState({ roomId: ROOM_ID })).toBe(ROOM_ID);
  });

  // -------------------------------------------------------------------------------------------
  // MUTATION (Rule 7 non-vacuity): a DRIFTED producer shape — what a careless main.tsx edit would
  // persist (`{ room }` / `{ id }` instead of `{ roomId }`) — must NOT resolve. If `roomIdFromState`
  // resolved an arbitrary key, the seam guard above would pass against a broken bundle and guard
  // nothing.
  // -------------------------------------------------------------------------------------------
  it('a drifted producer shape ({ room } / { id }) does NOT resolve — the seam guard is non-vacuous', () => {
    expect(roomIdFromState({ roomId: ROOM_ID })).toBe(ROOM_ID); // the correct shape resolves
    expect(roomIdFromState({ room: ROOM_ID })).toBeNull(); // a drift does not
    expect(roomIdFromState({ id: ROOM_ID })).toBeNull();
    expect(roomIdFromState({ roomId: 42 })).toBeNull(); // wrong value type
  });
});
