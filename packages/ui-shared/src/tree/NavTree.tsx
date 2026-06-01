// NavTree — the operator's sidebar navigation tree (Story 9.4 / AC #1, #2, #3).
//
// The global-read board map: an `AgentBBS` header, the operator `@handle (you)` row, the
// pinned `NEEDS YOU (n)` escalation section (only when n>0), one collapsible section per
// project (a twisty → an `* announcements` bucket + its `#room` rows), and a
// `＋ join a project…` action row. Every project/room the host returns is listed REGARDLESS
// of membership (FR28 global read) — the tree is a browse surface for the whole board.
//
// PROP-DRIVEN + PRESENTATION-ONLY (NFR2): NavTree imports nothing from @agentbbs/core or
// @agentbbs/data-access. It renders a {@link NavTreeModel} the surface builds from the host
// JSON API (apps/web) — so the SAME component can be reused by the VS Code surface (Epic 10)
// against a model it builds from postMessage. The `•/°/!/*` web glyphs + 2px rail are the
// WEB rendering (per-surface delta); the model is surface-agnostic.
//
// DECORATIONS (AC2): a room row carries `unread` (→ `•` accent glyph + an activity-count
// badge) vs read (→ `°` faint glyph, no badge); the active room carries the 2px accent left
// rail. The surface folds SSE deltas into the model to update these live (apps/web wiring).
//
// NEEDS YOU (AC3): the pinned section + each escalated room row's `!` flag-warm glyph come
// straight from the model's `needsYou` set — which the host derives DETERMINISTICALLY from
// add_participant(@operator), NEVER from time/inactivity. NavTree only renders what the
// model says; it has no clock. Warm, never red.
//
// a11y (Story 9.10 owns the full floor): the markup uses semantic <ul role="tree"> /
// <li role="treeitem"> structure so 9.10 can add keyboard nav + ARIA without reshaping it.
// React 19 automatic JSX runtime.

import { SectionLabel } from './SectionLabel.js';
import { SidebarTreeItem } from './SidebarTreeItem.js';
import { NeedsYouItem } from './NeedsYouItem.js';

import type { CSSProperties } from 'react';

/** One room row in the tree model (decorations pre-derived by the surface). */
export interface NavTreeRoom {
  /** The room's slug id. */
  roomId: string;
  /** The room subject (the visible label). */
  subject: string;
  /** Whether the room has unread activity (→ `•` accent; else `°` faint). */
  unread: boolean;
  /** The unread activity count (renders a badge when > 0). */
  activityCount: number;
  /** Whether the operator was escalated into this room (→ `!` flag-warm glyph). */
  needsYou: boolean;
}

/** One project (sub-board) section in the tree model. */
export interface NavTreeProject {
  /** The project's slug id. */
  projectId: string;
  /** The project title (the section label). */
  title: string;
  /** The count of announcements (proto-rooms) — shown on the announcements bucket. */
  announcementCount: number;
  /** The project's rooms (activated rooms the surface chooses to list). */
  rooms: NavTreeRoom[];
}

/** One escalated room in the NEEDS YOU section (the deterministic add-participant set). */
export interface NavTreeNeedsYou {
  /** The escalated room's slug id. */
  roomId: string;
  /** The escalated room's sub-board id. */
  projectId: string;
  /** The escalated room's subject. */
  subject: string;
}

/** The full prop-driven tree model NavTree renders (surface-agnostic). */
export interface NavTreeModel {
  /** The operator handle (`@handle (you)`), or `null` for the watching-only posture. */
  operatorHandle: string | null;
  /** The currently-selected room id (gets the 2px accent rail), or `null`. */
  activeRoomId: string | null;
  /** The NEEDS YOU escalation set (host-derived; explicit add_participant only). */
  needsYou: NavTreeNeedsYou[];
  /** Every project/room the host returns — global read (FR28). */
  projects: NavTreeProject[];
}

export interface NavTreeProps {
  /** The tree model to render. */
  model: NavTreeModel;
  /** Called with a room id when a room row is selected. */
  onSelectRoom?: (roomId: string) => void;
  /** Called when the announcements bucket of a project is opened. */
  onOpenAnnouncements?: (projectId: string) => void;
  /**
   * Called when the `＋ join a project…` row is clicked. The actual JOIN flow is Story 9.7;
   * for 9.4 this row exists + is clickable and the handler is a documented hand-off stub.
   */
  onJoinProject?: () => void;
}

/** Render the operator's global-read board navigation tree. */
export function NavTree({
  model,
  onSelectRoom,
  onOpenAnnouncements,
  onJoinProject,
}: NavTreeProps) {
  const { operatorHandle, activeRoomId, needsYou, projects } = model;

  const sidebarStyle: CSSProperties = {
    width: 'var(--sidebar-w)',
    background: 'var(--surface-panel)',
    color: 'var(--text)',
    borderRight: '1px solid var(--border)',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  };

  const headerStyle: CSSProperties = {
    fontFamily: 'var(--section-label-font)',
    fontSize: 'var(--ui-label-size)',
    fontWeight: 600,
    color: 'var(--text-strong)',
    padding: 'var(--space-3)',
  };

  const listReset: CSSProperties = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  };

  return (
    <nav
      className="nav-tree"
      style={sidebarStyle}
      aria-label="Board navigation"
    >
      <div className="nav-header" data-testid="nav-header" style={headerStyle}>
        AgentBBS
      </div>

      {/* The operator identity row — only when a handle is resolved (else watching-only). */}
      {operatorHandle !== null && (
        <div
          className="nav-operator"
          data-testid="nav-operator"
          style={{
            fontFamily: 'var(--handle-font)',
            fontSize: 'var(--handle-size)',
            color: 'var(--accent-on-dark)',
            padding: '0 var(--space-3) var(--space-2)',
          }}
        >
          @{operatorHandle}{' '}
          <span style={{ color: 'var(--text-faint)' }}>(you)</span>
        </div>
      )}

      {/* The pinned NEEDS YOU section — ONLY when n>0 (a quiet board shows nothing). */}
      {needsYou.length > 0 && (
        <section
          className="nav-needs-you-section"
          data-testid="needs-you-section"
        >
          <SectionLabel testId="needs-you-label" color="var(--flag-warm-text)">
            Needs you ({needsYou.length})
          </SectionLabel>
          <ul role="tree" style={listReset}>
            {needsYou.map((room) => (
              <NeedsYouItem
                key={room.roomId}
                roomId={room.roomId}
                subject={room.subject}
                onClick={
                  onSelectRoom ? () => onSelectRoom(room.roomId) : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}

      {/* One collapsible section per project — global read (every project, FR28). */}
      <ul role="tree" style={listReset}>
        {projects.map((project) => (
          <li
            key={project.projectId}
            className="nav-project"
            data-project-id={project.projectId}
            role="treeitem"
            aria-expanded="true"
          >
            <SectionLabel>{project.title}</SectionLabel>
            <ul role="group" style={listReset}>
              {/* The announcements bucket (`* announcements`). */}
              <SidebarTreeItem
                label={`announcements (${project.announcementCount})`}
                leadingGlyph="*"
                depth={1}
                dataAttrs={{ 'data-testid': 'announcements-bucket' }}
                onClick={
                  onOpenAnnouncements
                    ? () => onOpenAnnouncements(project.projectId)
                    : undefined
                }
              />
              {/* The room rows. */}
              {project.rooms.map((room) => (
                <SidebarTreeItem
                  key={room.roomId}
                  label={`#${room.roomId}`}
                  readState={room.unread ? 'unread' : 'read'}
                  needsYou={room.needsYou}
                  activityCount={room.activityCount}
                  selected={room.roomId === activeRoomId}
                  depth={1}
                  dataAttrs={{ 'data-room-id': room.roomId }}
                  onClick={
                    onSelectRoom ? () => onSelectRoom(room.roomId) : undefined
                  }
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {/* The join-a-project action — clickable; the JOIN flow itself is Story 9.7 (stub). */}
      <button
        type="button"
        className="nav-join-project"
        data-testid="nav-join-project"
        onClick={onJoinProject}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          fontFamily: 'var(--ui-label-font)',
          fontSize: 'var(--ui-label-size)',
          padding: 'var(--space-3)',
          cursor: 'pointer',
        }}
      >
        ＋ join a project…
      </button>
    </nav>
  );
}
