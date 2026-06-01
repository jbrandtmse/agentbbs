// QA hardening — drift guard pinning the HOST JSON-API wire shapes to the ratified
// tool contract (Story 9.3, skill-rules Rule 10).
//
// The host's `wire.ts` is a SECOND, INDEPENDENT copy of the snake_case envelope
// mappers (the mcp-server has its own in `tools/*-shared.ts`). The host comment says
// they "are DEFINED here rather than imported from mcp-server because cli must not take
// a workspace dependency on mcp-server (NFR2)". Two independent copies of a wire
// contract are exactly where silent drift creeps in: a field renamed on one surface and
// not the other makes the two operator/agent views disagree, and `wire.test.ts` (which
// only checks the host mapper against hand-written literals) would NOT catch it.
//
// `docs/mcp-tool-contract.md` §3 is the RATIFIED source of truth BOTH surfaces mirror
// (it is itself code-pinned by mcp-server's `tool-contract.drift.test.ts`). So this test
// pins the HOST mappers' emitted field sets to the field lists documented there — a
// boundary-safe drift check (a cli test reading a doc, NOT importing mcp-server, so the
// NFR2 boundary the on-demand.nfr test enforces is untouched).
//
// Parse target: the documented result shapes are backtick-delimited brace lists in the
// §3 tool entries, e.g. `{ project_id, title, description, announcer, members }`. We
// extract the field-name set from the doc and assert the host mapper emits EXACTLY that
// set. A field renamed in `wire.ts` (or added/dropped) without a matching contract edit
// turns this RED.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  memberToWire,
  messageToWire,
  projectToWire,
  roomToWire,
} from './wire.js';

import type {
  DirectoryMember,
  Project,
  Room,
  RoomMessage,
} from '@agentbbs/core';

const CONTRACT_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'mcp-tool-contract.md',
);

const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');

/** Parse a `{ a, b, c }` brace body into a trimmed field-name set. */
function parseBraceFields(braceBody: string): Set<string> {
  return new Set(
    braceBody
      .split(',')
      .map((f) => f.trim().replace(/[`?]/g, ''))
      .filter((f) => f.length > 0),
  );
}

/**
 * Extract the documented field set of a named tool's result, in the §3 entry. Some
 * results are a simple shape (`list_projects` → `{ project_id, ... }`); others wrap a
 * sub-shape (`post_announcement` → `{ room }` where `room` is `{ room_id, ... }`). We
 * scan a generous window after the tool's `**Result:**` marker for ALL `{ ... }` brace
 * groups and pick the one CONTAINING `anchorField` (e.g. `room_id` for a room shape,
 * `project_id` for a project shape) — so a wrapper envelope like `{ room }` is skipped
 * in favor of the actual field-bearing shape.
 */
function docResultFields(toolName: string, anchorField: string): Set<string> {
  const headingIdx = doc.indexOf('#### `' + toolName + '`');
  if (headingIdx === -1) {
    throw new Error(
      `Tool heading "#### \`${toolName}\`" not found in contract doc`,
    );
  }
  const resultIdx = doc.indexOf('**Result:**', headingIdx);
  if (resultIdx === -1) {
    throw new Error(`No **Result:** line found for "${toolName}"`);
  }
  const window = doc.slice(resultIdx, resultIdx + 600);
  const braces = [...window.matchAll(/\{([^{}]*)\}/g)];
  for (const b of braces) {
    const fields = parseBraceFields(b[1]);
    if (fields.has(anchorField)) return fields;
  }
  throw new Error(
    `No result shape containing "${anchorField}" found for "${toolName}"`,
  );
}

describe('host wire shapes are pinned to the ratified tool contract (Rule 10 drift guard)', () => {
  it('sanity: the parser extracts a known field set (guards against a vacuous parse)', () => {
    // If the doc format moves and the parser silently returns {} every shape would
    // trivially "match" by being a subset check — so assert a concrete known set here.
    expect(docResultFields('announce_project', 'project_id')).toEqual(
      new Set(['project_id', 'title', 'description', 'announcer', 'members']),
    );
  });

  it('projectToWire emits exactly the documented project field set', () => {
    const project: Project = {
      projectId: 'p',
      title: 't',
      description: 'd',
      announcer: 'alice',
      seq: 2,
      members: ['alice'],
    };
    // The directory / list_projects / announce_project / join_board element is all the
    // same project shape — pin to it.
    const projectFields = docResultFields('announce_project', 'project_id');
    expect(new Set(Object.keys(projectToWire(project)))).toEqual(projectFields);
    // The list_projects element shape agrees (same field set).
    expect(docResultFields('list_projects', 'project_id')).toEqual(
      projectFields,
    );
  });

  it('memberToWire emits exactly the documented member field set (list_members)', () => {
    const member: DirectoryMember = {
      handle: 'alice',
      currentFocus: 'f',
      lastSeen: '2026-06-01T00:00:00.000Z',
    };
    expect(new Set(Object.keys(memberToWire(member)))).toEqual(
      docResultFields('list_members', 'handle'),
    );
  });

  it('roomToWire (active) emits exactly the documented active-room field set (reply)', () => {
    const active: Room = {
      roomId: 'r',
      projectId: 'p',
      subject: 's',
      body: 'b',
      postedBy: 'alice',
      seq: 5,
      active: true,
      activatedBy: 'bob',
      activatedAtSeq: 6,
    };
    // `reply`'s result room is the fully-active room shape (incl. activator fields).
    expect(new Set(Object.keys(roomToWire(active)))).toEqual(
      docResultFields('reply', 'room_id'),
    );
  });

  it('roomToWire (proto) emits exactly the documented proto-room field set (post_announcement)', () => {
    const proto: Room = {
      roomId: 'r',
      projectId: 'p',
      subject: 's',
      body: 'b',
      postedBy: 'alice',
      seq: 5,
      active: false,
      activatedBy: undefined,
      activatedAtSeq: undefined,
    };
    // A proto-room omits the activator fields — exactly the post_announcement shape.
    expect(new Set(Object.keys(roomToWire(proto)))).toEqual(
      docResultFields('post_announcement', 'room_id'),
    );
  });

  it('messageToWire emits exactly the documented message field set (read_room messages)', () => {
    const message: RoomMessage = {
      seq: 4,
      actor: 'alice',
      body: 'hi',
      kind: 'reply',
      reactions: [],
    };
    // read_room documents messages as `{ seq, actor, body, kind, reactions }`. Scan
    // the read_room §3 entry (up to the next tool heading) for the brace group that
    // carries `kind` — the message shape (the room shape has no `kind`).
    const start = doc.indexOf('#### `read_room`');
    const next = doc.indexOf('#### `', start + 1);
    const window = doc.slice(start, next === -1 ? undefined : next);
    const documented = [...window.matchAll(/\{([^{}]*)\}/g)]
      .map(
        (m) =>
          new Set(
            m[1]
              .split(',')
              .map((f) => f.trim().replace(/[`?]/g, ''))
              .filter((f) => f.length > 0),
          ),
      )
      .find((s) => s.has('kind'));
    expect(documented).toBeDefined();
    expect(new Set(Object.keys(messageToWire(message)))).toEqual(documented);
  });
});
