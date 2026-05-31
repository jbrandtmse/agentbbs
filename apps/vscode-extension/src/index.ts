// @agentbbs/vscode-extension — VS Code surface. The extension host opens the DB via
// @agentbbs/data-access and bridges to webview(s) (one WebviewPanel per room) that
// mount @agentbbs/ui-shared with --vscode-* theme tokens. esbuild single-bundle
// config arrives in Epic 10 (kept as plain TS now per Story 1.1 scope).

/** Package name marker; replaced by the extension activate() in Epic 10. */
export const VSCODE_EXTENSION_APP = '@agentbbs/vscode-extension';
