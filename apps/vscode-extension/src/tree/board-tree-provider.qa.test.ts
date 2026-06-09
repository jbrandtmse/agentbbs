// QA-added seam coverage for the `vscode`-facing BoardTreeProvider (Story 10.3, AC1/AC2) — the
// STRUCTURAL half of the Rule-15 contract the dev's coverage leaves untested.
//
// The dev pins the tree MODEL (tree-model.test.ts — `buildTreeModel` over a real node:sqlite
// ledger) and the model IN-HOST (host-tests/tree-model.in-host.ts). But NOTHING exercises the
// `vscode`-facing presenter — `BoardTreeProvider.getTreeItem`/`getChildren` — which is where the
// Rule-15 STRUCTURAL guarantee actually lives: a proto-room must be rendered as a SELECTABLE row
// that CARRIES the open command (not merely present in the model). AC2 / Rule 15 is "navigable
// BOTH as a model AND structurally (selectable row + open command)" — this file proves the
// structural half against the real provider, over a REAL node:sqlite ledger + REAL core ops
// (only `vscode` itself is mocked — it is host-provided, not an npm package, exactly as
// bundle-and-activation.test.ts mocks it).
//
// SEAMS crossed here (the QA value-add the dev skipped):
//   - (Rule 15 STRUCTURAL) a PENDING proto-room `getTreeItem` is selectable + carries
//     OPEN_ROOM_COMMAND with the roomId arg + a stable resourceUri — MUTATION-TESTED: dropping
//     the `command` on a pending row turns it RED (proves navigability, not just presence);
//   - `getChildren` returns the proto-room as its OWN navigable `room` node SIBLING of the active
//     room, AND keeps the `announcements (N)` indicator as a SEPARATE node (both, not one);
//   - de-dup + stable ORDER across a MULTI-room project (2 active, 2 pending) — active nodes
//     first, each roomId emitted exactly once (the dev's seed is single-active/single-proto);
//   - the operator-handle→NEEDS-YOU canonicalization seam END-TO-END: a mixed-case/whitespace
//     handle resolves + matches the `add_participant` escalation (the dev tests the canonicaliser
//     and the model SEPARATELY; nothing crosses them through the provider);
//   - refresh() fires onDidChangeTreeData (the live-refresh signal Story 10.6 leans on).
//
// Discoverable by the ROOT `pnpm test` (co-located apps/*/src/**/*.test.ts → node project; Rule 8).

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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOperatorHandle } from './operator-handle.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

// Mock `vscode` (host-provided, not an npm package) with the minimal surface the provider uses:
// TreeItem/ThemeIcon/EventEmitter/Uri/TreeItemCollapsibleState. Mirrors the double in
// bundle-and-activation.test.ts so importing BoardTreeProvider.js resolves in the node test env.
// The REAL VS Code rendering of these items is proven by the @vscode/test-electron host harness
// (Rule 12); here we assert the structural shape the provider PRODUCES.
vi.mock('vscode', () => {
  // A faithful-enough EventEmitter double: `.event` registers listeners, `.fire` invokes them —
  // so a test can OBSERVE that the provider's onDidChangeTreeData actually fired on refresh
  // (the real vscode.EventEmitter behaves this way). The no-op double in
  // bundle-and-activation.test.ts swallows listeners; this one must deliver them.
  class EventEmitter {
    private listeners: Array<(value: unknown) => void> = [];
    fire(value?: unknown): void {
      for (const l of this.listeners) l(value);
    }
    get event() {
      return (listener: (value: unknown) => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
    }
    dispose(): void {
      this.listeners = [];
    }
  }
  class TreeItem {
    public iconPath?: { id: string };
    public resourceUri?: { toString: () => string; scheme: string };
    public contextValue?: string;
    public description?: string | boolean;
    public command?: { command: string; title: string; arguments?: unknown[] };
    public tooltip?: string;
    constructor(
      public label: string,
      public collapsibleState?: number,
    ) {}
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    Uri: {
      parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0] }),
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  };
});

// Imported AFTER vi.mock so the provider binds to the mocked `vscode`.
const { BoardTreeProvider, OPEN_ROOM_COMMAND } =
  await import('./BoardTreeProvider.js');
const { roomUriString } = await import('./room-uri.js');

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-treeprov-'));
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
 * Seed a project with ONE active room (replied) + ONE pending proto-room (no reply). Returns the
 * ids so the tests can assert the active/pending split + the navigable proto-row.
 */
async function seedOneActiveOneProto(d: DataAccessHandle): Promise<{
  projectId: string;
  activeRoomId: string;
  protoRoomId: string;
}> {
  await register(d, { handle: 'alice', currentFocus: 'seeding' });
  await register(d, { handle: 'bob', currentFocus: 'replying' });
  const project = await announceProject(d, 'alice', {
    title: 'Provider Project',
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
  await reply(d, 'bob', { roomId: activeRoom.roomId, body: 'first reply' });
  return {
    projectId: project.projectId,
    activeRoomId: activeRoom.roomId,
    protoRoomId: protoRoom.roomId,
  };
}

describe('BoardTreeProvider — Rule-15 STRUCTURAL: a proto-room is a selectable, command-carrying row (AC2)', () => {
  it('the PENDING proto-room TreeItem is selectable AND carries the open command with its roomId (MUTATION target)', async () => {
    const { projectId, protoRoomId } = await seedOneActiveOneProto(da!);
    const provider = new BoardTreeProvider(da!, null);
    await provider.refresh();

    // Find the proto-room ROW node among the project's children.
    const projectChildren = provider.getChildren({
      kind: 'project',
      projectId,
    });
    const protoNode = projectChildren.find(
      (n) => n.kind === 'room' && n.row.roomId === protoRoomId,
    );
    expect(protoNode).toBeDefined();

    const item = provider.getTreeItem(protoNode!);

    // MARQUEE STRUCTURAL ASSERTION (mutation target): the pending row CARRIES the open command
    // with its roomId — it is NAVIGABLE, not a dead label. Removing the `command` from a pending
    // row in getTreeItem (the 9.11 "counted but unreachable" regression) MUST turn this RED.
    expect(item.command).toBeDefined();
    expect(item.command!.command).toBe(OPEN_ROOM_COMMAND);
    expect(item.command!.arguments).toEqual([protoRoomId]);
    // …and it is keyed by the stable agentbbs:// room URI (the decoration link) + flagged as a
    // proto-room context (the pending styling the wireframe encodes).
    expect(item.resourceUri!.toString()).toBe(roomUriString(protoRoomId));
    expect(item.contextValue).toBe('agentbbs.protoRoom');
  });

  it('the ACTIVE room row also carries the open command (parity with the proto-row) but is NOT proto-styled', async () => {
    const { projectId, activeRoomId } = await seedOneActiveOneProto(da!);
    const provider = new BoardTreeProvider(da!, null);
    await provider.refresh();

    const projectChildren = provider.getChildren({
      kind: 'project',
      projectId,
    });
    const activeNode = projectChildren.find(
      (n) => n.kind === 'room' && n.row.roomId === activeRoomId,
    );
    const item = provider.getTreeItem(activeNode!);
    expect(item.command!.command).toBe(OPEN_ROOM_COMMAND);
    expect(item.command!.arguments).toEqual([activeRoomId]);
    expect(item.contextValue).toBe('agentbbs.room');
  });

  it('getChildren keeps the announcements (N) indicator as a SEPARATE node from the navigable proto-row (both, not one)', async () => {
    const { projectId, protoRoomId } = await seedOneActiveOneProto(da!);
    const provider = new BoardTreeProvider(da!, null);
    await provider.refresh();

    const children = provider.getChildren({ kind: 'project', projectId });
    // The announcements indicator node is present with the proto-room COUNT (1).
    const indicator = children.find((n) => n.kind === 'announcementsIndicator');
    expect(indicator).toBeDefined();
    expect(
      indicator!.kind === 'announcementsIndicator' && indicator!.count,
    ).toBe(1);
    // …AND the proto-room is STILL its own navigable room node (the count did not absorb it).
    const protoRowNode = children.find(
      (n) => n.kind === 'room' && n.row.roomId === protoRoomId && n.row.pending,
    );
    expect(protoRowNode).toBeDefined();
  });
});

describe('BoardTreeProvider — de-dup + stable order across a MULTI-room project', () => {
  it('two active + two pending rooms: active nodes render FIRST, each roomId appears exactly once', async () => {
    await register(da!, { handle: 'alice', currentFocus: 'seeding' });
    await register(da!, { handle: 'bob', currentFocus: 'replying' });
    const project = await announceProject(da!, 'alice', {
      title: 'Multi Project',
      description: 'desc',
    });
    const a1 = await postAnnouncement(da!, 'alice', {
      projectId: project.projectId,
      subject: 'Active 1',
      body: 'b',
    });
    const a2 = await postAnnouncement(da!, 'alice', {
      projectId: project.projectId,
      subject: 'Active 2',
      body: 'b',
    });
    const p1 = await postAnnouncement(da!, 'alice', {
      projectId: project.projectId,
      subject: 'Proto 1',
      body: 'b',
    });
    const p2 = await postAnnouncement(da!, 'alice', {
      projectId: project.projectId,
      subject: 'Proto 2',
      body: 'b',
    });
    await reply(da!, 'bob', { roomId: a1.roomId, body: 'r' });
    await reply(da!, 'bob', { roomId: a2.roomId, body: 'r' });

    const provider = new BoardTreeProvider(da!, null);
    await provider.refresh();

    const roomNodes = provider
      .getChildren({ kind: 'project', projectId: project.projectId })
      .filter((n) => n.kind === 'room');
    const ids = roomNodes.map((n) => (n.kind === 'room' ? n.row.roomId : ''));

    // No roomId is emitted twice (de-dup holds across multiple rooms).
    expect(new Set(ids).size).toBe(ids.length);
    // Both active rooms come before both pending rooms (the active-first split).
    const lastActiveIdx = Math.max(
      ids.indexOf(a1.roomId),
      ids.indexOf(a2.roomId),
    );
    const firstPendingIdx = Math.min(
      ids.indexOf(p1.roomId),
      ids.indexOf(p2.roomId),
    );
    expect(lastActiveIdx).toBeLessThan(firstPendingIdx);
    // Each pending row is flagged pending; each active row is not.
    for (const node of roomNodes) {
      if (node.kind !== 'room') continue;
      const isPending =
        node.row.roomId === p1.roomId || node.row.roomId === p2.roomId;
      expect(node.row.pending).toBe(isPending);
    }
  });
});

describe('BoardTreeProvider — operator-handle → NEEDS YOU canonicalization seam (end-to-end)', () => {
  it('a mixed-case/whitespace operator handle resolves + matches the add_participant escalation', async () => {
    const { activeRoomId } = await seedOneActiveOneProto(da!);
    // The escalation targets the canonical (lowercased) handle core stores.
    await register(da!, { handle: 'operator', currentFocus: 'watching' });
    await addParticipant(da!, 'bob', {
      roomId: activeRoomId,
      handle: 'operator',
    });

    // The operator configures their handle with stray case + whitespace (the realistic setting
    // value). resolveOperatorHandle must canonicalize it so the NEEDS YOU match lands — this is
    // the operator-handle ↔ tree-model seam neither dev test crosses.
    const resolved = resolveOperatorHandle('  OPERATOR  ', {});
    expect(resolved).toBe('operator');

    const provider = new BoardTreeProvider(da!, resolved);
    await provider.refresh();

    // The NEEDS YOU bucket carries the escalated room…
    const bucketChildren = provider.getChildren({ kind: 'needsYouBucket' });
    const escalated = bucketChildren.find(
      (n) => n.kind === 'needsYouRoom' && n.room.roomId === activeRoomId,
    );
    expect(escalated).toBeDefined();
    // …and the bucket label reflects the count.
    const item = provider.getTreeItem({ kind: 'needsYouBucket' });
    expect(item.label).toBe('NEEDS YOU (1)');
  });

  it('a watching-only operator (null handle, e.g. a blank setting + no env) has an empty NEEDS YOU bucket', async () => {
    const { activeRoomId } = await seedOneActiveOneProto(da!);
    await register(da!, { handle: 'operator', currentFocus: 'watching' });
    await addParticipant(da!, 'bob', {
      roomId: activeRoomId,
      handle: 'operator',
    });

    // A blank setting + empty env → null (watching-only): global read still works, but the
    // personalized escalation queue is empty.
    const resolved = resolveOperatorHandle('   ', {});
    expect(resolved).toBeNull();

    const provider = new BoardTreeProvider(da!, resolved);
    await provider.refresh();
    expect(provider.getChildren({ kind: 'needsYouBucket' })).toEqual([]);
    const item = provider.getTreeItem({ kind: 'needsYouBucket' });
    expect(item.label).toBe('NEEDS YOU (0)');
  });
});

describe('BoardTreeProvider — refresh signals + lifecycle', () => {
  it('refresh() fires onDidChangeTreeData so the view re-queries (the live-refresh signal)', async () => {
    await seedOneActiveOneProto(da!);
    const provider = new BoardTreeProvider(da!, null);

    // Subscribe to the change event (the same channel VS Code subscribes to). A refresh MUST
    // deliver a tick so the view re-queries getChildren — the live-refresh contract Story 10.6
    // leans on. (The mocked EventEmitter delivers fires to registered listeners.)
    let fired = 0;
    provider.onDidChangeTreeData(() => {
      fired += 1;
    });

    expect(provider.getChildren()).toEqual([]); // no model snapshot yet
    await provider.refresh();
    expect(fired).toBe(1); // the change signal fired exactly once

    const roots = provider.getChildren();
    // Roots = the NEEDS YOU bucket + the project + the join-a-project action row.
    expect(roots.some((n) => n.kind === 'needsYouBucket')).toBe(true);
    expect(roots.some((n) => n.kind === 'project')).toBe(true);
    expect(roots.some((n) => n.kind === 'joinProjectAction')).toBe(true);
  });

  it('getChildren returns [] before the first refresh (no model snapshot yet)', async () => {
    const provider = new BoardTreeProvider(da!, null);
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getChildren({ kind: 'needsYouBucket' })).toEqual([]);
  });

  it('dispose() is a safe no-op (idempotent teardown)', async () => {
    const provider = new BoardTreeProvider(da!, null);
    await provider.refresh();
    expect(() => provider.dispose()).not.toThrow();
    expect(() => provider.dispose()).not.toThrow();
  });
});
