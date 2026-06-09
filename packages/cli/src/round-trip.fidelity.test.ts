// Story 11.4 — the CANONICAL FR34 round-trip fidelity test.
//
// Rule 3 / project-context "Testing": runs over REAL `createDataAccess` better-sqlite3 ledgers in
// an OS temp dir — NOTHING is mocked. Two DISTINCT db files (source + restored) under os.tmpdir(),
// cleaned in `finally`. The canonical proof of FR34: seed a comprehensive SOURCE board (all 10
// `EVENT_TYPES` + a NON-ZERO stored cursor + a live contract) → export it via the Story-11.2 codec
// → import the archive into a SEPARATE, FRESH, EMPTY board via Story-11.3's `runImport` → read
// BOTH boards' derived state back through the CORE PROJECTIONS and assert EVERY category is
// IDENTICAL (identities / membership / rooms / messages / reactions / contracts / cursors).
//
// Display-only `createdAt`/`lastSeen` are EXCLUDED from the comparison — replay re-assigns
// `createdAt` at import-time; the carve-out is the Story-11.3 AC4 ratified decision (documented on
// `deriveComparableState`). Everything compared is seq-keyed and reproduces 1:1.
//
// NON-VACUITY (AC4 / Rule 7): the comparison MUST DISCRIMINATE a real round-trip break. The
// "discriminates" tests below introduce a fidelity-breaking mutation to the ARCHIVE before import
// (drop an event / skip the cursor / alter a body) and assert the per-category comparison goes RED
// — proving the comparison is not vacuously loose. The mutations touch only the archive TEXT, never
// production code (AC5: `git diff HEAD -- packages/core packages/mcp-server packages/cli/src` shows
// only the new test + fixtures).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EVENT_TYPES } from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHeader, parseArchive } from './archive.js';
import { runImport } from './import.js';
import {
  deriveComparableState,
  exportToText,
  seedComprehensiveBoard,
} from './round-trip.fixtures.js';

import type { ComparableState } from './round-trip.fixtures.js';
import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-roundtrip-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed a SOURCE board at `source.db`, snapshot its comparable state, and export it to NDJSON.
 * Returns the source snapshot + the archive text + the event count. Closes the source handle.
 */
async function buildSource(): Promise<{
  sourceState: ComparableState;
  archiveText: string;
  eventCount: number;
}> {
  const srcDb = join(dir, 'source.db');
  const src: DataAccessHandle = createDataAccess({ dbPath: srcDb });
  let sourceState: ComparableState;
  let eventCount: number;
  try {
    await seedComprehensiveBoard(src);
    sourceState = await deriveComparableState(src);
    eventCount = (await src.eventsSince(0)).length;
  } finally {
    src.close();
  }
  const archiveText = await exportToText(srcDb);
  return { sourceState, archiveText, eventCount };
}

/** Import `archiveText` into a FRESH empty `restored.db` and snapshot its comparable state. */
async function importAndDerive(archiveText: string): Promise<ComparableState> {
  const destDb = join(dir, 'restored.db');
  await runImport(
    { dbPath: destDb, inPath: '-' },
    { readStdin: () => archiveText },
  );
  const dest: DataAccessHandle = createDataAccess({ dbPath: destDb });
  try {
    return await deriveComparableState(dest);
  } finally {
    dest.close();
  }
}

describe('FR34 round-trip fidelity — export → import → identical derived state (AC1, AC2, AC3)', () => {
  it('MARQUEE — every derived-state category is IDENTICAL between source and restored', async () => {
    const { sourceState, archiveText, eventCount } = await buildSource();

    // AC2 sanity: the source seed exercised ALL 10 EVENT_TYPES + a NON-ZERO cursor + a live
    // contract — so the round-trip proves fidelity across the whole vocabulary, not a subset.
    const archive = parseArchive(archiveText);
    const seededTypes = new Set(archive.events.map((e) => e.type));
    for (const type of EVENT_TYPES) expect(seededTypes.has(type)).toBe(true);
    expect(seededTypes.size).toBe(EVENT_TYPES.length);
    expect(archive.readState).toHaveLength(1);
    expect(archive.readState[0]!.cursor).toBeGreaterThan(0); // NON-ZERO cursor (the carve-out)
    const sourceContracts = sourceState.contracts.filter(
      (c) => c.contract !== null,
    );
    expect(sourceContracts.length).toBeGreaterThan(0); // a live contract exists in the source

    // QA-HARDENED non-emptiness guards (so NO compared category is a trivial []===[] that proves
    // nothing). Every derived-state category — including BOTH halves of `rooms` (proto + activated)
    // — must be NON-EMPTY in the source, or its equality assert below is vacuous.
    const protoRooms = sourceState.rooms.flatMap((r) => r.announcements);
    const activatedRooms = sourceState.rooms.flatMap((r) => r.activated);
    expect(sourceState.identities.length).toBeGreaterThanOrEqual(2);
    expect(
      sourceState.membership.reduce((n, m) => n + m.members.length, 0),
    ).toBeGreaterThanOrEqual(1);
    expect(protoRooms.length).toBeGreaterThanOrEqual(1); // ≥1 proto-room (listAnnouncements)
    expect(activatedRooms.length).toBeGreaterThanOrEqual(1); // ≥1 activated room (listRooms)
    expect(sourceState.messages.length).toBeGreaterThanOrEqual(1);
    expect(
      sourceState.reactions.filter((r) => r.liveReactors.length > 0).length,
    ).toBeGreaterThanOrEqual(1); // ≥1 LIVE reaction
    expect(
      sourceState.cursors.filter((c) => c.cursor > 0).length,
    ).toBeGreaterThanOrEqual(1); // ≥1 NON-ZERO cursor

    const restoredState = await importAndDerive(archiveText);

    // AC3 — PER-CATEGORY equality (so a break LOCALIZES to one category), then the whole snapshot.
    expect(restoredState.identities).toEqual(sourceState.identities);
    expect(restoredState.membership).toEqual(sourceState.membership);
    expect(restoredState.rooms).toEqual(sourceState.rooms);
    expect(restoredState.messages).toEqual(sourceState.messages);
    expect(restoredState.reactions).toEqual(sourceState.reactions);
    expect(restoredState.contracts).toEqual(sourceState.contracts);
    expect(restoredState.cursors).toEqual(sourceState.cursors);
    // The whole snapshot too (catches any category not enumerated above).
    expect(restoredState).toEqual(sourceState);

    // The restored board's stored read-state cursor (the carve-out) is NON-ZERO and matches.
    const bob = restoredState.cursors.find((c) => c.handle === 'bob');
    expect(bob).toBeDefined();
    expect(bob!.cursor).toBeGreaterThan(0);

    // (Belt-and-braces: the event count matched too — the archive replayed in full.)
    expect(eventCount).toBeGreaterThan(0);
  });

  it('the cursors category is NON-ZERO and explicitly compared (the read-state carve-out)', async () => {
    // The cursor category is the one most likely to silently break (it rides a SEPARATE table, not
    // the event ledger), so it gets its own focused assertion: a non-zero stored cursor in the
    // source round-trips to the SAME non-zero value in the restored board.
    const { sourceState, archiveText } = await buildSource();
    const sourceBob = sourceState.cursors.find((c) => c.handle === 'bob')!;
    expect(sourceBob.cursor).toBeGreaterThan(0);

    const restoredState = await importAndDerive(archiveText);
    expect(restoredState.cursors).toEqual(sourceState.cursors);
    const restoredBob = restoredState.cursors.find((c) => c.handle === 'bob')!;
    expect(restoredBob.cursor).toBe(sourceBob.cursor);
  });
});

describe('FR34 round-trip fidelity — the comparison is NON-VACUOUS (AC4 / Rule 7)', () => {
  it('DROP one event from the archive → the comparison goes RED (reactions/contracts differ)', async () => {
    // Mutation: rebuild the archive truncated BEFORE the first reaction — a contiguous seq 1..k
    // prefix (so replay's seq-reproduction still passes) that OMITS the reactions. Dropping the
    // reactions changes the LIVE 👍 set AND the FR21 contract, so the restored derived state MUST
    // differ from the source — proving the comparison discriminates a lossy archive.
    const { sourceState, archiveText } = await buildSource();
    const parsed = parseArchive(archiveText);
    const firstReactionIdx = parsed.events.findIndex(
      (e) => e.type === 'message.reacted',
    );
    expect(firstReactionIdx).toBeGreaterThan(0);
    const kept = parsed.events.slice(0, firstReactionIdx);
    // Drop the read-state too (its cursor referenced a now-missing seq) to keep the archive
    // replayable into a contiguous empty board.
    const buggy =
      [
        JSON.stringify(buildHeader(kept.length, 0)),
        ...kept.map((e) => JSON.stringify(e)),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(buggy);

    // The whole snapshot differs...
    expect(restoredState).not.toEqual(sourceState);
    // ...and it LOCALIZES: reactions + contracts changed (the dropped 👍), cursors changed (the
    // dropped read-state). This proves those specific category asserts are not vacuously green.
    expect(restoredState.reactions).not.toEqual(sourceState.reactions);
    expect(restoredState.contracts).not.toEqual(sourceState.contracts);
    expect(restoredState.cursors).not.toEqual(sourceState.cursors);
  });

  it('SKIP the cursor restore (omit the read-state line) → the cursors category goes RED', async () => {
    // Mutation: rebuild the archive with the SAME events but NO read-state line. The events replay
    // identically (identities/membership/rooms/messages/reactions/contracts all match), but bob's
    // cursor is never restored — so ONLY the cursors category differs. This proves the cursor
    // category assert is load-bearing (a comparison that ignored cursors would pass here).
    const { sourceState, archiveText } = await buildSource();
    const parsed = parseArchive(archiveText);
    expect(parsed.readState).toHaveLength(1);
    const noCursor =
      [
        JSON.stringify(buildHeader(parsed.events.length, 0)),
        ...parsed.events.map((e) => JSON.stringify(e)),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(noCursor);

    // Everything EXCEPT cursors still matches (the events replayed identically)...
    expect(restoredState.identities).toEqual(sourceState.identities);
    expect(restoredState.membership).toEqual(sourceState.membership);
    expect(restoredState.rooms).toEqual(sourceState.rooms);
    expect(restoredState.messages).toEqual(sourceState.messages);
    expect(restoredState.reactions).toEqual(sourceState.reactions);
    expect(restoredState.contracts).toEqual(sourceState.contracts);
    // ...but the cursors category is RED (bob's non-zero cursor was not restored → 0).
    expect(restoredState.cursors).not.toEqual(sourceState.cursors);
    expect(restoredState.cursors.find((c) => c.handle === 'bob')!.cursor).toBe(
      0,
    );
  });

  it('ALTER the focus_updated payload → the identities category goes RED (currentFocus is compared)', async () => {
    // Mutation: tamper alice's `identity.focus_updated` payload (her currentFocus). The replayed
    // identity then has a different currentFocus → the identities category MUST differ. Proves the
    // identities comparison actually compares currentFocus, not just the handle set (a comparison
    // that ignored focus — easy, since createdAt/lastSeen are legitimately stripped — would pass).
    const { sourceState, archiveText } = await buildSource();
    const parsed = parseArchive(archiveText);
    const tampered = parsed.events.map((e) => {
      if (e.type === 'identity.focus_updated' && e.actor === 'alice') {
        return {
          ...e,
          payload: { ...e.payload, currentFocus: 'TAMPERED FOCUS' },
        };
      }
      return e;
    });
    expect(tampered).not.toEqual(parsed.events);
    const buggy =
      [
        JSON.stringify(buildHeader(tampered.length, parsed.readState.length)),
        ...tampered.map((e) => JSON.stringify(e)),
        ...parsed.readState.map((rs) =>
          JSON.stringify({ agentbbs_read_state: rs }),
        ),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(buggy);

    expect(restoredState.identities).not.toEqual(sourceState.identities);
    // Handles are intact — only the focus differs (proves focus specifically is load-bearing).
    expect(restoredState.identities.map((i) => i.handle).sort()).toEqual(
      sourceState.identities.map((i) => i.handle).sort(),
    );
  });

  it('DROP carol board.joined → the membership category goes RED (member sets are compared)', async () => {
    // Mutation: drop the `board.joined` that adds carol to the sub-board, re-sequence the kept
    // events contiguously. The restored board's project then has carol MISSING from its member set
    // → the membership category MUST differ. Proves membership (per-project member sets) is
    // load-bearing, not a vacuously-equal []===[] / always-matching set.
    const { sourceState, archiveText } = await buildSource();
    const sourceMembers = sourceState.membership.flatMap((m) => m.members);
    expect(sourceMembers).toContain('carol');

    const parsed = parseArchive(archiveText);
    const carolJoinIdx = parsed.events.findIndex(
      (e) =>
        e.type === 'board.joined' &&
        (e.actor === 'carol' ||
          (e.payload as { handle?: string }).handle === 'carol'),
    );
    expect(carolJoinIdx).toBeGreaterThan(0);
    const kept = parsed.events
      .filter((_, i) => i !== carolJoinIdx)
      .map((e, i) => ({ ...e, seq: i + 1 }));
    const buggy =
      [
        JSON.stringify(buildHeader(kept.length, 0)),
        ...kept.map((e) => JSON.stringify(e)),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(buggy);

    expect(restoredState.membership).not.toEqual(sourceState.membership);
    const restoredMembers = restoredState.membership.flatMap((m) => m.members);
    expect(restoredMembers).not.toContain('carol');
  });

  it('DROP the proto-room announcement → the rooms category goes RED (proves the proto-room half is not vacuous)', async () => {
    // The rooms category compares BOTH halves: listRooms (activated) AND listAnnouncements (proto).
    // The proto-room half is the easy-to-vacuously-pass one — if the seed had no un-activated
    // announcement it would be []===[] on both sides and prove nothing. Mutation: drop the
    // un-activated `announcement.posted` (the proto-room "Also need a settings panel"). The restored
    // board then has ONE FEWER proto-room → the rooms category MUST differ, proving the proto-room
    // comparison is load-bearing.
    const { sourceState, archiveText } = await buildSource();
    // The source genuinely HAS a proto-room (guards the mutation is meaningful).
    const sourceProto = sourceState.rooms.flatMap((r) => r.announcements);
    expect(sourceProto.length).toBeGreaterThanOrEqual(1);

    const parsed = parseArchive(archiveText);
    const protoIdx = parsed.events.findIndex(
      (e) =>
        e.type === 'announcement.posted' &&
        (e.payload as { subject?: string }).subject ===
          'Also need a settings panel',
    );
    expect(protoIdx).toBeGreaterThan(0);
    // Drop the proto-room event, then RE-NUMBER the remaining events' seqs contiguously 1..N-1 so
    // the archive stays contiguous (runImport asserts archived seq === replay position). The
    // proto-room is referenced by no later event (nobody replied to it), so re-sequencing is safe.
    // Drop the read-state too (its cursor seq shifts) to keep the archive clean.
    const kept = parsed.events
      .filter((_, i) => i !== protoIdx)
      .map((e, i) => ({ ...e, seq: i + 1 }));
    const buggy =
      [
        JSON.stringify(buildHeader(kept.length, 0)),
        ...kept.map((e) => JSON.stringify(e)),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(buggy);

    // The rooms category is RED: the restored board is missing the proto-room.
    expect(restoredState.rooms).not.toEqual(sourceState.rooms);
    const restoredProto = restoredState.rooms.flatMap((r) => r.announcements);
    expect(restoredProto.length).toBeLessThan(sourceProto.length);
  });

  it('ALTER one message body in the archive → the messages (and contract) category goes RED', async () => {
    // Mutation: tamper with one event's body in the archive before import. The replayed message
    // body then differs from the source — proving the messages comparison discriminates a content
    // change (a comparison that compared only seqs/actors, not bodies, would pass here).
    const { sourceState, archiveText } = await buildSource();
    const parsed = parseArchive(archiveText);
    // Find bob's reply (the live contract message) and corrupt its body.
    const tampered = parsed.events.map((e) => {
      if (e.type === 'room.replied' && e.actor === 'bob') {
        return { ...e, payload: { ...e.payload, body: 'TAMPERED BODY' } };
      }
      return e;
    });
    expect(tampered).not.toEqual(parsed.events);
    const buggy =
      [
        JSON.stringify(buildHeader(tampered.length, parsed.readState.length)),
        ...tampered.map((e) => JSON.stringify(e)),
        ...parsed.readState.map((rs) =>
          JSON.stringify({ agentbbs_read_state: rs }),
        ),
      ].join('\n') + '\n';

    const restoredState = await importAndDerive(buggy);

    // The altered body surfaces in the messages category AND (since bob's reply IS the live
    // contract) in the contracts category — both go RED.
    expect(restoredState.messages).not.toEqual(sourceState.messages);
    expect(restoredState.contracts).not.toEqual(sourceState.contracts);
    // But the seq-structure is intact (the tamper changed body only, not the shape).
    expect(restoredState.messages.map((m) => m.seq)).toEqual(
      sourceState.messages.map((m) => m.seq),
    );
  });
});
