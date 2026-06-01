// PostAnnouncementCompose — the calm "open a room" announcement-post affordance (Story 9.11 /
// AC #2; operator INITIATE-surface parity with the agent `post_announcement`).
//
// A small prop-driven compose form: a subject field + a body textarea + a `[ post announcement ]`
// submit and a `cancel` link. Terse lowercase voice (Story 9.10 calm chrome); NO modal — the inline
// `error` slot renders the calm `BODY_TOO_LARGE` (or any host) message UNDER the form with the draft
// intact. An empty/whitespace subject OR body does NOT submit (no empty announcements). `pending`
// disables the controls during the in-flight write.
//
// JOIN-FIRST HANDOFF (AC #2): when the operator is NOT a member of the target project, core rejects
// the post with NOT_A_MEMBER — the surface passes that through as the `joinFirst` prop, which swaps
// the form for a calm `[ join this project first ]` CTA firing `onJoinFirst` (NEVER a silent
// failure). This composes with Story 9.12's join path; for 9.11 the CTA is the handoff seam.
//
// PROP-DRIVEN (NFR2): `onSubmit({ subject, body })` / `onCancel` / `onJoinFirst` are the surface's
// callbacks; the surface owns the postAnnouncement write + the error/join-first wiring + the live
// tree/thread refresh on success. Imports ONLY React. React 19 automatic JSX runtime.

import { useState } from 'react';

import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';

export interface PostAnnouncementComposeProps {
  /**
   * Fired with the trimmed `{ subject, body }` when the operator submits a non-empty form (the
   * surface runs `postAnnouncement` then refreshes the tree/thread). NOT fired when either field
   * is empty/whitespace-only.
   */
  onSubmit?: (input: { subject: string; body: string }) => void;
  /** Fired when the operator clicks `cancel` (the surface dismisses the compose affordance). */
  onCancel?: () => void;
  /**
   * Whether the operator must JOIN the project before posting (AC #2 — core would reject with
   * NOT_A_MEMBER). When `true` the form is replaced by a calm `[ join this project first ]` CTA
   * (firing `onJoinFirst`), NEVER a silent failure. Default `false`.
   */
  joinFirst?: boolean;
  /** Fired when the operator clicks the `[ join this project first ]` CTA (the join handoff). */
  onJoinFirst?: () => void;
  /**
   * A calm inline error message to render UNDER the form (e.g. `BODY_TOO_LARGE` — "that body is too
   * large"), or `null`/omitted for no error. NEVER a modal; the draft stays.
   */
  error?: string | null;
  /**
   * Whether the post write is in flight — disables the controls so the operator does not
   * double-submit (a basic disabled state). Default `false`.
   */
  pending?: boolean;
  /**
   * Story 9.10 a11y — fired when the operator presses Esc in a field so the surface can dismiss the
   * affordance / return focus to the tree. Optional; the surface owns where focus goes.
   */
  onEscape?: () => void;
}

const containerStyle: CSSProperties = {
  background: 'var(--surface-panel)',
  borderTop: '1px solid var(--border)',
  padding: 'var(--space-4) var(--space-7)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-dim)',
};

const fieldStyle: CSSProperties = {
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

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const errorStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-warn, var(--text-dim))',
};

/**
 * Render the calm post-announcement compose form (or, when `joinFirst`, the calm join-first CTA).
 * Subject + body fields, a submit + a cancel; an empty/whitespace field blocks submit; the inline
 * `error` slot (no modal) renders any host error under the form with the draft preserved.
 * Prop-driven; the surface owns the write + the tree/thread refresh.
 */
export function PostAnnouncementCompose({
  onSubmit,
  onCancel,
  joinFirst = false,
  onJoinFirst,
  error = null,
  pending = false,
  onEscape,
}: PostAnnouncementComposeProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  const canSubmit =
    trimmedSubject.length > 0 && trimmedBody.length > 0 && !pending;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({ subject: trimmedSubject, body: trimmedBody });
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
    }
  }

  // AC #2 — JOIN-FIRST HANDOFF: a non-member operator cannot post; show the calm CTA, not the form.
  if (joinFirst) {
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
        className="post-announcement-compose"
        data-testid="post-announcement-compose"
        data-join-first="true"
        style={containerStyle}
      >
        <span style={labelStyle}>you're not a member of this project yet</span>
        <button
          type="button"
          className="post-announcement-join-first"
          data-testid="post-announcement-join-first"
          disabled={pending}
          aria-disabled={pending}
          onClick={onJoinFirst}
          style={joinButtonStyle}
        >
          [ join this project first ]
        </button>
      </div>
    );
  }

  const submitButtonStyle: CSSProperties = {
    fontFamily: 'var(--ui-label-font)',
    fontSize: 'var(--ui-label-size)',
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-default)',
    border: 'none',
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    cursor: canSubmit ? 'pointer' : 'not-allowed',
    opacity: canSubmit ? 1 : 0.6,
  };

  const cancelButtonStyle: CSSProperties = {
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
    <form
      className="post-announcement-compose"
      data-testid="post-announcement-compose"
      data-join-first="false"
      style={containerStyle}
      onSubmit={handleSubmit}
      aria-label="open a room"
    >
      <span style={labelStyle}>open a room</span>
      <input
        type="text"
        className="post-announcement-subject"
        data-testid="post-announcement-subject"
        placeholder="subject…"
        aria-label="announcement subject"
        value={subject}
        disabled={pending}
        onChange={(e) => setSubject(e.target.value)}
        onKeyDown={handleKeyDown}
        style={fieldStyle}
      />
      <textarea
        className="post-announcement-body"
        data-testid="post-announcement-body"
        placeholder="what do you need…"
        aria-label="announcement body"
        value={body}
        disabled={pending}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        style={fieldStyle}
      />
      {error !== null && error !== undefined && (
        <span
          className="post-announcement-error"
          data-testid="post-announcement-error"
          role="status"
          style={errorStyle}
        >
          {error}
        </span>
      )}
      <div style={rowStyle}>
        <button
          type="submit"
          className="post-announcement-submit"
          data-testid="post-announcement-submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          style={submitButtonStyle}
        >
          [ post announcement ]
        </button>
        <button
          type="button"
          className="post-announcement-cancel"
          data-testid="post-announcement-cancel"
          disabled={pending}
          aria-disabled={pending}
          onClick={onCancel}
          style={cancelButtonStyle}
        >
          cancel
        </button>
      </div>
    </form>
  );
}
