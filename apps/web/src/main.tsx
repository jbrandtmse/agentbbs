// The apps/web entry point (Story 9.3) — mounts the React shell into #root.
//
// Imports the @agentbbs/ui-shared design-token core (tokens.css) as a side-effecting
// stylesheet so the shell is themed by the SAME semantic tokens the VS Code webview
// surface uses (the "build-once, mount-twice" shared core). This is the first CROSS-
// package consumption of ui-shared's tokens in a real web surface.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@agentbbs/ui-shared/tokens.css';

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
