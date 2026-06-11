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

describe('import — bad-seq archive is loudly rejected, nothing appended (AC4 / Story 13.3)', () => {
  it('FAILS LOUDLY on a bad-seq archive (first event seq≠1) — rejected pre-replay (contiguity), nothing appended', async () => {
    // Craft an archive whose only event has seq≠1. Under Story 13.3 this is caught by the
    // PRE-REPLAY contiguity check (archived seqs must be exactly 1..N) BEFORE any append — a
    // strictly stronger guarantee than the previous post-append seq-mismatch (which committed the
    // event first). The error is a clear "not contiguous" rejection and the ledger stays EMPTY.
    // (The post-append `assignedSeqs[i] === ordered[i].seq` assertion is retained in the
    // production code as defense-in-depth; on a fresh empty board the contiguity check fires first.)
    const header = JSON.stringify(buildHeader(1, 0));
    const eventWithWrongSeq = JSON.stringify({
      seq: 5, // not 1 → pre-replay contiguity check rejects → loud failure, nothing appended
      type: 'identity.registered',
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'kickoff' },
    });
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => [header, eventWithWrongSeq].join('\n') + '\n' },
      ),
    ).rejects.toThrow(/not contiguous/i);

    // Nothing appended: the rejection fired before the ledger was even opened.
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await dest.eventsSince(0)).toEqual([]);
    } finally {
      dest.close();
    }
  });

  // Story 13.3 — import replay is now ATOMIC. A non-contiguous archive (seq 1 ok, then seq 5 —
  // hand-mangled / corrupt) is rejected by the PRE-REPLAY contiguity check, which runs BEFORE any
  // append (indeed before the ledger is even opened). So the rejection appends NOTHING and leaves
  // the ledger EMPTY — a failed restore can never half-write the board (NFR10 / NFR3). This
  // supersedes the prior characterization (which documented a PARTIAL ledger from the old
  // per-event loop that committed each event before checking the next seq). The "nothing
  // appended" guarantee now covers the corruption path too, not just the empty-board + malformed
  // (pre-replay) cases. A normal export is always contiguous from 1, so this never fires on a
  // real archive — only on a hand-mangled / corrupt one.
  it('a non-contiguous archive is rejected pre-replay → EMPTY ledger (atomic, nothing appended)', async () => {
    const header = JSON.stringify(buildHeader(2, 0));
    const ok = JSON.stringify({
      seq: 1,
      type: 'identity.registered',
      actor: 'alice',
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: 'alice', currentFocus: 'kickoff' },
    });
    // seq 5 (not 2) → the archive is non-contiguous → pre-replay contiguity check rejects it.
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
    ).rejects.toThrow(/not contiguous/i);

    // ATOMIC: the rejection fired pre-replay, so NOTHING was appended — the ledger is EMPTY.
    const dest = createDataAccess({ dbPath: destDb });
    try {
      expect(await dest.eventsSince(0)).toEqual([]);
    } finally {
      dest.close();
    }
  });
});

// ---------------------------------------------------------------------------
// QA-added (Story 13.3) — ATOMICITY EDGE COVERAGE.
//
// The marquee atomicity guarantee is "a corrupt / non-contiguous archive appends NOTHING".
// The dev's two characterization tests prove the SHORT cases (a single seq≠1, and a 2-event
// gap at position 2). These QA tests HARDEN the pre-replay contiguity guard's edges that no
// existing test exercises:
//   - a gap DEEP in a LONGER stream (1,2,3,5 — gap at position 4) → rejected, EMPTY ledger;
//   - a DUPLICATE seq (1,2,2,3) → rejected, EMPTY ledger (the ascending 1..N invariant fails
//     at the dup);
//   - seqs that do NOT start at 1 (a CONTIGUOUS-but-offset run 2,3,4) → rejected, EMPTY;
//   - a SHUFFLED-but-complete set {1,2,3} is VALID (the guard sorts first → keys on the seq
//     SET, not line order) and imports fully;
//   - the N=0 header-only archive imports CLEANLY (0 events, 0 cursors) — vacuously contiguous;
//   - a genuine ≥8-event CONTIGUOUS archive imports FULLY + the cursor restores AFTER the single
//     batched append (the contiguity check is a no-op on a real archive — the happy path is
//     unchanged by the atomicity rework).
//
// Every rejection test ALSO asserts the destination ledger is EMPTY (the atomic "nothing
// appended" contract), reading back through a fresh `createDataAccess`. These complement (not
// replace) the dev's tests above.
// ---------------------------------------------------------------------------

/**
 * Build a valid-shaped NDJSON archive from an explicit list of event `seq` values (each a
 * minimal `identity.registered` event), with a header declaring `seqs.length` events + 0
 * cursors. The events are emitted in the GIVEN order (so a caller can plant a shuffled /
 * duplicate / offset sequence); the production contiguity check sorts by `seq` first, so the
 * 1..N assertion keys on the seq MULTISET, not file order.
 */
function archiveFromSeqs(seqs: readonly number[]): string {
  const header = JSON.stringify(buildHeader(seqs.length, 0));
  const lines = seqs.map((seq, i) =>
    JSON.stringify({
      seq,
      type: 'identity.registered',
      actor: `actor${i}`,
      createdAt: '2026-06-05T00:00:00.000Z',
      payload: { handle: `actor${i}`, currentFocus: 'x' },
    }),
  );
  return [header, ...lines].join('\n') + '\n';
}

/** Read back a ledger's events through a fresh open (asserts the on-disk state, not a cache). */
async function readBack(dbPath: string): Promise<Event[]> {
  const da = createDataAccess({ dbPath });
  try {
    return await da.eventsSince(0);
  } finally {
    da.close();
  }
}

describe('import — atomicity edge coverage (Story 13.3 / AC1 / AC3)', () => {
  it('rejects a gap DEEP in a longer stream (1,2,3,5 — gap at position 4) → EMPTY ledger', async () => {
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => archiveFromSeqs([1, 2, 3, 5]) },
      ),
    ).rejects.toThrow(/not contiguous/i);
    // The error names the FIRST offending position (expected seq 4, found 5).
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => archiveFromSeqs([1, 2, 3, 5]) },
      ),
    ).rejects.toThrow(/expected seq 4, found 5/i);
    expect(await readBack(destDb)).toEqual([]);
  });

  it('rejects a DUPLICATE seq (1,2,2,3) → EMPTY ledger', async () => {
    // Sorting yields 1,2,2,3: the invariant fails at index 2 (expected 3, found 2). A duplicate
    // seq would, if appended, produce a non-faithful restore — it must be rejected pre-replay.
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => archiveFromSeqs([1, 2, 2, 3]) },
      ),
    ).rejects.toThrow(/not contiguous/i);
    expect(await readBack(destDb)).toEqual([]);
  });

  it('rejects a CONTIGUOUS run that does NOT start at 1 (2,3,4) → EMPTY ledger', async () => {
    // Offset-but-internally-contiguous: the run 2,3,4 is contiguous among themselves but the
    // archive does not start at seq 1, so the 1..N invariant fails immediately (expected 1,
    // found 2). Nothing is appended.
    const destDb = join(dir, 'restored.db');
    await expect(
      runImport(
        { dbPath: destDb, inPath: '-' },
        { readStdin: () => archiveFromSeqs([2, 3, 4]) },
      ),
    ).rejects.toThrow(/expected seq 1, found 2/i);
    expect(await readBack(destDb)).toEqual([]);
  });

  it('accepts a SHUFFLED but COMPLETE set {1,2,3} (the guard sorts first → keys on the seq SET, not line order)', async () => {
    // A real export is always seq-ordered, but the guard must not reject a faithfully-complete
    // archive merely for line order — it sorts by seq before checking 1..N. A shuffled 1..N is
    // VALID and imports the 3 events.
    const destDb = join(dir, 'restored.db');
    const result = await runImport(
      { dbPath: destDb, inPath: '-' },
      { readStdin: () => archiveFromSeqs([3, 1, 2]) },
    );
    expect(result.eventCount).toBe(3);
    // The restored ledger has exactly seq 1,2,3 (the AUTOINCREMENT reproduced 1..N).
    expect((await readBack(destDb)).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('imports an EMPTY (N=0, header-only) archive CLEANLY → 0 events, 0 cursors', async () => {
    // A header-only archive is vacuously contiguous (no seqs to check). Import succeeds with an
    // empty ledger — the legitimate "restore an empty board" case, NOT a rejection.
    const header = JSON.stringify(buildHeader(0, 0));
    const destDb = join(dir, 'restored.db');
    const result = await runImport(
      { dbPath: destDb, inPath: '-' },
      { readStdin: () => header + '\n' },
    );
    expect(result.eventCount).toBe(0);
    expect(result.cursorCount).toBe(0);
    expect(await readBack(destDb)).toEqual([]);
  });

  it('imports a genuine ≥8-event CONTIGUOUS archive FULLY + restores the cursor AFTER the batched append', async () => {
    // The contiguity check is a NO-OP on a real export (always contiguous from 1). Seed a real
    // board (~14 events, all 10 EVENT_TYPES + a stored cursor), export it, then import — proving
    // the atomicity rework did not change the happy path AND that the cursor-restore loop still
    // lands AFTER the single batched append (not the old per-event loop).
    const srcDb = join(dir, 'source.db');
    const src = createDataAccess({ dbPath: srcDb });
    let sourceEvents: Event[];
    let bobCursor: number;
    try {
      ({ bobCursor } = await seedBoard(src));
      sourceEvents = await src.eventsSince(0);
    } finally {
      src.close();
    }
    expect(sourceEvents.length).toBeGreaterThanOrEqual(8); // a genuinely longer stream
    const archiveText = await exportToText(srcDb);

    const destDb = join(dir, 'restored.db');
    const result = await runImport(
      { dbPath: destDb, inPath: '-' },
      { readStdin: () => archiveText },
    );
    expect(result.eventCount).toBe(sourceEvents.length);
    expect(result.cursorCount).toBe(1);

    const dest = createDataAccess({ dbPath: destDb });
    try {
      const restored = await dest.eventsSince(0);
      // Fully replayed, contiguous 1..N (the single batched append reproduced every seq).
      expect(restored.map((e) => e.seq)).toEqual(
        sourceEvents.map((e) => e.seq),
      );
      expect(restored.length).toBeGreaterThanOrEqual(8);
      // The cursor restored AFTER the batched append (the restore loop runs post-append).
      expect(await dest.getCursor('bob')).toBe(bobCursor);
    } finally {
      dest.close();
    }
  });
});
