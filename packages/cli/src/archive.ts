// The AgentBBS logical archive codec (Story 11.2) — the backend-agnostic NDJSON format
// that `agentbbs export` writes and `agentbbs import` (Story 11.3) will read.
//
// The archive describes the LOGICAL event ledger (the `@agentbbs/core` event model),
// NOT the SQLite file (FR34 / NFR2): no table names, rowids, PRAGMA, or `.db` path ever
// leak into it, so it survives the V1-SQLite → V2-HTTP-daemon backend swap unchanged.
//
// FORMAT — newline-delimited JSON (NDJSON), one JSON object per line:
//   1. The FIRST line is a self-describing HEADER/manifest (`{ agentbbs_archive: 1, … }`)
//      declaring the format version + counts so an importer can validate compatibility
//      BEFORE replaying. It carries the closed EVENT_TYPES vocabulary the archive is
//      defined against (the model, not the schema).
//   2. Then one line PER EVENT, each the exact lossless `@agentbbs/core` `Event`
//      (`{ seq, type, actor, createdAt, payload }`), in ASCENDING `seq` order (the
//      authoritative total order — never `createdAt`). Event lines carry NO extra
//      discriminator field, so a parsed event line is byte-for-byte the `Event` shape —
//      the round-trip assertion (Story 11.2 AC6) compares parsed events directly to
//      `eventsSince(0)`.
//   3. Then one line PER STORED READ-STATE CURSOR (see the AC3 design decision below),
//      each tagged `{ agentbbs_read_state: { handle, cursor } }` so it is unambiguously
//      distinct from an event line.
//
// AC3 — READ-STATE / CURSORS (the load-bearing design decision; Rule 8 reconcile):
//   The per-identity `check` cursor (the `cursors` table — each handle's `maxReturned`
//   high-water mark) is the ONE append-invariant CARVE-OUT: a SEPARATE mutable table, NOT
//   an event. It is therefore NOT reconstructable from the event stream alone — an
//   `identity.seen` event records THAT a `check` happened but carries no `seq`, so the
//   stored `maxReturned` cannot be re-derived by re-running projections.
//
//   The ratified Epic-6 `core/ports.ts#getCursor` doc states cursors are "TRANSIENT
//   bookkeeping (NOT part of the FR32 export): on a fresh import each identity's cursor is
//   0 and they re-catch-up via the per-scope join floors." The epics.md Story 11.4
//   round-trip AC (line 1441) instead lists `cursors` among the derived state that must be
//   "identical" after export → import → compare. That is a genuine contradiction.
//
//   RESOLUTION (Rule 8 — reconcile on purpose, surfaced to the reviewer): the archive
//   CAPTURES each handle's stored cursor as a delimited read-state section. Capturing is a
//   strict SUPERSET — it does not force Story 11.3 to restore them (import may still reset
//   to 0 if it chooses), but it makes the FR34 "identical derived state INCLUDING cursors"
//   round-trip ACHIEVABLE, satisfying the story's explicit instruction not to ship an
//   archive that cannot faithfully round-trip `cursors`. This SUPERSEDES the ports.ts doc's
//   "NOT part of the FR32 export" sentence (a non-breaking, additive format choice — core
//   stays byte-identical per Rule 13; only the archive payload gains the read-state lines).
//
// This module is a thin CLI-layer codec (NOT in `core` — Rule 13 keeps the agent contract
// byte-identical). It is placed here so BOTH `export` (this story) and `import` (Story
// 11.3) can reuse one parse/serialize definition.

import { EVENT_TYPES } from '@agentbbs/core';

import type { Event } from '@agentbbs/core';

/** The archive format version (bumped only on a BREAKING format change — e.g. an AR9 rename). */
export const ARCHIVE_VERSION = 1;

/** The format discriminator carried in the header `format` field. */
export const ARCHIVE_FORMAT = 'ndjson-events';

/**
 * One stored per-identity read-state cursor — a `handle` and its `check` high-water-mark
 * `seq`. Captured in the archive so a round-trip can restore read-state (AC3).
 */
export interface ReadStateEntry {
  /** The canonical (lowercased) identity handle. */
  handle: string;
  /** The stored cursor `seq` (the max `seq` the handle's last `check` returned). */
  cursor: number;
}

/**
 * The self-describing archive header/manifest (the FIRST NDJSON line). Defined against the
 * EVENT MODEL (the closed `EVENT_TYPES` vocabulary), NOT the SQLite schema — so a future
 * backend can produce/consume the same archive. Carries the version + counts an importer
 * (Story 11.3) cross-checks before replaying.
 */
export interface ArchiveHeader {
  /** Format version (the discriminator that marks the FIRST line as the header). */
  agentbbs_archive: number;
  /** The format name (`ndjson-events`). */
  format: string;
  /** The number of event lines that follow. */
  event_count: number;
  /** The number of read-state (cursor) lines that follow the events. */
  cursor_count: number;
  /** When the archive was produced (ISO-8601 UTC; informational, never an order key). */
  exported_at: string;
  /** The closed event vocabulary this archive is defined against (the model, not SQLite). */
  event_types: readonly string[];
}

/** A parsed read-state NDJSON line: `{ agentbbs_read_state: { handle, cursor } }`. */
interface ReadStateLine {
  agentbbs_read_state: ReadStateEntry;
}

/** The whole logical archive payload: the events (seq-ordered) + the stored read-state. */
export interface ArchiveContents {
  /** All ledger events in ascending `seq` order (the `eventsSince(0)` total order). */
  events: readonly Event[];
  /** Each identity's stored `check` cursor (AC3 read-state). */
  readState: readonly ReadStateEntry[];
}

/** The fully-parsed archive: its header plus its contents. */
export interface ParsedArchive extends ArchiveContents {
  /** The archive header/manifest (the first line). */
  header: ArchiveHeader;
}

/** Type guard: a parsed object is the archive header (has the version discriminator). */
function isHeader(value: unknown): value is ArchiveHeader {
  return (
    typeof value === 'object' &&
    value !== null &&
    'agentbbs_archive' in value &&
    typeof (value as { agentbbs_archive: unknown }).agentbbs_archive ===
      'number'
  );
}

/** Type guard: a parsed object is a read-state line. */
function isReadStateLine(value: unknown): value is ReadStateLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    'agentbbs_read_state' in value &&
    typeof (value as { agentbbs_read_state: unknown }).agentbbs_read_state ===
      'object'
  );
}

/**
 * Build the archive header for a given event/cursor count. Defined against `EVENT_TYPES`
 * (the model), carries NO SQLite detail.
 *
 * @param eventCount The number of events in the archive.
 * @param cursorCount The number of read-state cursors in the archive.
 * @param exportedAt The export timestamp (ISO-8601 UTC). Injectable for deterministic tests.
 */
export function buildHeader(
  eventCount: number,
  cursorCount: number,
  exportedAt: string = new Date().toISOString(),
): ArchiveHeader {
  return {
    agentbbs_archive: ARCHIVE_VERSION,
    format: ARCHIVE_FORMAT,
    event_count: eventCount,
    cursor_count: cursorCount,
    exported_at: exportedAt,
    // The closed vocabulary the archive is defined against (sorted for a stable header).
    event_types: [...EVENT_TYPES].sort(),
  };
}

/**
 * Serialize an archive to NDJSON text: the header line first, then one line per event in
 * ascending `seq`, then one line per read-state cursor. Every line is a single
 * `JSON.stringify` (valid NDJSON — no binary, no base64). The returned string ends with a
 * trailing newline so it is append-safe and a clean POSIX text file.
 *
 * @param contents The events (already `seq`-ordered) + the stored read-state.
 * @param exportedAt The export timestamp (ISO-8601 UTC). Injectable for deterministic tests.
 * @returns The full NDJSON archive text (header + events + read-state), newline-terminated.
 */
export function serializeArchive(
  contents: ArchiveContents,
  exportedAt: string = new Date().toISOString(),
): string {
  // Defensive: emit events in ascending `seq` (the authoritative order) regardless of the
  // order the caller supplied them in.
  const events = [...contents.events].sort((a, b) => a.seq - b.seq);
  const header = buildHeader(
    events.length,
    contents.readState.length,
    exportedAt,
  );

  const lines: string[] = [JSON.stringify(header)];
  for (const event of events) {
    // Bare `Event` shape — no extra discriminator, so a parsed event line === the Event.
    lines.push(JSON.stringify(event));
  }
  for (const entry of contents.readState) {
    const line: ReadStateLine = { agentbbs_read_state: entry };
    lines.push(JSON.stringify(line));
  }
  return lines.join('\n') + '\n';
}

/**
 * Parse an NDJSON archive back into its header + contents (the inverse of
 * {@link serializeArchive}). Blank lines are ignored (a trailing newline is normal). The
 * FIRST non-blank line MUST be the header; read-state lines are recognized by their
 * `agentbbs_read_state` discriminator; every other line is an `Event`.
 *
 * @param text The NDJSON archive text.
 * @returns The parsed header, events (in file order — ascending `seq`), and read-state.
 * @throws If the archive is empty or its first line is not a valid header.
 */
export function parseArchive(text: string): ParsedArchive {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error('Invalid archive: empty (no header line).');
  }

  const firstLine = lines[0]!;
  const header: unknown = JSON.parse(firstLine);
  if (!isHeader(header)) {
    throw new Error(
      'Invalid archive: the first line is not an agentbbs_archive header.',
    );
  }

  const events: Event[] = [];
  const readState: ReadStateEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parsed: unknown = JSON.parse(lines[i]!);
    if (isReadStateLine(parsed)) {
      readState.push(parsed.agentbbs_read_state);
    } else {
      events.push(parsed as Event);
    }
  }

  return { header, events, readState };
}
