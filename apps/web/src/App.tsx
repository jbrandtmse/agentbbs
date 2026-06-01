// The web control-room shell (Story 9.3, Task 1).
//
// MINIMAL for 9.3 — it proves the PIPE end-to-end, not the final UI (the rich nav tree
// is Story 9.4, the room thread 9.5, the full live-update UI 9.9). On mount it:
//   1. fetches the board directory from the host's JSON API and renders the project list
//      from REAL ledger data (UI → JSON API → host → core → data-access);
//   2. opens an SSE connection and folds each delta the host pushes (host → operator
//      browser live view; NFR5 — never an agent push), showing the live high-water-mark
//      + delta count so an appended event is observably reflected.
// It imports @agentbbs/ui-shared (the FIRST cross-package consumer of the shared React
// core) and the tokens.css design-token core, so the shell is themed by the same tokens
// the VS Code surface will use. It NEVER imports @agentbbs/core / @agentbbs/data-access
// and never speaks MCP or SQL (NFR2) — it speaks only the JSON API + SSE.

import { useEffect, useState } from 'react';
import { TokenProbe } from '@agentbbs/ui-shared';

import {
  fetchDirectory,
  foldDelta,
  INITIAL_LIVE_STATE,
  openEventStream,
} from './api-client.js';

import type { LiveState, ProjectWire } from './api-client.js';
import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  color: 'var(--text-body)',
  background: 'var(--surface-base)',
  fontFamily: 'var(--message-body-font)',
  padding: '1rem',
  minHeight: '100vh',
};

/** The web control-room shell. */
export function App() {
  const [projects, setProjects] = useState<ProjectWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>(INITIAL_LIVE_STATE);

  // Load the board directory once on mount (real ledger data over the JSON API).
  useEffect(() => {
    let cancelled = false;
    fetchDirectory()
      .then((res) => {
        if (!cancelled) setProjects(res.projects);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load board.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open the SSE live view; fold each delta into the live state. Clean up on unmount.
  useEffect(() => {
    const close = openEventStream((event) => {
      setLive((prev) => foldDelta(prev, event));
    });
    return close;
  }, []);

  return (
    <main style={shellStyle} data-testid="web-shell">
      <h1>AgentBBS — Web Control Room</h1>
      <TokenProbe label="themed by @agentbbs/ui-shared tokens" />

      <section data-testid="live-status">
        <p>
          Live (SSE): <span data-testid="live-seq">{live.lastSeq}</span> last
          seq, <span data-testid="live-count">{live.deltaCount}</span> deltas
        </p>
      </section>

      <section data-testid="directory">
        <h2>Projects</h2>
        {error !== null && <p data-testid="error">Error: {error}</p>}
        {projects === null && error === null && <p>Loading the board…</p>}
        {projects !== null && projects.length === 0 && (
          <p data-testid="empty">No projects yet.</p>
        )}
        {projects !== null && projects.length > 0 && (
          <ul data-testid="project-list">
            {projects.map((project) => (
              <li key={project.project_id} data-project-id={project.project_id}>
                <strong>{project.title}</strong> — {project.description} (by{' '}
                {project.announcer})
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
