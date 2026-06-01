// JoinProjectPicker — the calm "join a project" discovery picker (Story 9.12 / AC #1, #2;
// operator INITIATE-surface parity — the operator joins a sub-board via the SAME `join_board`
// op an agent uses, no operator backdoor).
//
// A small prop-driven inline panel (NOT a modal — Story 9.10 calm chrome): a terse lowercase
// `join a project` label over the list of `joinable` projects (the global-read directory MINUS
// the ones the operator already belongs to — the surface computes that filter). Each row is a
// `[ join ]`-style button; clicking it fires `onChoose(projectId)` and the surface runs the
// `joinBoard` write + refreshes the tree so the new membership shows LIVE. A `cancel` link
// dismisses the picker (a clean no-op — no board write). The inline `error` slot renders any
// calm host error (e.g. `NO_OPERATOR` for a watching-only host) UNDER the list, panel stays
// open. The EMPTY-list state is a CALM line ("no projects to join") — NOT an error (the
// operator already belongs to everything, or the board is empty).
//
// PROP-DRIVEN (NFR2): `joinable` / `onChoose` / `onCancel` / `onEscape` / `error` / `pending`
// are the surface's contract; the surface owns the directory→joinable filter, the `joinBoard`
// write, the error→`error` prop wiring, and the live tree refresh. Imports ONLY React (no
// @agentbbs/core / @agentbbs/data-access). React 19 automatic JSX runtime.

import type { CSSProperties, KeyboardEvent } from 'react';

/** One joinable project row (the surface pre-filters the global-read directory to these). */
export interface JoinableProject {
  /** The project's slug id (passed to `onChoose`). */
  projectId: string;
  /** The project title (the visible label). */
  title: string;
}

export interface JoinProjectPickerProps {
  /**
   * The projects the operator may join — the global-read directory MINUS the ones the operator
   * already belongs to (the surface computes this filter against the canonical operator handle).
   * An EMPTY list renders the calm "no projects to join" line (NOT an error).
   */
  joinable: JoinableProject[];
  /**
   * Fired with a `projectId` when the operator chooses a project to join. The surface runs the
   * `joinBoard` write (the SAME op an agent uses) then refreshes the tree (live membership).
   */
  onChoose?: (projectId: string) => void;
  /** Fired when the operator clicks `cancel` (the surface dismisses the picker — a clean no-op). */
  onCancel?: () => void;
  /**
   * A calm inline error message to render UNDER the list (e.g. `NO_OPERATOR` — "watching-only;
   * pass --as <handle> to join"), or `null`/omitted for no error. NEVER a modal; the picker stays.
   */
  error?: string | null;
  /**
   * Whether a join write is in flight — disables the choose/cancel controls so the operator does
   * not double-submit (a basic disabled state). Default `false`.
   */
  pending?: boolean;
  /**
   * Story 9.10 a11y — fired when the operator presses Esc in the picker so the surface can
   * dismiss it / return focus to the tree. Optional; the surface owns where focus goes.
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

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const emptyStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-dim)',
  margin: 0,
};

const errorStyle: CSSProperties = {
  fontFamily: 'var(--ui-label-font)',
  fontSize: 'var(--ui-label-size)',
  color: 'var(--text-warn, var(--text-dim))',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

/**
 * Render the calm join-a-project picker. A `join a project` label over the `joinable` rows (each a
 * `[ join ]` button → `onChoose(projectId)`) + a `cancel` link; the empty-list calm state and the
 * inline `error` slot (no modal) both render without dismissing the panel. Prop-driven; the surface
 * owns the directory filter, the `joinBoard` write, and the live tree refresh.
 */
export function JoinProjectPicker({
  joinable,
  onChoose,
  onCancel,
  error = null,
  pending = false,
  onEscape,
}: JoinProjectPickerProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
    }
  }

  const chooseButtonStyle: CSSProperties = {
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
    textAlign: 'left',
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
    <div
      className="join-project-picker"
      data-testid="join-project-picker"
      style={containerStyle}
      role="group"
      aria-label="join a project"
      onKeyDown={handleKeyDown}
    >
      <span style={labelStyle}>join a project</span>

      {joinable.length === 0 ? (
        <p
          className="join-project-empty"
          data-testid="join-project-empty"
          style={emptyStyle}
        >
          no projects to join
        </p>
      ) : (
        <ul
          className="join-project-list"
          data-testid="join-project-list"
          style={listStyle}
        >
          {joinable.map((project) => (
            <li key={project.projectId}>
              <button
                type="button"
                className="join-project-choice"
                data-testid="join-project-choice"
                data-project-id={project.projectId}
                disabled={pending}
                aria-disabled={pending}
                onClick={() => onChoose?.(project.projectId)}
                style={chooseButtonStyle}
              >
                [ join ] {project.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error !== null && error !== undefined && (
        <span
          className="join-project-error"
          data-testid="join-project-error"
          role="status"
          style={errorStyle}
        >
          {error}
        </span>
      )}

      <div style={rowStyle}>
        <button
          type="button"
          className="join-project-cancel"
          data-testid="join-project-cancel"
          disabled={pending}
          aria-disabled={pending}
          onClick={onCancel}
          style={cancelButtonStyle}
        >
          cancel
        </button>
      </div>
    </div>
  );
}
