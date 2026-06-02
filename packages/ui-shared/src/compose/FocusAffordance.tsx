// FocusAffordance — the calm "set my focus" affordance for the operator identity row (Story 9.13 /
// AC #1; operator INITIATE-surface parity — the operator sets their own current focus via the SAME
// core `updateFocus` op an agent uses, no operator backdoor).
//
// A small prop-driven inline affordance (NOT a modal — Story 9.10 calm chrome) that sits next to
// the `@operator (you)` identity row. It shows the operator's CURRENT focus (a terse italic line) or
// a calm `set your focus…` placeholder, with an inline `[ edit ]` link that reveals a single-field
// edit/submit form (`onSubmit(focus)`), a `cancel` link, an Esc handler, a `pending` disabled state,
// and an inline `error` slot under the field (no modal — the draft stays).
//
// DISABLED STATE (AC1, never a crash): when `disabled` is set, the affordance renders INERT — the
// current focus (if any) stays visible but the `[ edit ]` control is gone, replaced by a terse
// lowercase `reason` line ("watching-only — start `agentbbs ui --as <handle>`" / "handle not
// registered"). The surface decides disabled = watching-only (no operator handle) OR unregistered.
//
// PROP-DRIVEN (NFR2): `focus` / `onSubmit` / `onCancel` / `onEscape` / `disabled` / `disabledReason`
// / `error` / `pending` are the surface's contract; the surface owns the `updateFocus` write, the
// error→`error` prop wiring, and re-reading `/api/me` so the new focus reflects live. Imports ONLY
// React (no @agentbbs/core / @agentbbs/data-access). React 19 automatic JSX runtime.

import { useState } from 'react';

import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';

export interface FocusAffordanceProps {
  /** The operator's current focus statement (shown resting), or `null`/empty for the placeholder. */
  focus?: string | null;
  /**
   * Fired with the TRIMMED new focus when the operator submits a non-empty edit (the surface runs
   * `updateFocus` then re-reads `/api/me`). NOT fired when the field is empty/whitespace-only, nor
   * when `disabled`.
   */
  onSubmit?: (focus: string) => void;
  /** Fired when the operator clicks `cancel` in the edit form (the surface closes the editor). */
  onCancel?: () => void;
  /**
   * A calm inline error message to render UNDER the field (e.g. a host error), or `null`/omitted for
   * no error. NEVER a modal; the draft stays in the field.
   */
  error?: string | null;
  /**
   * Whether the focus write is in flight — disables the controls so the operator does not
   * double-submit (a basic disabled state). Default `false`.
   */
  pending?: boolean;
  /**
   * Whether the affordance is DISABLED inert (watching-only OR unregistered operator — the primary
   * client-side guard, AC1). When true the `[ edit ]` control is suppressed and `disabledReason`
   * renders as a terse line; the current focus (if any) still shows. Default `false`.
   */
  disabled?: boolean;
  /** The terse lowercase reason rendered when `disabled` (e.g. "watching-only — …"). */
  disabledReason?: string | null;
  /**
   * Story 9.10 a11y — fired when the operator presses Esc in the field so the surface can close the
   * editor / return focus to the tree. Optional; the surface owns where focus goes.
   */
  onEscape?: () => void;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-1)',
  padding: '0 var(--space-3) var(--space-2)',
};

const restingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
};

const focusTextStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  fontStyle: 'italic',
  color: 'var(--text-dim)',
};

const placeholderStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-faint)',
};

const linkButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-dim)',
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  cursor: 'pointer',
  padding: 0,
};

const reasonStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-faint)',
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
 * Render the calm set-my-focus affordance. Resting: the current focus (or `set your focus…`
 * placeholder) + an inline `[ edit ]`. Editing: a single field + submit/cancel, empty-blocks-submit,
 * the inline `error` slot (no modal). Disabled: inert, the current focus stays + a terse reason
 * line, no edit control. Prop-driven; the surface owns the write + the live `/api/me` re-read.
 */
export function FocusAffordance({
  focus = null,
  onSubmit,
  onCancel,
  error = null,
  pending = false,
  disabled = false,
  disabledReason = null,
  onEscape,
}: FocusAffordanceProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const restingFocus = focus !== null && focus.trim().length > 0 ? focus : null;
  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !pending && !disabled;

  function openEditor(): void {
    if (disabled) return;
    setDraft(restingFocus ?? '');
    setEditing(true);
  }

  function closeEditor(): void {
    setEditing(false);
    setDraft('');
    onCancel?.();
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit?.(trimmedDraft);
    setEditing(false);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
      setDraft('');
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

  // EDITING — the inline single-field form (only reachable when not disabled).
  if (editing && !disabled) {
    return (
      <form
        className="focus-affordance"
        data-testid="focus-affordance"
        style={containerStyle}
        onSubmit={handleSubmit}
        aria-label="set your focus"
      >
        <input
          type="text"
          className="focus-field"
          data-testid="focus-field"
          placeholder="what are you working on…"
          aria-label="your focus"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          style={fieldStyle}
        />
        {error !== null && error !== undefined && (
          <span
            className="focus-error"
            data-testid="focus-error"
            role="status"
            style={errorStyle}
          >
            {error}
          </span>
        )}
        <div style={rowStyle}>
          <button
            type="submit"
            className="focus-submit"
            data-testid="focus-submit"
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            style={submitButtonStyle}
          >
            [ set focus ]
          </button>
          <button
            type="button"
            className="focus-cancel"
            data-testid="focus-cancel"
            disabled={pending}
            aria-disabled={pending}
            onClick={closeEditor}
            style={cancelButtonStyle}
          >
            cancel
          </button>
        </div>
      </form>
    );
  }

  // RESTING / DISABLED — the focus line + either the `[ edit ]` link (enabled) or the terse reason.
  return (
    <div
      className="focus-affordance"
      data-testid="focus-affordance"
      style={containerStyle}
    >
      <div style={restingRowStyle}>
        {restingFocus !== null ? (
          <span
            className="focus-current"
            data-testid="focus-current"
            style={focusTextStyle}
          >
            focus: {restingFocus}
          </span>
        ) : (
          <span
            className="focus-placeholder"
            data-testid="focus-placeholder"
            style={placeholderStyle}
          >
            set your focus…
          </span>
        )}
        {!disabled && (
          <button
            type="button"
            className="focus-edit"
            data-testid="focus-edit"
            disabled={pending}
            aria-disabled={pending}
            onClick={openEditor}
            style={linkButtonStyle}
          >
            [ edit ]
          </button>
        )}
      </div>
      {disabled && disabledReason !== null && disabledReason !== undefined && (
        <span
          className="focus-disabled-reason"
          data-testid="focus-disabled-reason"
          style={reasonStyle}
        >
          {disabledReason}
        </span>
      )}
      {/* A failed live SET closes the editor (the parent's success path reflects on the resting row),
          so surface the calm inline error HERE too — otherwise a real POST failure would be silent.
          Not shown while disabled (the terse reason owns that line). No modal (calm chrome). */}
      {!disabled && error !== null && error !== undefined && (
        <span
          className="focus-error"
          data-testid="focus-error"
          role="status"
          style={errorStyle}
        >
          {error}
        </span>
      )}
    </div>
  );
}
