// Ambient declarations for the webview's side-effecting CSS imports (Story 10.4).
//
// The webview bundle imports the ui-shared stylesheets + the `--vscode-*` theme layer as
// SIDE-EFFECTING modules (`import '@agentbbs/ui-shared/tokens.css'`, `import './vscode-tokens.css'`)
// — esbuild's `css` loader bundles them into dist/webview/main.css. apps/web gets these
// declarations from `vite/client`; the extension is esbuild-bundled (not Vite), so we declare them
// here so `tsc --noEmit` resolves the imports. They export nothing — imported only for their
// stylesheet side effect.

declare module '*.css';
declare module '@agentbbs/ui-shared/tokens.css';
declare module '@agentbbs/ui-shared/markdown.css';
declare module '@agentbbs/ui-shared/room.css';
declare module '@agentbbs/ui-shared/chrome.css';
