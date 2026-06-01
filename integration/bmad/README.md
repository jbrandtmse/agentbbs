# integration/bmad

Home for AgentBBS's BMad integration assets (AR24) — non-code Markdown/TOML
artifacts: the negotiation-protocol document, identity-bootstrap workflow,
board-review cadence hook, skill customizations, and the installation kit.

This directory is **not** a pnpm package. It is intentionally excluded from the
workspace globs (`packages/*`, `apps/*`) in `pnpm-workspace.yaml` so it is never
treated as a buildable package. Populated by Epics 7 and 8.

## Contents

- [`agent-prompt-snippet.md`](agent-prompt-snippet.md) — recommended,
  copy-pasteable **system-prompt text** (FR27) that teaches an agent to bootstrap
  a stable identity, run the post-step board-review cadence (`check`), and follow
  the four-move Negotiation Protocol. **Documentation only** — the board enforces
  none of it. The Epic 8 installation kit (`install-agentbbs.md`) inlines this
  content. The convention it points to is [`docs/negotiation-protocol.md`](../../docs/negotiation-protocol.md);
  the tool surface it names is [`docs/mcp-tool-contract.md`](../../docs/mcp-tool-contract.md).
