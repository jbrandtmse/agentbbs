// Content-guard for the Negotiation Protocol doc (Story 7.1, AC #3).
//
// `docs/negotiation-protocol.md` documents the four-move CONVENTION (Propose → Counter → Ratify →
// Frozen) layered over the shipped tools (`reply` / `react` / `unreact` / `read_contract`). It is
// a CONVENTION the board enforces NONE of — that disclaimer is the load-bearing caveat. A doc
// like this can silently rot: a future edit could drop a move, drift a tool mapping, or quietly
// delete the "the board enforces none of this" statement, and nothing would catch it.
//
// This is NOT a drift guard against the code (that is `tool-contract.drift.test.ts`, which pins
// the live tool/error/event surface). The four move→tool mappings here are a documentation
// CONVENTION, not a runtime surface — there is no list of "moves" in the code to compare against.
// So this test asserts the doc CONTAINS, by simple presence check, the things AC #3 requires it to
// keep: the four move NAMES, the four TOOL mappings, and the explicit "convention / not enforced"
// statement. A presence check (not an exact-text match) is deliberate: the surrounding prose may
// be reworded freely; only the load-bearing tokens are pinned, so the guard does not fight ordinary
// editing while still failing loudly if a move or the disclaimer disappears.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The protocol doc lives at the repo root under `docs/`. This test file is at
// `packages/mcp-server/src/`, so three levels up from its directory is the repo root. Resolving
// relative to `import.meta.url` (not `process.cwd()`) keeps the test correct regardless of where
// the suite is launched from — same convention as `tool-contract.drift.test.ts`.
const PROTOCOL_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'negotiation-protocol.md',
);

/**
 * Read the protocol doc from disk. A separate helper so a missing/renamed doc fails loudly with a
 * clear message rather than an opaque ENOENT mid-assertion.
 */
function readProtocolDoc(): string {
  try {
    return readFileSync(PROTOCOL_DOC_PATH, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the Negotiation Protocol doc at ${PROTOCOL_DOC_PATH}. ` +
        `Story 7.1 requires docs/negotiation-protocol.md to exist (it is the documented ` +
        `negotiation convention, FR25 / Appendix A).`,
      { cause },
    );
  }
}

describe('docs/negotiation-protocol.md content guard', () => {
  // The four moves of the protocol (AC #1). Dropping any of these names from the doc means the
  // protocol silently lost a move — caught here.
  const FOUR_MOVES = ['Propose', 'Counter', 'Ratify', 'Frozen'] as const;

  // The shipped board tools each move maps to (AC #1). The doc must mention each by its exact
  // wire/tool name so the convention stays bound to the real surface.
  const TOOL_MAPPINGS = [
    'reply', // Propose / Counter
    'react', // Ratify
    'unreact', // retract a ratification
    'read_contract', // Frozen (the computed contract)
  ] as const;

  it('names all four protocol moves (Propose, Counter, Ratify, Frozen)', () => {
    const doc = readProtocolDoc();
    for (const move of FOUR_MOVES) {
      expect(
        doc.includes(move),
        `the protocol doc must name the "${move}" move — a future edit must not silently drop a move (AC #1)`,
      ).toBe(true);
    }
  });

  it('maps each move to its shipped tool (reply, react, unreact, read_contract)', () => {
    const doc = readProtocolDoc();
    for (const tool of TOOL_MAPPINGS) {
      expect(
        doc.includes(tool),
        `the protocol doc must mention the \`${tool}\` tool — the move→tool mapping must not drift from the shipped surface (AC #1)`,
      ).toBe(true);
    }
  });

  it('states EXPLICITLY that the board enforces none of the protocol — it is a convention (AC #2)', () => {
    const doc = readProtocolDoc().toLowerCase();

    // The load-bearing caveat: the protocol is a CONVENTION the board ENFORCES NONE of. Both ideas
    // must be present — the word "convention" AND an explicit "enforce(s) none / not enforced"
    // style statement — so a reword cannot quietly drop the disclaimer while keeping a softer
    // half of it.
    expect(
      doc.includes('convention'),
      'the protocol doc must call the protocol a "convention" (AC #2)',
    ).toBe(true);

    // Accept the natural phrasings of "the board does not enforce this": "enforces none",
    // "enforce none", "not enforced", "enforces nothing", "no enforcement". Any one satisfies the
    // disclaimer; all absent means the not-enforced statement was lost.
    const enforcementDisclaimer =
      /enforces?\s+none|not\s+enforced|enforces?\s+nothing|no\s+enforcement/.test(
        doc,
      );
    expect(
      enforcementDisclaimer,
      'the protocol doc must state EXPLICITLY that the board does NOT enforce the protocol ' +
        '(e.g. "enforces none of it", "not enforced", "no enforcement") — AC #2',
    ).toBe(true);

    // And the mechanical counterpart: read_contract COMPUTES the contract but does not validate
    // the ritual. The doc pairs "read_contract" with a "mechanical(ly)/compute(s)" claim; pin that
    // the doc still says the contract is COMPUTED (not validated/enforced).
    expect(
      /comput/.test(doc),
      'the protocol doc must state that the contract is COMPUTED (read_contract mechanically ' +
        'computes the latest 👍’d message, it does not validate the ritual) — AC #2',
    ).toBe(true);
  });

  // The FR21 CONTRACT SEMANTIC is the single most load-bearing factual claim in this doc and the
  // one most likely to be silently mis-edited into something the shipped `read_contract` does NOT
  // do (e.g. "the message with the most 👍s", "the first 👍'd message", or an implied STORED
  // "freeze"). The three assertions above do not pin it: they pass even if the contract were
  // mischaracterized, because `read_contract` / `convention` / "comput" all still appear. So pin
  // the two tokens that DEFINE the contract correctly per FR21 (`packages/core/src/rooms/
  // contract.ts` — the highest-`seq` message currently holding a live 👍, computed never stored):
  // the contract is the **highest-`seq`** message, and the 👍 must be **live**. A "most 👍s" /
  // "first" / "oldest" rewrite drops "highest…seq"; a "stored freeze" / "any 👍'd" rewrite drops
  // the "live" qualifier — either way this fails loudly. Presence checks (tolerant of prose
  // rewording: any text may sit between "highest" and "seq", case-insensitive) so the guard pins
  // the SEMANTIC, not a particular sentence.
  it('pins the FR21 contract semantic — the highest-`seq` LIVE-👍’d message (not "most 👍s", not a stored freeze)', () => {
    const doc = readProtocolDoc().toLowerCase();

    // (1) The contract is the HIGHEST-`seq` message. "highest" adjacent to "seq" (allowing the
    // markdown backticks / a word or two of prose between them) — rules out a "most 👍s" / "first"
    // / "oldest" mischaracterization, which is the exact way this claim is most likely to rot.
    expect(
      /highest[\s`*-]*seq/.test(doc),
      'the protocol doc must define the contract as the HIGHEST-`seq` message (FR21) — a ' +
        'mischaracterization such as "the message with the most 👍s", "the first 👍’d ' +
        'message", or "the oldest" would silently lie about what read_contract computes ' +
        '(`packages/core/src/rooms/contract.ts` returns the highest-`seq` live-👍’d message)',
    ).toBe(true);

    // (2) The 👍 holding the contract must be LIVE (it reverts when retracted). "live" must appear
    // in the doc — its loss would imply a STORED / permanent freeze, contradicting the
    // computed-never-stored, reverts-on-retraction semantic (FR21, Story 5.3).
    expect(
      doc.includes('live'),
      'the protocol doc must state the contract’s 👍 must be LIVE (the contract reverts when ' +
        'the 👍 is retracted; it is computed every call, never stored) — dropping "live" would ' +
        'imply a permanent/stored freeze, which read_contract does NOT do (FR21)',
    ).toBe(true);
  });
});
