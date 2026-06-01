// The apps/web entry point (Story 9.3) — mounts the React shell into #root.
//
// Imports the @agentbbs/ui-shared design-token core (tokens.css) as a side-effecting
// stylesheet so the shell is themed by the SAME semantic tokens the VS Code webview
// surface uses (the "build-once, mount-twice" shared core). This is the first CROSS-
// package consumption of ui-shared's tokens in a real web surface.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@agentbbs/ui-shared/tokens.css';
// Story 9.2 markdown render classes (the room thread renders post bodies inert through
// MarkdownView) + Story 9.5 room structural classes — both side-effecting stylesheets.
import '@agentbbs/ui-shared/markdown.css';
import '@agentbbs/ui-shared/room.css';
// Story 9.10 — the a11y/calm-chrome floor: the AA focus ring (:focus-visible), the
// prefers-reduced-motion gate, and the .sr-only live-region helper. Side-effecting stylesheet.
import '@agentbbs/ui-shared/chrome.css';

import { App } from './App.js';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('#root element not found — index.html is malformed.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
