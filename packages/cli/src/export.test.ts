// Story 11.2 — `agentbbs export` marquee tests (AC1, AC2, AC3, AC5, AC6).
//
// Rule 3 / project-context "Testing": these run over a REAL `createDataAccess` better-sqlite3
// ledger in an OS temp dir — NOTHING is mocked. A representative board is seeded with the real
// core write ops (registrations, a project + sub-board, an announcement/proto-room, replies, a
// reaction, AND a `check` so a stored read-state cursor exists), then exported, and the archive
// is asserted + parsed back.
//
// The MARQUEE assertion (AC6) is the serialize→parse ROUND-TRIP: parse every archive line back
// and assert the reconstructed events EQUAL `eventsSince(0)` (the integration assertion available
// in THIS story before the import consumer exists). It is non-vacuous — a dropped or garbled
// field turns it RED (proven by the mutation note in the archive codec test below).
//
// AC3 read-state: the seeded `check` stores a cursor; the export captures it as a delimited
// read-state line, and the round-trip restores the SAME `{ handle, cursor }` — so Story 11.4's
// `cursors` comparison is achievable.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EVENT_TYPES,
  addParticipant,
  announceProject,
  check,
  postAnnouncement,
  react,
  register,
  reply,
  roomMessages,
  unreact,
  updateFocus,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ARCHIVE_FORMAT, ARCHIVE_VERSION, parseArchive } from './archive.js';
import { runExport } from './export.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-export-'));
  dbPath = join(dir, 'agentbbs.db');
  dataAccess = createDataAccess({ dbPath });
});

afterEach(() => {
  if (dataAccess !== undefined) {
    dataAccess.close();
    dataAccess = undefined;
  }
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed a representative multi-event board over the REAL ledger that exercises ALL 10
 * `EVENT_TYPES` (the lossless-completeness / institutional-memory guarantee — QA goal 4):
 *
 *   identity.registered        — alice + bob + carol register
 *   identity.focus_updated     — alice updates her focus
 *   project.announced          — alice announces a project
 *   board.joined               — alice joins the sub-board on announce (and carol on add)
 *   announcement.posted        — alice posts an announcement (proto-room)
 *   room.replied               — bob (activates the room) + alice reply
 *   room.participant_added     — bob pulls carol into the room (add_participant)
 *   message.reacted            — alice 👍 bob's reply (the live contract) AND alice 👍 her own
 *   message.unreacted          — alice retracts the 👍 on her OWN reply (bob's stays live)
 *   identity.seen              — bob `check`s → also STORES his read-state cursor (AC3)
 *
 * Closes the seeding handle so the export opens its OWN connection to the same file (proving a
 * real on-disk ledger). Returns bob's stored cursor for the read-state assertions.
 */
async function seedBoard(da: DataAccessHandle): Promise<{ bobCursor: number }> {
  await register(da, { handle: 'alice', currentFocus: 'kickoff' });
  await register(da, { handle: 'bob', currentFocus: 'helping' });
  await register(da, { handle: 'carol', currentFocus: 'lurking' });
  // identity.focus_updated — alice changes focus.
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
  // bob replies → activates the room + auto-joins bob (acting = joining).
  await reply(da, 'bob', { roomId: room.roomId, body: 'I can. Proposing X.' });
  // bob (a participant) pulls carol into the room → room.participant_added + carol board.joined.
  await addParticipant(da, 'bob', { roomId: room.roomId, handle: 'carol' });
  await reply(da, 'alice', { roomId: room.roomId, body: 'X looks good.' });
  // alice 👍 bob's reply (the activating message). Find its seq via the room history.
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
  // alice 👍 her OWN reply, then retracts it → message.reacted + message.unreacted (bob's 👍
  // on bobReply stays live; only alice's reaction on aliceReply flips off).
  await react(da, 'alice', aliceReply!.seq);
  await unreact(da, 'alice', aliceReply!.seq);
  // bob dials in → advances + STORES his per-identity cursor (AC3 read-state). bob sees alice's
  // later reply + the reactions (all past his join floor), so his stored cursor is non-zero.
  const result = await check(da, 'bob');
  const bobCursor = await da.getCursor('bob');
  expect(bobCursor).toBe(result.cursor);
  expect(bobCursor).toBeGreaterThan(0);
  return { bobCursor };
}

describe('export — NDJSON archive over a real ledger (AC1, AC2, AC6)', () => {
  it('writes a header-first archive: one line per event in ascending seq; lossless fields', async () => {
    await seedBoard(dataAccess!);
    // Close the seeding handle; export opens its own connection to the same on-disk file.
    dataAccess!.close();
    dataAccess = undefined;

    const out: string[] = [];
    const result = await runExport(
      { dbPath },
      { out: (text) => out.push(text), exportedAt: '2026-06-05T12:00:00.000Z' },
    );
    const text = out.join('');
    const lines = text.split('\n').filter((l) => l.trim() !== '');

    // FIRST line is the header (AC2).
    const header: unknown = JSON.parse(lines[0]!);
    expect((header as { agentbbs_archive?: number }).agentbbs_archive).toBe(
      ARCHIVE_VERSION,
    );
    expect((header as { format?: string }).format).toBe(ARCHIVE_FORMAT);

    // Reopen a real handle to read the authoritative ledger for the comparison.
    const verify = createDataAccess({ dbPath });
    try {
      const ledger = await verify.eventsSince(0);
      const parsed = parseArchive(text);

      // AC1 — one event line per ledger event, ascending seq, lossless.
      expect(parsed.events).toHaveLength(ledger.length);
      expect((header as { event_count?: number }).event_count).toBe(
        ledger.length,
      );
      const seqs = parsed.events.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

      // AC6 MARQUEE — the serialize→parse round-trip equals eventsSince(0), field-for-field.
      expect(parsed.events).toEqual(ledger);

      expect(result.eventCount).toBe(ledger.length);
    } finally {
      verify.close();
    }
  });

  it('LOSSLESS COMPLETENESS — every one of the 10 EVENT_TYPES serializes + round-trips', async () => {
    // The seed exercises all 10 event types; the archive must carry every one of them and the
    // parse must reconstruct the full ledger field-for-field (the institutional-memory
    // guarantee — QA goal 4). This is the strongest single proof that NO event type is dropped
    // or mangled by the codec.
    await seedBoard(dataAccess!);
    dataAccess!.close();
    dataAccess = undefined;

    const out: string[] = [];
    await runExport({ dbPath }, { out: (text) => out.push(text) });
    const text = out.join('');
    const parsed = parseArchive(text);

    // Every one of the 10 closed event types is present in the exported archive.
    const exportedTypes = new Set(parsed.events.map((e) => e.type));
    for (const type of EVENT_TYPES) {
      expect(exportedTypes.has(type)).toBe(true);
    }
    expect(exportedTypes.size).toBe(EVENT_TYPES.length);

    // And the whole ledger round-trips losslessly against the authoritative read.
    const verify = createDataAccess({ dbPath });
    try {
      expect(parsed.events).toEqual(await verify.eventsSince(0));
    } finally {
      verify.close();
    }
  });

  it('AC2 — the header is defined against the EVENT_TYPES model with NO SQLite leakage', async () => {
    await seedBoard(dataAccess!);
    dataAccess!.close();
    dataAccess = undefined;

    const out: string[] = [];
    await runExport({ dbPath }, { out: (text) => out.push(text) });
    const text = out.join('');
    const header = parseArchive(text).header;

    // Defined against the closed event vocabulary (the model), not SQLite.
    expect(header.event_types).toContain('identity.registered');
    expect(header.event_types).toContain('message.reacted');
    expect(header.event_types).toHaveLength(10);

    // NO SQLite-specific detail leaks into the archive (AC2): no rowids, PRAGMA, SQL DDL,
    // or the `.db` path anywhere in the serialized archive. NOTE (Rule 18 — precise-token
    // matching): the SQLite TABLE names `events`/`cursors` are NOT bare-substring-checked,
    // because the legitimate header tokens `ndjson-events` ⊃ `events`, `event_count`/
    // `event_types` ⊃ `event`, and `cursor_count` ⊃ `cursor`. We assert the SQL-shaped
    // leakage forms instead (a SELECT/FROM/PRAGMA/DDL referencing a table), which are what a
    // schema leak would actually look like.
    expect(text).not.toContain('PRAGMA');
    expect(text).not.toContain('rowid');
    expect(text.toLowerCase()).not.toContain('sqlite');
    expect(text).not.toContain('CREATE TABLE');
    expect(text).not.toMatch(/FROM\s+events/i); // no SQL referencing the events table
    expect(text).not.toMatch(/FROM\s+cursors/i); // no SQL referencing the cursors table
    expect(text).not.toContain(dbPath); // the .db path must not leak
  });
});

describe('export — read-state / cursors (AC3 design decision)', () => {
  it('captures each stored cursor as a delimited read-state line and round-trips it', async () => {
    const { bobCursor } = await seedBoard(dataAccess!);
    dataAccess!.close();
    dataAccess = undefined;

    const out: string[] = [];
    const result = await runExport(
      { dbPath },
      { out: (text) => out.push(text) },
    );
    const parsed = parseArchive(out.join(''));

    // bob's stored check cursor was captured (alice never checked → no cursor row → omitted).
    expect(parsed.readState).toEqual([{ handle: 'bob', cursor: bobCursor }]);
    expect(parsed.header.cursor_count).toBe(1);
    expect(result.cursorCount).toBe(1);

    // A read-state line is DISTINCT from an event line (no event carries `agentbbs_read_state`).
    const text = out.join('');
    expect(text).toContain('agentbbs_read_state');
    // The round-trip preserves the cursor seq exactly (Story 11.4 `cursors` fidelity).
    expect(parsed.readState[0]!.cursor).toBe(bobCursor);
  });
});

describe('export — empty board + destinations (AC1, AC5)', () => {
  it('an empty board exports a valid header-only archive (NOT an error)', async () => {
    // No seeding — a brand-new empty ledger.
    dataAccess!.close();
    dataAccess = undefined;

    const out: string[] = [];
    const result = await runExport(
      { dbPath },
      { out: (text) => out.push(text), exportedAt: '2026-06-05T00:00:00.000Z' },
    );
    const parsed = parseArchive(out.join(''));
    expect(parsed.header.event_count).toBe(0);
    expect(parsed.header.cursor_count).toBe(0);
    expect(parsed.events).toEqual([]);
    expect(parsed.readState).toEqual([]);
    expect(result.eventCount).toBe(0);
  });

  it('writes to a file when an out-path is given (AC1/AC5) and the file round-trips', async () => {
    await seedBoard(dataAccess!);
    dataAccess!.close();
    dataAccess = undefined;

    const outPath = join(dir, 'archive.ndjson');
    const result = await runExport({ dbPath, outPath });
    expect(result.destination).toBe(outPath);

    const text = readFileSync(outPath, 'utf8');
    const parsed = parseArchive(text);

    const verify = createDataAccess({ dbPath });
    try {
      const ledger = await verify.eventsSince(0);
      expect(parsed.events).toEqual(ledger);
    } finally {
      verify.close();
    }
  });

  it('AC5 — a failing out-path (non-existent directory) rejects (caller maps to exit 1)', async () => {
    dataAccess!.close();
    dataAccess = undefined;
    await expect(
      runExport({ dbPath, outPath: join(dir, 'no-such-subdir', 'a.ndjson') }),
    ).rejects.toThrow();
  });
});
