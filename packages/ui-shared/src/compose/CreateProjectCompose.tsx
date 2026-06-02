// CreateProjectCompose — the calm "start a negotiation" project-create affordance (Story 9.11 /
// AC #1; operator INITIATE-surface parity with the agent `announce_project`).
//
// A small prop-driven compose form: a title field + a description field + a `[ create project ]`
// submit and a `cancel` link. Terse lowercase voice (Story 9.10 calm chrome); NO modal — the
// inline `error` slot renders the calm `PROJECT_EXISTS` (or any host) message UNDER the form, the
// form stays open with the draft intact so the operator can rename + retry. An empty/whitespace
// title OR description does NOT submit (no empty projects). `pending` disables the controls during
// the in-flight write (a basic disabled state, mirroring Composer).
//
// PROP-DRIVEN (NFR2): `onSubmit({ title, description })` / `onCancel` are the surface's write
// callbacks; the surface owns the announceProject write + the error→`error` prop wiring + the live
// tree refresh on success. Imports ONLY React (no @agentbbs/core / @agentbbs/data-access). React 19
// automatic JSX runtime.

import { useState } from 'react';

import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';

export interface CreateProjectComposeProps {
  /**
   * Fired with the trimmed `{ title, description }` when the operator submits a non-empty form
   * (the surface runs `announceProject` then refreshes the tree). NOT fired when either field is
   * empty/whitespace-only.
   */
  onSubmit?: (input: { title: string; description: string }) => void;
  /** Fired when the operator clicks `cancel` (the surface dismisses the compose affordance). */
  onCancel?: () => void;
  /**
   * A calm inline error message to render UNDER the form (e.g. `PROJECT_EXISTS` — "a project with
   * that title already exists"), or `null`/omitted for no error. NEVER a modal; the draft stays.
   */
  error?: string | null;
  /**
   * Whether the announce write is in flight — disables the controls so the operator does not
   * double-submit (a basic disabled state). Default `false`.
   */
  pending?: boolean;
  /**
   * Story 9.10 a11y — fired when the operator presses Esc in a field so the surface can dismiss
   * the affordance / return focus to the tree. Optional; the surface owns where focus goes.
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
 * Render the calm create-project compose form. Title + description fields, a submit + a cancel; an
 * empty/whitespace field blocks submit; the inline `error` slot (no modal) renders any host error
 * under the form with the draft preserved. Prop-driven; the surface owns the write + tree refresh.
 */
export function CreateProjectCompose({
  onSubmit,
  onCancel,
  error = null,
  pending = false,
  onEscape,
}: CreateProjectComposeProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const canSubmit =
    trimmedTitle.length > 0 && trimmedDescription.length > 0 && !pending;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({ title: trimmedTitle, description: trimmedDescription });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
    }
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
      className="create-project-compose"
      data-testid="create-project-compose"
      style={containerStyle}
      onSubmit={handleSubmit}
      aria-label="start a project"
    >
      <span style={labelStyle}>start a project</span>
      <input
        type="text"
        className="create-project-title"
        data-testid="create-project-title"
        placeholder="title…"
        aria-label="project title"
        value={title}
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        style={fieldStyle}
      />
      <input
        type="text"
        className="create-project-description"
        data-testid="create-project-description"
        placeholder="what's this about…"
        aria-label="project description"
        value={description}
        disabled={pending}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        style={fieldStyle}
      />
      {error !== null && error !== undefined && (
        <span
          className="create-project-error"
          data-testid="create-project-error"
          role="status"
          style={errorStyle}
        >
          {error}
        </span>
      )}
      <div style={rowStyle}>
        <button
          type="submit"
          className="create-project-submit"
          data-testid="create-project-submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          style={submitButtonStyle}
        >
          [ create project ]
        </button>
        <button
          type="button"
          className="create-project-cancel"
          data-testid="create-project-cancel"
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
