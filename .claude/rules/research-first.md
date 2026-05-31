## Brief overview
- Adopt a "Research First" workflow: when not 100% certain about a technical point, research with Perplexity MCP before deciding or coding.
- Default to verifying assumptions against authoritative sources rather than relying on memory or guesswork, especially for APIs, syntax, configuration, and version-specific behavior.
- Keep research focused, cite authoritative sources, and convert findings into precise implementation steps.

## When to research
- Any uncertainty about a library, framework, or API: method signatures, parameters, return types, or configuration options.
- Language syntax and semantics where behavior is subtle or easy to get wrong (edge cases, error handling, scoping, lifecycle).
- Version-specific or deprecated behavior, breaking changes, and migration paths.
- Conflicting documentation, ambiguous answers, or gaps in established best practices.

## How to use Perplexity MCP effectively
- Use the integrated Perplexity MCP tools with specific, context-rich prompts:
  - Prefer: `search` for broad discovery, `reason` for analysis and trade-offs, `deep_research` for thorough multi-source investigation.
- Include context in queries (language/framework name, version, feature name, known error code or message).
- Write specific, scoped queries rather than vague ones — name the exact symbol, error, or behavior you need to confirm.
- Iterate with follow-up questions if initial results conflict or lack clarity.

## Sources and citation
- Prioritize: official documentation, official GitHub/org publications, maintainer-authored posts, and highly reputable community sources.
- Provide 2–4 authoritative links with a one-line rationale per link.
- Quote short key lines only when they directly impact implementation decisions.

## From research to action
- Summarize decisions as bullets before coding (what to change and why).
- Map each decision to a concrete step (e.g., "Use the async variant" -> "Update the call sites in moduleX").
- Validate changes after applying them (build, compile, lint, or run the relevant tests).

## Verification emphasis
- Confirm API and method signatures, async/sync patterns, and configuration via research prior to implementing.
- After research, verify uncertain behavior with small, isolated tests rather than assuming.
- Prefer idiomatic, well-supported patterns for the language or framework in use.

## Escalation if ambiguity remains
- If sources disagree, briefly summarize the conflict and propose the safest standards-compliant approach.
- If uncertainty persists after an initial research pass, ask one targeted clarifying question to unblock.

## Deliverable format for researched answers
- Provide:
  - A brief summary of findings (1–3 bullets)
  - A decision list (actionable bullets)
  - Source links (2–4) and any decisive short quotes
  - Any adjusted code snippet(s) reflecting the researched guidance
