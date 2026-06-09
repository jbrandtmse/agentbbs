// QA-added seam coverage for the `vscode`-facing BoardDecorationProvider (Story 10.3, AC3) — the
// decoration PROVIDER seam, distinct from the pure decoration-model the dev pins.
//
// The dev's decoration-model.test.ts pins the PURE mapping (`roomDecoration`/`unreadBadge` — the
// badge cap boundary + needs/unread precedence). But the `vscode`-facing
// BoardDecorationProvider.provideFileDecoration — which looks the room up FROM THE LIVE MODEL by
// its agentbbs:// URI, applies the cap+precedence, and returns a real `vscode.FileDecoration` (or
// undefined for calm) — has NO coverage. That lookup+wrap is the seam VS Code actually calls; a
// bug there (wrong scheme guard, missing room → wrong badge, decorating a calm room) ships green
// against the pure-model tests.
//
// SEAMS crossed here (the QA value-add):
//   - provideFileDecoration RETURNS a FileDecoration for an unread room with the COUNT in the
//     badge + the unread color (the model→FileDecoration wrap, end-to-end by URI lookup);
//   - NEEDS YOU OUTRANKS unread on the SAME room AT THE PROVIDER (precedence through the lookup,
//     not just in the pure model) — MUTATION-TESTED implicitly by the precedence assertion;
//   - a READ/calm room → undefined (NO decoration) — the 0-unread → no-badge boundary AT the
//     provider;
//   - the badge 2-char CAP holds through the provider: 99 verbatim, 100 → `•` (≤2 chars);
//   - a FOREIGN-scheme URI (file://) and an UNKNOWN room URI → undefined (the provider decorates
//     only its own rooms — never a stray editor file);
//   - refresh() fires onDidChangeFileDecorations (the re-query signal paired with the tree's).
//
// It drives the provider against a FAKE ModelSource holding a hand-built BoardTreeModel (the
// provider only needs `getModel()` — this isolates the wrap/lookup/cap logic from the ledger,
// which tree-model.test.ts already covers against real SQLite). Only `vscode` is mocked.
//
// Discoverable by the ROOT `pnpm test` (co-located apps/*/src/**/*.test.ts → node project; Rule 8).

import { describe, expect, it, vi } from 'vitest';

import {
  NEEDS_YOU_BADGE,
  NEEDS_YOU_COLOR_ID,
  UNREAD_BADGE,
  UNREAD_COLOR_ID,
  BADGE_MAX_LENGTH,
} from './decoration-model.js';
import { roomUriString } from './room-uri.js';

// Type-only import (erased at compile time — does NOT interfere with the dynamic `await
// import('vscode')` value the vi.mock supplies below): names the real `Uri` type so the `decorate`
// helper's provider param matches the real `provideFileDecoration(uri: vscode.Uri)` signature
// under strictFunctionTypes.
import type { Uri as VscodeUri } from 'vscode';

import type { BoardTreeModel, TreeRoomRow } from './tree-model.js';

// Minimal `vscode` double: FileDecoration (badge/tooltip/color), ThemeColor, EventEmitter, Uri.
// The real editor rendering is proven by the host harness (Rule 12); here we assert the
// FileDecoration the provider PRODUCES.
vi.mock('vscode', () => {
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
  class ThemeColor {
    constructor(public id: string) {}
  }
  class FileDecoration {
    constructor(
      public badge?: string,
      public tooltip?: string,
      public color?: { id: string },
    ) {}
  }
  return {
    EventEmitter,
    ThemeColor,
    FileDecoration,
    Uri: {
      parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0] }),
    },
  };
});

const { BoardDecorationProvider } = await import('./decorations.js');
const vscode = await import('vscode');

/** A room row with explicit decoration-relevant state (the rest is filler). */
function row(roomId: string, state: Partial<TreeRoomRow>): TreeRoomRow {
  return {
    roomId,
    projectId: 'proj',
    subject: 'subj',
    pending: false,
    needsYou: false,
    unread: false,
    unreadCount: 0,
    ...state,
  };
}

/** A model holding a single project with the given rows. */
function modelWith(rows: TreeRoomRow[]): BoardTreeModel {
  return {
    operatorHandle: 'operator',
    needsYou: [],
    projects: [
      {
        projectId: 'proj',
        title: 'Proj',
        announcementCount: 0,
        rooms: rows,
      },
    ],
  };
}

/** A fake ModelSource returning a fixed snapshot. */
function source(model: BoardTreeModel | undefined) {
  return { getModel: () => model };
}

/**
 * Resolve provideFileDecoration to its (possibly async) value. The param accepts the REAL
 * provider shape (`provideFileDecoration(uri: vscode.Uri)`); typing it as `(uri: unknown) => …`
 * is contravariantly INCOMPATIBLE with the real `(uri: Uri) => …` under strictFunctionTypes (a
 * pre-existing aggregate-typecheck escape surfaced by @types/vscode 1.120.0's Uri — Rule 3:
 * the installed types are authoritative). Take a `vscode.Uri`-shaped param so it matches.
 */
async function decorate(
  provider: { provideFileDecoration: (uri: VscodeUri) => unknown },
  uri: string,
) {
  return await provider.provideFileDecoration(vscode.Uri.parse(uri));
}

describe('BoardDecorationProvider.provideFileDecoration — the model→FileDecoration wrap (AC3)', () => {
  it('an UNREAD room → a FileDecoration carrying the count badge + the unread color', async () => {
    const rid = 'r-unread';
    const provider = new BoardDecorationProvider(
      source(modelWith([row(rid, { unread: true, unreadCount: 3 })])),
    );
    const deco = (await decorate(provider, roomUriString(rid))) as {
      badge?: string;
      color?: { id: string };
    };
    expect(deco).toBeDefined();
    expect(deco.badge).toBe('3');
    expect(deco.color!.id).toBe(UNREAD_COLOR_ID);
  });

  it('NEEDS YOU OUTRANKS unread on the SAME room (precedence holds through the provider lookup)', async () => {
    const rid = 'r-both';
    const provider = new BoardDecorationProvider(
      source(
        modelWith([
          row(rid, { needsYou: true, unread: true, unreadCount: 42 }),
        ]),
      ),
    );
    const deco = (await decorate(provider, roomUriString(rid))) as {
      badge?: string;
      color?: { id: string };
    };
    // The escalation wins: the ! badge + needs color, NOT the unread count/color.
    expect(deco.badge).toBe(NEEDS_YOU_BADGE);
    expect(deco.color!.id).toBe(NEEDS_YOU_COLOR_ID);
  });

  it('a READ/calm room (0 unread, no needs) → undefined (NO decoration — the no-badge boundary)', async () => {
    const rid = 'r-calm';
    const provider = new BoardDecorationProvider(
      source(modelWith([row(rid, { unread: false, unreadCount: 0 })])),
    );
    expect(await decorate(provider, roomUriString(rid))).toBeUndefined();
  });
});

describe('BoardDecorationProvider — the badge 2-char cap holds through the provider', () => {
  it('99 unread → verbatim "99" (the last value that fits the cap)', async () => {
    const rid = 'r-99';
    const provider = new BoardDecorationProvider(
      source(modelWith([row(rid, { unread: true, unreadCount: 99 })])),
    );
    const deco = (await decorate(provider, roomUriString(rid))) as {
      badge?: string;
    };
    expect(deco.badge).toBe('99');
    expect(deco.badge!.length).toBeLessThanOrEqual(BADGE_MAX_LENGTH);
  });

  it('100 unread → collapses to the • glyph (≤2 chars — never overflows the API cap)', async () => {
    const rid = 'r-100';
    const provider = new BoardDecorationProvider(
      source(modelWith([row(rid, { unread: true, unreadCount: 100 })])),
    );
    const deco = (await decorate(provider, roomUriString(rid))) as {
      badge?: string;
    };
    expect(deco.badge).toBe(UNREAD_BADGE);
    expect(deco.badge!.length).toBeLessThanOrEqual(BADGE_MAX_LENGTH);
  });
});

describe('BoardDecorationProvider — decorates ONLY its own rooms (never a stray editor file)', () => {
  it('a FOREIGN-scheme URI (file://) → undefined (the provider ignores non-agentbbs URIs)', async () => {
    const provider = new BoardDecorationProvider(
      source(modelWith([row('r-x', { unread: true, unreadCount: 1 })])),
    );
    // A real editor file the user has open — the provider must NOT decorate it.
    expect(await decorate(provider, 'file:///etc/passwd')).toBeUndefined();
  });

  it('an agentbbs room URI NOT in the model → undefined (unknown room, no stale badge)', async () => {
    const provider = new BoardDecorationProvider(
      source(modelWith([row('r-known', { unread: true, unreadCount: 1 })])),
    );
    expect(
      await decorate(provider, roomUriString('r-not-in-model')),
    ).toBeUndefined();
  });

  it('no model snapshot yet → undefined (nothing to decorate before the first refresh)', async () => {
    const provider = new BoardDecorationProvider(source(undefined));
    expect(
      await decorate(provider, roomUriString('r-anything')),
    ).toBeUndefined();
  });
});

describe('BoardDecorationProvider — refresh signal + lifecycle', () => {
  it('refresh() fires onDidChangeFileDecorations so VS Code re-queries decorations', () => {
    const provider = new BoardDecorationProvider(source(modelWith([])));
    let fired = 0;
    provider.onDidChangeFileDecorations(() => {
      fired += 1;
    });
    provider.refresh();
    expect(fired).toBe(1);
  });

  it('dispose() is a safe no-op (idempotent teardown)', () => {
    const provider = new BoardDecorationProvider(source(modelWith([])));
    expect(() => provider.dispose()).not.toThrow();
    expect(() => provider.dispose()).not.toThrow();
  });
});
