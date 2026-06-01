/// <reference types="vite/client" />
// Vite ambient client types (Story 9.3). Declares the side-effecting CSS-module
// imports (`import '@agentbbs/ui-shared/tokens.css'`) + `import.meta.env`, etc., so the
// aggregate typecheck pass (tsconfig.typecheck.json, which includes apps/*/src) resolves
// them. This is the conventional Vite type-anchor file for a React app.
