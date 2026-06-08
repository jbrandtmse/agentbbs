// Story 11.3 — `agentbbs import` marquee tests (AC1–AC6).
//
// Rule 3 / project-context "Testing": these run over REAL `createDataAccess` better-sqlite3
// ledgers in an OS temp dir — NOTHING is mocked. The marquee is the import → READ-BACK EQUALITY
// (AC6 / the Rule-1 integration AC): seed a representative SOURCE board (all 10 EVENT_TYPES + a
// stored cursor) → export it via the Story-11.2 codec → import the archive into a FRESH EMPTY
// board → read the DERIVED STATE back through CORE PROJECTIONS and assert it MATCHES the source.
//
// Non-vacuity (Rule 7): the equality must DISCRIMINATE — a dropped event or a skipped cursor in
// the archive must turn the read-back equality RED. Proven by the "discriminates" tests below
// (an archive with one event removed → the restored projections no longer equal the source).
//
// AC4 createdAt DESIGN DECISION: replay via `append` re-assigns `createdAt` to import-time. The
// read-back equality therefore compares the SEQ-BASED derived state (identities / membership /
// rooms / messages / reactions / contract / cursors — all keyed on `seq`, never `createdAt`),
// which is exactly what Story 11.4 compares. `createdAt` is display-only and intentionally NOT
// asserted byte-identical (see the import.ts header + the story Dev Notes "Design decision").

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EVENT_TYPES,
  addParticipant,
  announceProject,
  boardDirectory,
  check,
  currentContract,
  foldIdentities,
  foldProjects,
  foldRooms,
  postAnnouncement,
  react,
  register,
  reply,
  roomMessages,
  roomParticipants,
  unreact,
  updateFocus,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHeader, parseArchive } from './archive.js';
import { runExport } from './export.js';
import { importCommand, runImport } from './import.js';

import type { Event } from '@agentbbs/core';
import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-import-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed a representative multi-event board over the REAL ledger that exercises ALL 10
 * `EVENT_TYPES` (mirrors the Story-11.2 export test's seed). Returns the room id (so tests can
 * read its derived projections) and bob's stored cursor (for the read-state restore assertion).
 */
async function seedBoard(
  da: DataAccessHandle,
): Promise<{ roomId: string; projectId: string; bobCursor: number }> {
  await register(da, { handle: 'alice', currentFocus: 'kickoff' });
  await register(da, { handle: 'bob', currentFocus: 'helping' });
  await register(da, { handle: 'carol', currentFocus: 'lurking' });
  await updateFocus(da, 'alice', 'designing the interface');
  const project = await announceProject(da, 'alice', {
    title: 'Calling Interface',
    description: 'Design the calling interface.',
  });
  const room = await postAnnouncement(da, 'alice', {
    projectId: project.projectId,
    subject: 'Need a calling interface',
    body: 'Who can help design **the calling interface**?',
  });
  await reply(da, 'bob', { roomId: room.roomId, body: 'I can. Proposing X.' });
  await addParticipant(da, 'bob', { roomId: room.roomId, handle: 'carol' });
  await reply(da, 'alice', { roomId: room.roomId, body: 'X looks good.' });
  const messages = roomMessages(await da.eventsSince(0), room.roomId);
  const bobReply = messages.find(
    (m) => m.actor === 'bob' && m.kind === 'reply',
  );
  const aliceReply = messages.find(
    (m) => m.actor === 'alice' && m.kind === 'reply',
  );
  expect(bobReply).toBeDefined();
  expect(aliceReply).toBeDefined();
  await react(da, 'alice', bobReply!.seq);
  await react(da, 'alice', aliceReply!.seq);
  await unreact(da, 'alice', aliceReply!.seq);
  const result = await check(da, 'bob');
  const bobCursor = await da.getCursor('bob');
  expect(bobCursor).toBe(result.cursor);
  expect(bobCursor).toBeGreaterThan(0);
  return { roomId: room.roomId, projectId: project.projectId, bobCursor };
}

/** Export a (closed) ledger at `dbPath` to NDJSON text via the real export path. */
async function exportToText(dbPath: string): Promise<string> {
  const out: string[] = [];
  await runExport({ dbPath }, { out: (text) => out.push(text) });
  return out.join('');
}

/**
 * Read the full DERIVED STATE of a ledger through CORE PROJECTIONS — the seq-based snapshot the
 * import must reconstruct (and Story 11.4 will compare). Excludes `createdAt` (display-only, see
 * the AC4 decision). Returns a plain comparable object.
 */
async function deriveState(da: DataAccessHandle): Promise<unknown> {
  const events = await da.eventsSince(0);
  // foldIdentities/foldProjects/foldRooms return Maps; materialize their values for a stable,
  // comparable snapshot (Map iteration order is insertion order — deterministic from the seq
  // replay, so the source and restored snapshots compare equal).
  //
  // AC4 (createdAt design decision): the Identity projection carries `createdAt` + `lastSeen`,
  // both DERIVED from event `createdAt` — which `append` RE-ASSIGNS at import-time. They are
  // display-only and are NOT part of the seq-based derived state Story 11.4 compares, so we
  // STRIP them from this snapshot and compare only the seq-keyed identity fields (handle +
  // currentFocus). Projects/Rooms/messages/contract/participants are all seq-keyed (no
  // timestamps), so they compare as-is. (If this snapshot did NOT strip them, the marquee
  // equality would fail purely on re-assigned timestamps — see the AC4 dedicated test.)
  const identities = [...foldIdentities(events).values()].map((id) => ({
    handle: id.handle,
    currentFocus: id.currentFocus,
  }));
  const projects = [...foldProjects(events).values()];
  const rooms = [...foldRooms(events).values()];
  // Per-room message histories + participants + the live contract (the heart of the board).
  const roomDetail = rooms.map((room) => ({
    room,
    messages: roomMessages(events, room.roomId).map((m) => ({
      seq: m.seq,
      actor: m.actor,
      kind: m.kind,
      body: m.body,
    })),
    participants: roomParticipants(events, room.roomId),
    contract: currentContract(events, room.roomId),
  }));
  return { identities, projects, roomDetail };
}

describe('import — replay an archive into an empty board (AC1, AC4, AC6)', () => {
  it('MARQUEE — import reconstructs the SAME derived state as the source board (read back via core projections)', async () => {
    // 1. Seed the SOURCE board over a real ledger, then export it to an archive.
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    let sourceState: unknown;
    let sourceEvents: Event[];
    let bobCursor: number;
    try {
      ({ bobCursor } = await seedBoard(src));
      sourceState = await deriveState(src);
      sourceEvents = await src.eventsSince(0);
    } finally {
      src.close();
    }
    const archiveText = await exportToText(srcDb);

    // 2. Import the archive into a FRESH EMPTY board via the real run path.
    const destDb = join(dir, 'restored.db');
    const result = await runImport(
      { dbPath: destDb, inPath: '-' },
      {
        readStdin: () => archiveText,
      },
    );
    expect(result.eventCount).toBe(sourceEvents.length);
    expect(result.cursorCount).toBe(1);

    // 3. Read the restored board's derived state back through the SAME core projections and
    //    assert it MATCHES the source (the import → read-back equality — the integration AC).
    const dest = createDataAccess({ dbPath: destDb });
    try {
      const restoredState = await deriveState(dest);
      expect(restoredState).toEqual(sourceState);

      // AC4 — the restored `seq` reproduces the archive's `seq` 1:1 (contiguous 1..N).
      const restoredEvents = await dest.eventsSince(0);
      expect(restoredEvents.map((e) => e.seq)).toEqual(
        sourceEvents.map((e) => e.seq),
      );
      // Every one of the 10 EVENT_TYPES was replayed (lossless completeness).
      const restoredTypes = new Set(restoredEvents.map((e) => e.type));
      for (const type of EVENT_TYPES)
        expect(restoredTypes.has(type)).toBe(true);

      // AC1 — the read-state cursor was restored.
      expect(await dest.getCursor('bob')).toBe(bobCursor);
    } finally {
      dest.close();
    }
  });

  it('AC4 — createdAt is RE-ASSIGNED at import-time (NOT byte-identical), by design', async () => {
    // Build an archive whose events carry an obviously-stale createdAt, import it, and assert the
    // restored events have a DIFFERENT (import-time) createdAt while the seq-based fields match.
    // This pins the AC4 design decision (createdAt is display-only; replay re-assigns it).
    const events: Event[] = [
      {
        seq: 1,
        type: 'identity.registered',
        actor: 'alice',
        createdAt: '2000-01-01T00:00:00.000Z',
        payload: { handle: 'alice', currentFocus: 'kickoff' },
      },
    ];
    const header = JSON.stringify(buildHeader(1, 0));
    const archiveText = [header, JSON.stringify(events[0])].join('\n') + '\n';

    const destDb = join(dir, 'restored.db');
    await runImport(
      { dbPath: destDb, inPath: '-' },
      {
        readStdin: () => archiveText,
      },
    );

    const dest = createDataAccess({ dbPath: destDb });
    try {
      const restored = await dest.eventsSince(0);
      expect(restored).toHaveLength(1);
      // seq + type + actor + payload reproduced exactly...
      expect(restored[0]!.seq).toBe(1);
      expect(restored[0]!.type).toBe('identity.registered');
      expect(restored[0]!.actor).toBe('alice');
      // ...but createdAt is re-assigned to import-time (NOT the archive's stale 2000 value).
      expect(restored[0]!.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    } finally {
      dest.close();
    }
  });

  it('NON-VACUITY (Rule 7) — an archive missing one event no longer reconstructs the source state', async () => {
    // Seed + export the source, then DROP one event line from the archive and import the rest.
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    let sourceState: unknown;
    try {
      await seedBoard(src);
      sourceState = await deriveState(src);
    } finally {
      src.close();
    }
    const archiveText = await exportToText(srcDb);
    const parsed = parseArchive(archiveText);

    // Rebuild the archive truncated BEFORE the first reaction (message.reacted) — a contiguous
    // seq 1..k prefix (so the replay's seq-reproduction check still passes) that OMITS the
    // reactions. Dropping the reactions changes the LIVE CONTRACT (FR21), so the restored
    // derived state MUST differ from the full source — proving the marquee equality discriminates
    // a lossy archive (it is not vacuously green). Drop read-state too (its cursor referenced a
    // now-missing seq) to keep the archive replayable.
    const firstReactionIdx = parsed.events.findIndex(
      (e) => e.type === 'message.reacted',
    );
    expect(firstReactionIdx).toBeGreaterThan(0);
    const droppedEvents = parsed.events.slice(0, firstReactionIdx);
    const header = JSON.stringify(buildHeader(droppedEvents.length, 0));
    const buggyText =
      [header, ...droppedEvents.map((e) => JSON.stringify(e))].join('\n') +
      '\n';

    const destDb = join(dir, 'restored.db');
    await runImport(
      { dbPath: destDb, inPath: '-' },
      {
        readStdin: () => buggyText,
      },
    );

    const dest = createDataAccess({ dbPath: destDb });
    try {
      const restoredState = await deriveState(dest);
      // The dropped event means the restored derived state MUST differ from the source — proving
      // the marquee equality discriminates a lossy archive (it is not vacuously green).
      expect(restoredState).not.toEqual(sourceState);
    } finally {
      dest.close();
    }
  });

  it('NON-VACUITY (Rule 7) — a skipped read-state line no longer restores the cursor', async () => {
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    try {
      await seedBoard(src);
    } finally {
      src.close();
    }
    const parsed = parseArchive(await exportToText(srcDb));
    expect(parsed.readState).toHaveLength(1);

    // Build an archive that OMITS the read-state line (events only).
    const header = JSON.stringify(buildHeader(parsed.events.length, 0));
    const text =
      [header, ...parsed.events.map((e) => JSON.stringify(e))].join('\n') +
      '\n';

    const destDb = join(dir, 'restored.db');
    const result = await runImport(
      { dbPath: destDb, inPath: '-' },
      {
        readStdin: () => text,
      },
    );
    expect(result.cursorCount).toBe(0);

    const dest = createDataAccess({ dbPath: destDb });
    try {
      // With no read-state line, bob's cursor stays the unset sentinel 0 (NOT the source value).
      expect(await dest.getCursor('bob')).toBe(0);
    } finally {
      dest.close();
    }
  });
});

describe('import — empty-board guard (AC2)', () => {
  it('rejects a NON-EMPTY board, appends NOTHING, sets exitCode 1', async () => {
    // Seed + export a source, and seed the DESTINATION with a single event (so it is non-empty).
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    try {
      await seedBoard(src);
    } finally {
      src.close();
    }
    const archiveText = await exportToText(srcDb);

    const destDb = join(dir, 'restored.db');
    const dest = createDataAccess({ dbPath: destDb });
    let beforeEvents: Event[];
    try {
      await register(dest, { handle: 'preexisting', currentFocus: 'here' });
      beforeEvents = await dest.eventsSince(0);
    } finally {
      dest.close();
    }
    expect(beforeEvents).toHaveLength(1);

    // runImport REJECTS (throws) — nothing appended.
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => archiveText },
      ),
    ).rejects.toThrow(/not empty/i);

    // The destination ledger is UNTOUCHED (still exactly its one pre-existing event).
    const verify = createDataAccess({ dbPath: destDb });
    try {
      expect(await verify.eventsSince(0)).toEqual(beforeEvents);
    } finally {
      verify.close();
    }

    // importCommand maps the rejection to a clear stderr message + exitCode 1.
    const savedExit = process.exitCode;
    process.exitCode = undefined;
    try {
      const log: string[] = [];
      await importCommand(['-', '--db', destDb], {
        log: (line) => log.push(line),
        readStdin: () => archiveText,
      });
      expect(process.exitCode).toBe(1);
      expect(log.join('\n')).toMatch(/agentbbs import: failed/i);
      expect(log.join('\n')).toMatch(/not empty/i);
    } finally {
      process.exitCode = savedExit;
    }
  });
});

describe('import — malformed / incompatible archive rejection (AC5)', () => {
  it('rejects non-NDJSON text, appends NOTHING', async () => {
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => 'not a valid archive at all\n' },
      ),
    ).rejects.toThrow();
    // A board was never created with events (a fresh open would be empty).
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await dest.eventsSince(0)).toEqual([]);
    } finally {
      dest.close();
    }
  });

  it('rejects an incompatible header version', async () => {
    const badHeader = JSON.stringify({
      agentbbs_archive: 999,
      format: 'ndjson-events',
      event_count: 0,
      cursor_count: 0,
      exported_at: '2026-06-05T00:00:00.000Z',
      event_types: [],
    });
    await expect(
      runImport(
        { dbPath: join(dir, 'restored.db'), inPath: '-' },
        { readStdin: () => badHeader + '\n' },
      ),
    ).rejects.toThrow(/version/i);
  });

  it('rejects an event line with a type OUTSIDE EVENT_TYPES (nothing appended)', async () => {
    const header = JSON.stringify(buildHeader(1, 0));
    const badEvent = JSON.stringify({
      seq: 1,
      type: 'identity.teleported', // not in the closed EVENT_TYPES vocabulary
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: {},
    });
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => [header, badEvent].join('\n') + '\n' },
      ),
    ).rejects.toThrow(/unknown type/i);
    // Validation runs BEFORE opening/appending → the board stays empty.
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await dest.eventsSince(0)).toEqual([]);
    } finally {
      dest.close();
    }
  });

  it('rejects a truncated (non-JSON) line', async () => {
    const header = JSON.stringify(buildHeader(1, 0));
    const truncated = '{"seq":1,"type":"identity.registered","actor":"ali'; // cut off
    await expect(
      runImport(
        { dbPath: join(dir, 'restored.db'), inPath: '-' },
        { readStdin: () => [header, truncated].join('\n') + '\n' },
      ),
    ).rejects.toThrow();
  });

  // QA-added (skill goal 4): the read-state shape is validated too — a read-state line whose
  // `cursor` is NON-NUMERIC (here a string) is the malformed-read-state class the dev's four
  // event-shape cases did NOT exercise (`validateParsedArchive` has an `isShapedReadState` gate
  // that was unguarded by any test). It must reject BEFORE any append (nothing in the ledger).
  it('rejects a read-state line with a NON-NUMERIC cursor, appends NOTHING (AC5)', async () => {
    // A valid header + one valid event, then a read-state line with a string cursor.
    const header = JSON.stringify(buildHeader(1, 1));
    const event = JSON.stringify({
      seq: 1,
      type: 'identity.registered',
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'kickoff' },
    });
    const badReadState = JSON.stringify({
      agentbbs_read_state: { handle: 'alice', cursor: 'not-a-number' },
    });
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => [header, event, badReadState].join('\n') + '\n' },
      ),
    ).rejects.toThrow(/read-state/i);
    // Validation runs BEFORE opening/appending → the board stays empty (even the valid event
    // line is NOT appended, because the whole archive is validated up front).
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await dest.eventsSince(0)).toEqual([]);
    } finally {
      dest.close();
    }
  });
});

describe('import — file input path + summary (AC1)', () => {
  it('reads the archive from a FILE path and replays it; prints a stderr summary; exit 0', async () => {
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    let sourceEvents: Event[];
    try {
      await seedBoard(src);
      sourceEvents = await src.eventsSince(0);
    } finally {
      src.close();
    }
    const archivePath = join(dir, 'archive.ndjson');
    writeFileSync(archivePath, await exportToText(srcDb), 'utf8');

    const destDb = join(dir, 'restored.db');
    const savedExit = process.exitCode;
    process.exitCode = undefined;
    try {
      const log: string[] = [];
      await importCommand([archivePath, '--db', destDb], {
        log: (line) => log.push(line),
      });
      expect(process.exitCode).toBeUndefined();
      expect(log.join('\n')).toMatch(/agentbbs import: replayed/i);
      expect(log.join('\n')).toMatch(
        new RegExp(`replayed ${sourceEvents.length} event`, 'i'),
      );
    } finally {
      process.exitCode = savedExit;
    }

    // The file-read import really restored the board.
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect((await dest.eventsSince(0)).length).toBe(sourceEvents.length);
    } finally {
      dest.close();
    }
  });

  it('reports a clear error + non-zero exit when the in-path file does not exist', async () => {
    const savedExit = process.exitCode;
    process.exitCode = undefined;
    try {
      const log: string[] = [];
      await importCommand(
        [join(dir, 'no-such.ndjson'), '--db', join(dir, 'restored.db')],
        { log: (line) => log.push(line) },
      );
      expect(process.exitCode).toBe(1);
      expect(log.join('\n')).toMatch(/agentbbs import: failed/i);
    } finally {
      process.exitCode = savedExit;
    }
  });

  it('round-trip via a real exported FILE — derived state + board directory match the source', async () => {
    // A higher-level read-back through a real file path: compare both the full derived-state
    // snapshot AND the operator-facing boardDirectory (which reads through the port) of source
    // vs restored.
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    let srcDir: unknown;
    let srcState: unknown;
    let projectId: string;
    try {
      ({ projectId } = await seedBoard(src));
      srcState = await deriveState(src);
      // boardDirectory reads through the port + carries a display-only `lastSeen` (derived from
      // re-assigned `createdAt`); strip it (AC4) so we compare the seq-keyed membership + focus.
      srcDir = (await boardDirectory(src, projectId)).map((m) => ({
        handle: m.handle,
        currentFocus: m.currentFocus,
      }));
    } finally {
      src.close();
    }
    const archivePath = join(dir, 'archive.ndjson');
    writeFileSync(archivePath, await exportToText(srcDb), 'utf8');

    const destDb = join(dir, 'restored.db');
    await runImport({ dbPath: destDb, inPath: archivePath });

    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await deriveState(dest)).toEqual(srcState);
      const destDir = (await boardDirectory(dest, projectId)).map((m) => ({
        handle: m.handle,
        currentFocus: m.currentFocus,
      }));
      expect(destDir).toEqual(srcDir);
    } finally {
      dest.close();
    }
  });
});

describe('import — seq-reproduction guard (AC4)', () => {
  it('FAILS LOUDLY if ordered replay does not reproduce the archived seq (board not empty/contiguous)', async () => {
    // Pre-seed the destination with one event, then DIRECTLY call runImport's replay-path
    // precondition by importing into it — but the AC2 guard catches a non-empty board first.
    // To isolate the AC4 seq-reproduction check itself, craft an archive whose first event has a
    // seq that does NOT equal 1: ordered replay into an empty board assigns seq 1, so seq!=1 in
    // the archive trips the loud failure. This proves the seq-reproduction assertion is wired.
    const header = JSON.stringify(buildHeader(1, 0));
    const eventWithWrongSeq = JSON.stringify({
      seq: 5, // an empty-board replay will assign seq 1, not 5 → mismatch → loud failure
      type: 'identity.registered',
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'kickoff' },
    });
    await expect(
      runImport(
        { dbPath: join(dir, 'restored.db'), inPath: '-' },
        { readStdin: () => [header, eventWithWrongSeq].join('\n') + '\n' },
      ),
    ).rejects.toThrow(/seq mismatch/i);
  });

  // QA-added (skill goal 2/3 boundary): the seq-reproduction check fires MID-REPLAY, so unlike
  // the AC2 empty-board guard and the AC5 pre-replay validation (both of which append NOTHING
  // because they run BEFORE any `append`), a seq-mismatch on a LATER event leaves the EARLIER
  // events already committed — the import is NOT transactional. This pins that documented
  // behavior so it is visible + regression-guarded: a non-contiguous archive (seq 1 ok, seq 5
  // wrong) throws AND leaves a partial ledger (the seq-1 + seq-2 events that replayed before the
  // throw). The "nothing appended" guarantee is therefore scoped to the empty-guard + malformed
  // (pre-replay) cases — NOT to the AC4 seq-mismatch case. A seq-mismatch only arises from a
  // hand-mangled / non-contiguous archive (a normal export is always contiguous from 1), so this
  // is an operator-error/corruption path, not a normal-flow concern; flagged to the lead/reviewer.
  it('seq-mismatch on a LATER event throws but leaves the EARLIER replayed events (NOT atomic — characterization)', async () => {
    const header = JSON.stringify(buildHeader(2, 0));
    const ok = JSON.stringify({
      seq: 1,
      type: 'identity.registered',
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'kickoff' },
    });
    // seq 5 will be assigned seq 2 on an empty-board replay → mismatch AFTER the seq-1 append.
    const wrong = JSON.stringify({
      seq: 5,
      type: 'identity.registered',
      actor: 'bob',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'bob', currentFocus: 'helping' },
    });
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => [header, ok, wrong].join('\n') + '\n' },
      ),
    ).rejects.toThrow(/seq mismatch/i);

    // Both events that ran through `append` BEFORE the throw are committed (the replay is not
    // wrapped in a transaction). This documents the non-atomicity rather than asserting an empty
    // ledger — the import contract guarantees atomicity only for the pre-replay rejection paths.
    const dest = createDataAccess({ dbPath: destDb });
    try {
      const events = await dest.eventsSince(0);
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.actor)).toEqual(['alice', 'bob']);
    } finally {
      dest.close();
    }
  });
});
