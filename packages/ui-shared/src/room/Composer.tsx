// Composer — the join-gate composer (Story 9.7 / AC #1, FR31; DESIGN components.join-gate-composer).
//
// The bottom of the room main column (the Story 9.5 RoomView composer seam). TWO STATES ONLY
// (DESIGN.md / EXPERIENCE.md — "the one gate between reading and posting"):
//   - NOT JOINED (`joined={false}`): a SINGLE `[ join room to post ]` button (reading needed no
//     join). Clicking it fires `onJoin`. Surface-panel bg, a `--border` top rule.
//   - JOINED (`joined={true}`): `✓ you joined` (`--agreed-green`) + a mono `--surface-input` text
//     field (`--radius-default`) + an `--accent` send button. Typing + send fires `onSend(body)`;
//     an empty/whitespace body does NOT send (no empty posts).
//
// PROP-DRIVEN (NFR2): `joined` is whether the operator may post here (the surface computes it from
// the operator's ROOM-PARTICIPATION state — see the Story 9.7 Design reconciliation: the board has
// no standalone "join room" op; the operator becomes a room participant by ACTING/replying, so the
// composer's `joined` reflects participation, and the click→join handoff is `joinBoard` for
// immediate sub-board membership). `onJoin`/`onSend` are the surface's write callbacks; `pending`
// disables the controls during an in-flight write (a basic disabled state — optimistic echo +
// failure-retry is Story 9.9). No @agentbbs/core / @agentbbs/data-access import. React 19
// automatic JSX runtime.

import { useState } from 'react';

import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';

export interface ComposerProps {
  /**
   * Whether the operator may POST in this room (a room participant). `false` → the not-joined
   * `[ join room to post ]` gate; `true` → the joined `✓ you joined` + field + send. The surface
   * computes this from the operator's room-participation state (Story 9.7 reconciliation).
   */
  joined: boolean;
  /**
   * Fired when the operator clicks `[ join room to post ]` (the not-joined state). The surface
   * runs the join write (`joinBoard` for sub-board membership) then refetches; participation is
   * fully established once the operator SENDS (grant-on-act). Not fired in the joined state.
   */
  onJoin?: () => void;
  /**
   * Fired with the trimmed body when the operator sends a message (the joined state). The surface
   * runs the `reply` write then refetches. NOT fired for an empty/whitespace-only body.
   */
  onSend?: (body: string) => void;
  /**
   * Whether a write (join or send) is in flight — disables the controls so the operator does not
   * double-submit (a basic disabled state; the rich optimistic echo + retry is Story 9.9). Default
   * `false`.
   */
  pending?: boolean;
  /**
   * Story 9.10 a11y — fired when the operator presses Esc in the composer field so the surface
   * can RETURN FOCUS to the thread/tree (EXPERIENCE.md keyboard floor: "Esc returns focus to the
   * thread/tree"). Optional; the surface owns where focus goes.
   */
  onEscape?: () => void;
}

/**
 * Render the two-state join-gate composer. Not-joined → a single `[ join room to post ]` button;
 * joined → `✓ you joined` + a mono text field + an accent send button. Prop-driven; the surface
 * owns the join/send writes + the refetch.
 */
export function Composer({
  joined,
  onJoin,
  onSend,
  pending = false,
  onEscape,
}: ComposerProps) {
  const [draft, setDraft] = useState('');

  const containerStyle: CSSProperties = {
    background: 'var(--surface-panel)',
    borderTop: '1px solid var(--border)',
    padding: 'var(--space-4) var(--space-7)',
  };

  // --- NOT JOINED: the single gate button. ---
  if (!joined) {
    const joinButtonStyle: CSSProperties = {
      fontFamily: 'var(--ui-label-font)',
      fontSize: 'var(--ui-label-size)',
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-default)',
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'var(--border)',
      background: 'var(--surface-input)',
      color: 'var(--text)',
      cursor: pending ? 'not-allowed' : 'pointer',
      opacity: pending ? 0.6 : 1,
    };
    return (
      <div
        className="composer"
        data-testid="composer"
        data-joined="false"
        style={containerStyle}
      >
        <button
          type="button"
          className="composer-join"
          data-testid="composer-join"
          disabled={pending}
          aria-disabled={pending}
          onClick={onJoin}
          style={joinButtonStyle}
        >
          [ join room to post ]
        </button>
      </div>
    );
  }

  // --- JOINED: ✓ you joined + a mono text field + an accent send button. ---
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !pending;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSend) return;
    onSend?.(trimmed);
    setDraft('');
  }

  // Esc returns focus to the thread/tree (EXPERIENCE.md keyboard floor) — the surface decides
  // where. Enter-to-send is the form submit (the field is in a <form>), so plain Enter sends.
  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
    }
  }

  const joinedOkStyle: CSSProperties = {
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    color: 'var(--agreed-green)',
    whiteSpace: 'nowrap',
  };

  const fieldStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontFamily: 'var(--message-body-font)',
    fontSize: 'var(--message-body-size)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-default)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    background: 'var(--surface-input)',
    color: 'var(--text-body)',
  };

  const sendButtonStyle: CSSProperties = {
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-default)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    cursor: canSend ? 'pointer' : 'not-allowed',
    opacity: canSend ? 1 : 0.6,
  };

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  };

  return (
    <form
      className="composer"
      data-testid="composer"
      data-joined="true"
      style={containerStyle}
      onSubmit={handleSubmit}
      aria-label="post a message"
    >
      <div style={rowStyle}>
        <span
          className="composer-joined-ok"
          data-testid="composer-joined-ok"
          style={joinedOkStyle}
        >
          ✓ you joined
        </span>
        <input
          type="text"
          className="composer-field"
          data-testid="composer-field"
          placeholder="type to post…"
          aria-label="message"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleFieldKeyDown}
          style={fieldStyle}
        />
        <button
          type="submit"
          className="composer-send"
          data-testid="composer-send"
          disabled={!canSend}
          aria-disabled={!canSend}
          style={sendButtonStyle}
        >
          send
        </button>
      </div>
    </form>
  );
}
