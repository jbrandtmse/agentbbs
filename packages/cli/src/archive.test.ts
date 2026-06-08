// Story 11.2 — unit tests for the archive codec (`archive.ts`): the NDJSON serialize/parse
// round-trip, the header shape (defined against EVENT_TYPES), the read-state lines, and the
// non-vacuity of the round-trip.
//
// These are pure (no ledger) — the real-ledger integration round-trip lives in `export.test.ts`.

import { EVENT_TYPES } from '@agentbbs/core';
import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  buildHeader,
  parseArchive,
  serializeArchive,
} from './archive.js';

import type { Event } from '@agentbbs/core';

/** A small representative event set (out of seq order on input, to prove the sort). */
const EVENTS: Event[] = [
  {
    seq: 3,
    type: 'board.joined',
    actor: 'bob',
    createdAt: '2026-06-05T00:00:03.000Z',
    payload: { projectId: 'calling-interface' },
  },
  {
    seq: 1,
    type: 'identity.registered',
    actor: 'alice',
    createdAt: '2026-06-05T00:00:01.000Z',
    payload: { handle: 'alice', currentFocus: 'kickoff' },
  },
  {
    seq: 2,
    type: 'project.announced',
    actor: 'alice',
    createdAt: '2026-06-05T00:00:02.000Z',
    payload: {
      projectId: 'calling-interface',
      title: 'Calling Interface',
      description: 'Design it.',
    },
  },
];

describe('archive codec — header (AC2)', () => {
  it('buildHeader is defined against EVENT_TYPES (the model), with version + counts', () => {
    const header = buildHeader(5, 2, '2026-06-05T00:00:00.000Z');
    expect(header.agentbbs_archive).toBe(ARCHIVE_VERSION);
    expect(header.format).toBe(ARCHIVE_FORMAT);
    expect(header.event_count).toBe(5);
    expect(header.cursor_count).toBe(2);
    expect(header.exported_at).toBe('2026-06-05T00:00:00.000Z');
    // The closed vocabulary — exactly the EVENT_TYPES set (sorted), nothing SQLite.
    expect([...header.event_types].sort()).toEqual([...EVENT_TYPES].sort());
  });
});

describe('archive codec — serialize/parse round-trip (AC1, AC6)', () => {
  it('serializes header-first, one line per event in ascending seq, then read-state', () => {
    const text = serializeArchive(
      {
        events: EVENTS,
        readState: [{ handle: 'bob', cursor: 3 }],
      },
      '2026-06-05T00:00:00.000Z',
    );
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    // Header + 3 events + 1 read-state = 5 lines.
    expect(lines).toHaveLength(5);
    // First line is the header.
    expect(JSON.parse(lines[0]!).agentbbs_archive).toBe(ARCHIVE_VERSION);
    // Event lines in ascending seq (input was 3,1,2 → emitted 1,2,3).
    expect(JSON.parse(lines[1]!).seq).toBe(1);
    expect(JSON.parse(lines[2]!).seq).toBe(2);
    expect(JSON.parse(lines[3]!).seq).toBe(3);
    // The last line is the read-state line (tagged distinctly from events).
    expect(JSON.parse(lines[4]!).agentbbs_read_state).toEqual({
      handle: 'bob',
      cursor: 3,
    });
    // NDJSON ends with a trailing newline.
    expect(text.endsWith('\n')).toBe(true);
  });

  it('parses back to the SAME events (seq-ordered) and read-state — the marquee round-trip', () => {
    const readState = [{ handle: 'bob', cursor: 3 }];
    const text = serializeArchive({ events: EVENTS, readState });
    const parsed = parseArchive(text);
    // Events come back in ascending seq (the serialize sort), field-for-field identical.
    const expectedSorted = [...EVENTS].sort((a, b) => a.seq - b.seq);
    expect(parsed.events).toEqual(expectedSorted);
    expect(parsed.readState).toEqual(readState);
    expect(parsed.header.event_count).toBe(3);
    expect(parsed.header.cursor_count).toBe(1);
  });

  // NON-VACUITY (Rule 7): the round-trip equality used by the marquee `export.test.ts`
  // assertion must DISCRIMINATE — i.e. when the serialized bytes are wrong, the parse-back must
  // NO LONGER equal the authoritative events. We prove this by feeding `parseArchive` a buggy
  // archive (built like `serializeArchive` but with one field DROPPED / a line OMITTED) and
  // asserting the `toEqual(events)` check the real test relies on goes FALSE. A vacuous
  // round-trip (one whose equality passes regardless of the bytes) would fail THIS test.
  const expectedEvents = [...EVENTS].sort((a, b) => a.seq - b.seq);

  it('discriminates — an event line missing `actor` no longer equals the ledger', () => {
    // Hand-build a buggy archive: header + event lines with `actor` stripped from each event.
    const header = JSON.stringify(buildHeader(EVENTS.length, 0));
    const buggyEventLines = expectedEvents.map((e) => {
      const withoutActor: Record<string, unknown> = { ...e };
      delete withoutActor.actor;
      return JSON.stringify(withoutActor);
    });
    const buggyText = [header, ...buggyEventLines].join('\n') + '\n';

    const parsed = parseArchive(buggyText);
    // The marquee equality (`parsed.events` vs the real ledger) MUST go false — proving the
    // real round-trip test would catch a serializer that drops `actor`.
    expect(parsed.events).not.toEqual(expectedEvents);
  });

  it('discriminates — an event line missing `seq` no longer equals the ledger', () => {
    const header = JSON.stringify(buildHeader(EVENTS.length, 0));
    const buggyEventLines = expectedEvents.map((e) => {
      const withoutSeq: Record<string, unknown> = { ...e };
      delete withoutSeq.seq;
      return JSON.stringify(withoutSeq);
    });
    const buggyText = [header, ...buggyEventLines].join('\n') + '\n';

    const parsed = parseArchive(buggyText);
    expect(parsed.events).not.toEqual(expectedEvents);
  });

  it('discriminates — a dropped read-state line no longer equals the captured cursors', () => {
    const readState = [
      { handle: 'bob', cursor: 3 },
      { handle: 'alice', cursor: 2 },
    ];
    // A correct serialization round-trips both cursors...
    expect(
      parseArchive(serializeArchive({ events: EVENTS, readState })).readState,
    ).toEqual(readState);
    // ...but a buggy archive that OMITS one read-state line must no longer equal them — proving
    // the read-state round-trip (Story 11.4 `cursors` fidelity) discriminates a dropped cursor.
    const header = JSON.stringify(buildHeader(0, readState.length));
    const onlyOneCursor = JSON.stringify({
      agentbbs_read_state: readState[0],
    });
    const buggyText = [header, onlyOneCursor].join('\n') + '\n';
    expect(parseArchive(buggyText).readState).not.toEqual(readState);
  });

  it('an empty board → header-only archive (no event/read-state lines)', () => {
    const text = serializeArchive({ events: [], readState: [] });
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    const parsed = parseArchive(text);
    expect(parsed.events).toEqual([]);
    expect(parsed.readState).toEqual([]);
    expect(parsed.header.event_count).toBe(0);
  });
});

describe('archive codec — parse guards', () => {
  it('rejects an empty archive', () => {
    expect(() => parseArchive('')).toThrow(/empty/i);
    expect(() => parseArchive('\n\n')).toThrow(/empty/i);
  });

  it('rejects an archive whose first line is not a header', () => {
    const notHeader = JSON.stringify({ seq: 1, type: 'identity.registered' });
    expect(() => parseArchive(notHeader + '\n')).toThrow(/header/i);
  });
});
