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
// a11y (Story 9.10 — THE FLOOR): a single nav `role="tree"` with `role="treeitem"` rows,
// `role="group"` child lists, `aria-expanded` on each collapsible project, ROVING TABINDEX
// (exactly one row holds tabindex=0; the rest tabindex=-1), and APG arrow-key traversal
// (ArrowUp/Down move between visible rows, ArrowRight expands-then-descends, ArrowLeft
// collapses-then-ascends, Home/End jump, Enter/Space activate). The project twisty's
// `aria-expanded` reflects the live collapsed state. Verified against the WAI-ARIA APG tree
// pattern (Story 9.10 Research-First). React 19 automatic JSX runtime.

import { useRef, useState } from 'react';

import { SectionLabel } from './SectionLabel.js';
import { SidebarTreeItem } from './SidebarTreeItem.js';
import { NeedsYouItem } from './NeedsYouItem.js';

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

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

/** A flattened, currently-VISIBLE tree row — the roving-tabindex + arrow-nav order (APG). */
interface FlatRow {
  /** A stable id for the roving-focus DOM lookup (`data-tree-id`). */
  treeId: string;
  /** Whether this is a collapsible PROJECT header (vs a leaf bucket/room row). */
  isProject: boolean;
  /** For a project row: its project id (so ArrowRight/Left can toggle its collapse). */
  projectId?: string;
}

/** Render the operator's global-read board navigation tree. */
export function NavTree({
  model,
  onSelectRoom,
  onOpenAnnouncements,
  onJoinProject,
}: NavTreeProps) {
  const { operatorHandle, activeRoomId, needsYou, projects } = model;

  // Story 9.10 — interactive project COLLAPSE (the twisty) + the ROVING-TABINDEX active row.
  // A project id is in `collapsed` when the operator has collapsed its group (aria-expanded
  // reflects this live). `activeId` is the one row that holds tabindex=0 (the rest are -1).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);

  const isCollapsed = (projectId: string): boolean => collapsed.has(projectId);

  function toggleCollapse(projectId: string, next: boolean): void {
    setCollapsed((prev) => {
      const updated = new Set(prev);
      if (next) updated.delete(projectId);
      else updated.add(projectId);
      return updated;
    });
  }

  // Build the flat, VISIBLE row order (project header, then its bucket + rooms when expanded).
  // This is the ArrowUp/Down traversal order + the roving-tabindex universe (APG tree pattern).
  const flatRows: FlatRow[] = [];
  for (const project of projects) {
    const projectRowId = `project:${project.projectId}`;
    flatRows.push({
      treeId: projectRowId,
      isProject: true,
      projectId: project.projectId,
    });
    if (!isCollapsed(project.projectId)) {
      flatRows.push({
        treeId: `bucket:${project.projectId}`,
        isProject: false,
      });
      for (const room of project.rooms) {
        flatRows.push({ treeId: `room:${room.roomId}`, isProject: false });
      }
    }
  }

  // The active (tabindex=0) row defaults to the first visible row when nothing is active yet.
  const effectiveActiveId =
    activeId !== null && flatRows.some((r) => r.treeId === activeId)
      ? activeId
      : (flatRows[0]?.treeId ?? null);

  /** Move roving focus to a row by its tree id (sets active + focuses the DOM node). */
  function focusRow(treeId: string): void {
    setActiveId(treeId);
    const node = treeRef.current?.querySelector<HTMLElement>(
      `[data-tree-id="${CSS.escape(treeId)}"]`,
    );
    node?.focus();
  }

  /** Move roving focus by an offset within the visible row order (ArrowUp/Down/Home/End). */
  function focusByOffset(
    fromId: string,
    delta: number | 'first' | 'last',
  ): void {
    if (flatRows.length === 0) return;
    if (delta === 'first') {
      focusRow(flatRows[0]!.treeId);
      return;
    }
    if (delta === 'last') {
      focusRow(flatRows[flatRows.length - 1]!.treeId);
      return;
    }
    const index = flatRows.findIndex((r) => r.treeId === fromId);
    const next = Math.min(Math.max(index + delta, 0), flatRows.length - 1);
    focusRow(flatRows[next]!.treeId);
  }

  /** The shared APG arrow-key handler for a tree row (roving tabindex + expand/collapse). */
  function handleRowKeyDown(
    event: ReactKeyboardEvent,
    row: FlatRow,
    activate: () => void,
  ): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusByOffset(row.treeId, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusByOffset(row.treeId, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusByOffset(row.treeId, 'first');
        break;
      case 'End':
        event.preventDefault();
        focusByOffset(row.treeId, 'last');
        break;
      case 'ArrowRight':
        // On a collapsed project → expand; on an expanded project → descend to its first child.
        if (row.isProject && row.projectId !== undefined) {
          event.preventDefault();
          if (isCollapsed(row.projectId)) {
            toggleCollapse(row.projectId, true);
          } else {
            focusByOffset(row.treeId, 1);
          }
        }
        break;
      case 'ArrowLeft':
        // On an expanded project → collapse; on a child row → ascend to its project header.
        if (row.isProject && row.projectId !== undefined) {
          if (!isCollapsed(row.projectId)) {
            event.preventDefault();
            toggleCollapse(row.projectId, false);
          }
        } else {
          event.preventDefault();
          // Ascend to the nearest preceding project header.
          const index = flatRows.findIndex((r) => r.treeId === row.treeId);
          for (let i = index - 1; i >= 0; i--) {
            if (flatRows[i]!.isProject) {
              focusRow(flatRows[i]!.treeId);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate();
        break;
      default:
        break;
    }
  }

  // The tree fills its column (the apps/web sidebar column owns the fixed --sidebar-w width +
  // the right border + the connection footer below it; Story 9.10). When mounted standalone
  // (component tests / a surface that does not wrap it) it still renders at the sidebar width.
  const sidebarStyle: CSSProperties = {
    width: '100%',
    minWidth: 'var(--sidebar-w)',
    flex: 1,
    minHeight: 0,
    background: 'var(--surface-panel)',
    color: 'var(--text)',
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

      {/* The pinned NEEDS YOU section — ONLY when n>0 (a quiet board shows nothing). A flat
          escalation list (role="list"), distinct from the project nav tree below. */}
      {needsYou.length > 0 && (
        <section
          className="nav-needs-you-section"
          data-testid="needs-you-section"
          aria-label={`needs you (${needsYou.length})`}
        >
          <SectionLabel testId="needs-you-label" color="var(--flag-warm-text)">
            needs you ({needsYou.length})
          </SectionLabel>
          <ul role="list" style={listReset}>
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

      {/* CALM EMPTY BOARD (AC1): no projects → a quiet `no projects yet` line + ONE next
          action (the join row below). No spinner-over-everything, no splashy onboarding. */}
      {projects.length === 0 && (
        <p
          className="nav-empty"
          data-testid="nav-empty"
          style={{
            color: 'var(--text-dim)',
            fontFamily: 'var(--ui-label-font)',
            fontSize: 'var(--ui-label-size)',
            padding: 'var(--space-3)',
            margin: 0,
          }}
        >
          no projects yet
        </p>
      )}

      {/* The board nav TREE — one collapsible treeitem per project (global read, FR28). A
          SINGLE role="tree" with roving tabindex + APG arrow-key traversal (Story 9.10). */}
      {projects.length > 0 && (
        <ul role="tree" aria-label="projects" style={listReset} ref={treeRef}>
          {projects.map((project) => {
            const expanded = !isCollapsed(project.projectId);
            const projectRowId = `project:${project.projectId}`;
            const projectRow: FlatRow = {
              treeId: projectRowId,
              isProject: true,
              projectId: project.projectId,
            };
            const bucketRow: FlatRow = {
              treeId: `bucket:${project.projectId}`,
              isProject: false,
            };
            return (
              <li
                key={project.projectId}
                className="nav-project"
                data-project-id={project.projectId}
                role="treeitem"
                aria-expanded={expanded}
                aria-label={project.title}
                tabIndex={effectiveActiveId === projectRowId ? 0 : -1}
                data-tree-id={projectRowId}
                onKeyDown={(event) => {
                  // The project <li> WRAPS its room group; a child row's key/click event bubbles
                  // up to here. Only act when the event originated on THIS project header (its
                  // nearest [data-tree-id] is this project), never on a nested room/bucket row.
                  if (
                    (event.target as HTMLElement).closest('[data-tree-id]') !==
                    event.currentTarget
                  ) {
                    return;
                  }
                  handleRowKeyDown(event, projectRow, () =>
                    toggleCollapse(project.projectId, !expanded),
                  );
                }}
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest('[data-tree-id]') !==
                    event.currentTarget
                  ) {
                    return;
                  }
                  setActiveId(projectRowId);
                  toggleCollapse(project.projectId, !expanded);
                }}
              >
                <SectionLabel>
                  <span aria-hidden="true">{expanded ? '▾ ' : '▸ '}</span>
                  {project.title}
                </SectionLabel>
                {expanded && (
                  <ul role="group" style={listReset}>
                    {/* The announcements bucket (`* announcements`). */}
                    <SidebarTreeItem
                      label={`announcements (${project.announcementCount})`}
                      leadingGlyph="*"
                      depth={1}
                      dataAttrs={{ 'data-testid': 'announcements-bucket' }}
                      treeId={bucketRow.treeId}
                      tabIndex={effectiveActiveId === bucketRow.treeId ? 0 : -1}
                      ariaLabel={`announcements (${project.announcementCount})`}
                      onKeyDown={(event) =>
                        handleRowKeyDown(event, bucketRow, () =>
                          onOpenAnnouncements?.(project.projectId),
                        )
                      }
                      onClick={() => {
                        setActiveId(bucketRow.treeId);
                        onOpenAnnouncements?.(project.projectId);
                      }}
                    />
                    {/* The room rows. */}
                    {project.rooms.map((room) => {
                      const roomRowId = `room:${room.roomId}`;
                      const roomRow: FlatRow = {
                        treeId: roomRowId,
                        isProject: false,
                      };
                      // The SR label announces the room id + its read/escalation state.
                      const stateWords = [
                        room.unread ? 'unread' : 'read',
                        room.needsYou ? 'needs you' : '',
                      ]
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <SidebarTreeItem
                          key={room.roomId}
                          label={`#${room.roomId}`}
                          readState={room.unread ? 'unread' : 'read'}
                          needsYou={room.needsYou}
                          activityCount={room.activityCount}
                          selected={room.roomId === activeRoomId}
                          depth={1}
                          dataAttrs={{ 'data-room-id': room.roomId }}
                          treeId={roomRowId}
                          tabIndex={effectiveActiveId === roomRowId ? 0 : -1}
                          ariaLabel={`#${room.roomId}, ${stateWords}`}
                          onKeyDown={(event) =>
                            handleRowKeyDown(event, roomRow, () =>
                              onSelectRoom?.(room.roomId),
                            )
                          }
                          onClick={() => {
                            setActiveId(roomRowId);
                            onSelectRoom?.(room.roomId);
                          }}
                        />
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The join-a-project action — the SINGLE next action on an empty board (AC1), always
          present. Clickable; the JOIN flow itself is Story 9.7 (stub). */}
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
