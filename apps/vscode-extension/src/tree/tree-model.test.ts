// The native tree-model builder tests (Story 10.3, AC1/AC2) — REAL core ops over a REAL
// node:sqlite data-access handle on a genuine temp ledger (the SAME adapter the extension host
// uses). Nothing about the tree fold is stubbed; it composes the real core projections.
// Discoverable by the ROOT `pnpm test` (co-located apps/*/src/**/*.test.ts → node project; Rule 8).
//
// MARQUEE: AC2 / Rule 15 — proto-rooms are NAVIGABLE ROWS (siblings of active rooms), not merely
// counted. The "proto-room is present as a navigable row" assertion is MUTATION-TESTED below
// (the count-only regression must turn it RED) — see the mutation note in
// `tree-model.test.MUTATION.md` instructions and the explicit assertion comments.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addParticipant,
  announceProject,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccessNodeSqlite } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTreeModel } from './tree-model.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-tree-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  da = createDataAccessNodeSqlite({ dbPath });
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

/**
 * Seed: a project with TWO announcements — one ACTIVATED (a reply turned it into a live room)
 * and one still PENDING (a proto-room no one has replied to). Returns both room ids + the
 * project id so the tests can assert the active/pending split.
 */
async function seedProjectWithActiveAndProto(d: DataAccessHandle): Promise<{
  projectId: string;
  activeRoomId: string;
  protoRoomId: string;
}> {
  await register(d, { handle: 'alice', currentFocus: 'seeding' });
  await register(d, { handle: 'bob', currentFocus: 'replying' });
  const project = await announceProject(d, 'alice', {
    title: 'Test Project',
    description: 'desc',
  });
  const activeRoom = await postAnnouncement(d, 'alice', {
    projectId: project.projectId,
    subject: 'Active subject',
    body: 'Active body',
  });
  const protoRoom = await postAnnouncement(d, 'alice', {
    projectId: project.projectId,
    subject: 'Proto subject',
    body: 'Proto body',
  });
  // A reply activates the first room (active=true); the second stays a proto-room.
  await reply(d, 'bob', { roomId: activeRoom.roomId, body: 'first reply' });
  return {
    projectId: project.projectId,
    activeRoomId: activeRoom.roomId,
    protoRoomId: protoRoom.roomId,
  };
}

describe('buildTreeModel — hierarchy (AC1)', () => {
  it('returns every project (global read) with its title', async () => {
    const { projectId } = await seedProjectWithActiveAndProto(da!);
    const model = await buildTreeModel(da!, null);
    expect(model.projects.map((p) => p.projectId)).toContain(projectId);
    const project = model.projects.find((p) => p.projectId === projectId)!;
    expect(project.title).toBe('Test Project');
  });

  it('an empty ledger yields no projects and an empty NEEDS YOU bucket', async () => {
    const model = await buildTreeModel(da!, 'alice');
    expect(model.projects).toEqual([]);
    expect(model.needsYou).toEqual([]);
  });
});

describe('buildTreeModel — Rule 15: proto-rooms are NAVIGABLE rows (AC2)', () => {
  it('renders the proto-room as a sibling navigable row (NOT merely counted)', async () => {
    const { projectId, activeRoomId, protoRoomId } =
      await seedProjectWithActiveAndProto(da!);
    const model = await buildTreeModel(da!, null);
    const project = model.projects.find((p) => p.projectId === projectId)!;

    // MARQUEE ASSERTION (mutation target): the proto-room MUST be present as a ROW in the
    // project's `rooms` (a navigable, selectable sibling). A "count-only, no navigable row"
    // implementation (e.g. filtering proto-rooms out of `rooms` and only bumping
    // announcementCount) MUST turn THIS assertion RED.
    const protoRow = project.rooms.find((r) => r.roomId === protoRoomId);
    expect(protoRow).toBeDefined();
    expect(protoRow!.pending).toBe(true);
    expect(protoRow!.subject).toBe('Proto subject');

    // The active room is also a row, marked NOT pending.
    const activeRow = project.rooms.find((r) => r.roomId === activeRoomId);
    expect(activeRow).toBeDefined();
    expect(activeRow!.pending).toBe(false);
  });

  it('orders active rooms FIRST, then pending proto-rooms (stable order)', async () => {
    const { projectId, activeRoomId, protoRoomId } =
      await seedProjectWithActiveAndProto(da!);
    const model = await buildTreeModel(da!, null);
    const project = model.projects.find((p) => p.projectId === projectId)!;
    const order = project.rooms.map((r) => r.roomId);
    expect(order.indexOf(activeRoomId)).toBeLessThan(
      order.indexOf(protoRoomId),
    );
  });

  it('a room that becomes active never ALSO appears as a stale proto-row (de-dup)', async () => {
    const { projectId, activeRoomId } = await seedProjectWithActiveAndProto(
      da!,
    );
    const model = await buildTreeModel(da!, null);
    const project = model.projects.find((p) => p.projectId === projectId)!;
    const occurrences = project.rooms.filter((r) => r.roomId === activeRoomId);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.pending).toBe(false);
  });

  it('keeps the announcements (N) count as a SEPARATE indicator from the navigable rows', async () => {
    const { projectId, protoRoomId } = await seedProjectWithActiveAndProto(da!);
    const model = await buildTreeModel(da!, null);
    const project = model.projects.find((p) => p.projectId === projectId)!;
    // listAnnouncements returns proto-rooms (active=false); here exactly ONE remains pending.
    expect(project.announcementCount).toBe(1);
    // …and that proto-room is STILL a navigable row (both, not one-or-the-other).
    expect(
      project.rooms.some((r) => r.roomId === protoRoomId && r.pending),
    ).toBe(true);
  });
});

describe('buildTreeModel — NEEDS YOU + unread (AC3 source state)', () => {
  it('NEEDS YOU = the add_participant(@operator) set (deterministic, not a heuristic)', async () => {
    const { projectId, activeRoomId } = await seedProjectWithActiveAndProto(
      da!,
    );
    await register(da!, { handle: 'operator', currentFocus: 'watching' });
    // bob (a participant via his reply) pulls @operator into the active room.
    await addParticipant(da!, 'bob', {
      roomId: activeRoomId,
      handle: 'operator',
    });

    const model = await buildTreeModel(da!, 'operator');
    // The bucket carries the escalated room.
    expect(model.needsYou.map((r) => r.roomId)).toContain(activeRoomId);
    // …and the per-row flag is set on that room.
    const project = model.projects.find((p) => p.projectId === projectId)!;
    const row = project.rooms.find((r) => r.roomId === activeRoomId)!;
    expect(row.needsYou).toBe(true);
  });

  it('a watching-only operator (null handle) has an empty NEEDS YOU + calm rooms', async () => {
    await seedProjectWithActiveAndProto(da!);
    const model = await buildTreeModel(da!, null);
    expect(model.needsYou).toEqual([]);
    for (const project of model.projects) {
      for (const row of project.rooms) {
        expect(row.needsYou).toBe(false);
        expect(row.unread).toBe(false);
        expect(row.unreadCount).toBe(0);
      }
    }
  });

  it('unread = messages newer than the operator join floor; participant sees later replies', async () => {
    const { activeRoomId, projectId } = await seedProjectWithActiveAndProto(
      da!,
    );
    // @operator joins the active room (a reply = grant-on-act), establishing their join floor.
    await register(da!, { handle: 'operator', currentFocus: 'joining' });
    await reply(da!, 'operator', {
      roomId: activeRoomId,
      body: 'operator joins',
    });
    // A later reply by bob is NEW for the operator (seq > their join floor).
    await reply(da!, 'bob', { roomId: activeRoomId, body: 'later reply' });

    const model = await buildTreeModel(da!, 'operator');
    const project = model.projects.find((p) => p.projectId === projectId)!;
    const row = project.rooms.find((r) => r.roomId === activeRoomId)!;
    expect(row.unread).toBe(true);
    expect(row.unreadCount).toBe(1);
  });

  it('a room with no new activity since the operator joined is calm (read)', async () => {
    const { activeRoomId, projectId } = await seedProjectWithActiveAndProto(
      da!,
    );
    await register(da!, { handle: 'operator', currentFocus: 'joining' });
    // The operator's own joining reply is the LAST message → nothing newer → read.
    await reply(da!, 'operator', {
      roomId: activeRoomId,
      body: 'operator joins last',
    });

    const model = await buildTreeModel(da!, 'operator');
    const project = model.projects.find((p) => p.projectId === projectId)!;
    const row = project.rooms.find((r) => r.roomId === activeRoomId)!;
    expect(row.unread).toBe(false);
    expect(row.unreadCount).toBe(0);
  });
});
