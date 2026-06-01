// RoomView — the room main-column layout (Story 9.5 / AC #1, #2).
//
// The "room is a document" main column, top-to-bottom (EXPERIENCE.md):
//   1. BREADCRUMB — `sub-board › #room` (DESIGN components.breadcrumb-joined-row): the
//      sub-board crumb dim, a `›` separator, the room id in mono.
//   2. JOINED-PARTICIPANTS ROW — the room's participants as accent-tinted `@handle`s,
//      ending in the OPERATOR POSTURE (AC2, the Mode A→B signal): `you: watching` when the
//      operator is NOT a participant of this room, `you: @operator (peer)` when they ARE.
//      Over a quiet `--border-soft` rule.
//   3. MESSAGE THREAD — the seq-ordered `MessageThread` (the scrolling document body).
//   4. COMPOSER SEAM — a placeholder/hand-off region for Story 9.7 (the join-gate composer
//      + the interactive `watching → peer` FLIP). 9.5 renders the POSTURE from data only;
//      the interactive composer behavior is explicitly NOT built here.
//
// AC2 nuance: the posture is computed by the SURFACE from `/api/me` + the room participant
// list and passed in as `operatorPosture` — RoomView is prop-driven and renders the state;
// it does not compute identity or fetch. The interactive flip on join is Story 9.7.
//
// PRESENTATION-ONLY (NFR2): no core/data-access import; prop-driven. React 19 automatic
// JSX runtime.

import { MessageThread } from './MessageThread.js';

import type { MessagePostModel } from './MessagePost.js';
import type { CSSProperties, ReactNode } from 'react';

/** The operator's posture toward THIS room — the Mode A→B signal (AC2). */
export type OperatorPosture =
  | { kind: 'watching' }
  | { kind: 'peer'; handle: string };

/** The prop-driven room model RoomView renders (surface-agnostic). */
export interface RoomViewModel {
  /** The room's slug id (rendered in the breadcrumb, mono). */
  roomId: string;
  /** The sub-board (project) id — the breadcrumb's leading crumb. */
  projectId: string;
  /** The room subject (room-level metadata; available for chrome — not a per-post field). */
  subject: string;
  /** The room's participant handles (posted-in ∪ pulled-in), in seq order. */
  participants: string[];
  /** The room's seq-ordered messages (announcement #1 then replies). */
  messages: MessagePostModel[];
  /** The operator's posture toward this room (watching vs peer) — the AC2 signal. */
  operatorPosture: OperatorPosture;
  /**
   * The `seq` of the room's CURRENT CONTRACT — the converged message carrying the
   * `✓ agreed` mark (the highest-`seq` live-👍'd message, from `/api/rooms/:id/contract`).
   * `null` → no converged message. COMPUTED, never stored (FR21) — the surface re-derives
   * + re-passes it on every 👍 change so the mark MOVES/DISAPPEARS. Defaults to `null`.
   */
  agreedSeq?: number | null;
  /**
   * The resolved operator handle (`/api/me`), or `null` — used to compute each post's
   * operator-👍'd chip state (operator ∈ post.reactions). Defaults to `null`.
   */
  operatorHandle?: string | null;
}

export interface RoomViewProps {
  /** The room model to render. */
  room: RoomViewModel;
  /**
   * The composer seam content (Story 9.7 fills this with the join-gate composer). When
   * omitted, RoomView renders a neutral placeholder so the layout's bottom row exists.
   */
  composerSlot?: ReactNode;
  /**
   * Fired when the operator toggles a post's 👍 (carries the post `seq`). The surface fires
   * the react/unreact write then refetches the room + contract (Story 9.9 adds optimism).
   */
  onToggleReaction?: (seq: number) => void;
  /** High-contrast mode (passes through to the thread/posts). Default `false` (web V1). */
  highContrast?: boolean;
}

/** Render the room main-column layout. */
export function RoomView({
  room,
  composerSlot,
  onToggleReaction,
  highContrast = false,
}: RoomViewProps) {
  const columnStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--surface-base)',
    color: 'var(--text-body)',
  };

  const breadcrumbStyle: CSSProperties = {
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    color: 'var(--text-dim)',
    padding: 'var(--space-4) var(--space-7) var(--space-2)',
  };

  const roomIdStyle: CSSProperties = {
    fontFamily: 'var(--identifier-font)',
    fontSize: 'var(--identifier-size)',
    color: 'var(--text)',
  };

  const joinedRowStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 'var(--space-3)',
    padding: '0 var(--space-7) var(--space-3)',
    borderBottom: '1px solid var(--border-soft)',
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    color: 'var(--text-dim)',
  };

  const participantHandleStyle: CSSProperties = {
    fontFamily: 'var(--handle-font)',
    fontSize: 'var(--handle-size)',
    color: 'var(--accent-on-dark)',
  };

  const posture = room.operatorPosture;
  // The posture string + tint: watching is muted; peer is accent (the A→B transition).
  const postureText =
    posture.kind === 'peer'
      ? `you: @${posture.handle} (peer)`
      : 'you: watching';
  const postureStyle: CSSProperties = {
    marginLeft: 'auto',
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    color:
      posture.kind === 'peer' ? 'var(--accent-on-dark)' : 'var(--text-muted)',
  };

  const threadWrapStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  };

  const composerStyle: CSSProperties = {
    borderTop: '1px solid var(--border-soft)',
    padding: 'var(--space-4) var(--space-7)',
    color: 'var(--text-muted)',
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
  };

  return (
    <section className="room-view" data-testid="room-view" style={columnStyle}>
      {/* 1. Breadcrumb: sub-board › #room */}
      <div
        className="breadcrumb"
        data-testid="room-breadcrumb"
        style={breadcrumbStyle}
      >
        <span className="breadcrumb-board" data-testid="breadcrumb-board">
          {room.projectId}
        </span>
        <span className="breadcrumb-sep" aria-hidden="true">
          {' '}
          ›{' '}
        </span>
        <span className="breadcrumb-room" style={roomIdStyle}>
          #{room.roomId}
        </span>
      </div>

      {/* 2. Joined-participants row + operator posture (AC2). */}
      <div
        className="joined-row"
        data-testid="joined-row"
        style={joinedRowStyle}
      >
        <span className="joined-label">joined:</span>
        {room.participants.map((handle) => (
          <span
            key={handle}
            className="joined-participant"
            data-testid="joined-participant"
            style={participantHandleStyle}
          >
            @{handle}
          </span>
        ))}
        <span
          className="operator-posture"
          data-testid="operator-posture"
          data-posture={posture.kind}
          style={postureStyle}
        >
          {postureText}
        </span>
      </div>

      {/* 3. The scrolling, seq-ordered message thread (the document body). The converged
          message gets the ✓ agreed mark (room.agreedSeq); each post's 👍 chip reflects the
          live count + the operator's own state. The TOGGLE works only for a peer operator
          (canReact); a watching operator sees the disabled "join to react" hand-off (9.7). */}
      <div style={threadWrapStyle}>
        <MessageThread
          messages={room.messages}
          agreedSeq={room.agreedSeq ?? null}
          operatorHandle={room.operatorHandle ?? null}
          canReact={posture.kind === 'peer'}
          onToggleReaction={onToggleReaction}
          highContrast={highContrast}
        />
      </div>

      {/* 4. Composer seam — Story 9.7 fills this; 9.5 renders the placeholder/hand-off. */}
      <div
        className="composer-seam"
        data-testid="composer-seam"
        style={composerStyle}
      >
        {composerSlot ?? (
          <span data-testid="composer-placeholder">
            {posture.kind === 'peer'
              ? 'composer lands in Story 9.7'
              : '[ join room to post ] — Story 9.7'}
          </span>
        )}
      </div>
    </section>
  );
}
