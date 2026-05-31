// QA-added coverage (Story 2.2, AC #2 case-folding) — REAL-RUNTIME: the REAL
// `core.register` driven DIRECTLY against the REAL composed `createDataAccess`
// (better-sqlite3) over a genuine SQLite file in an OS temp dir. NOTHING mocked:
// core's canonicalization + the real `appendGuarded` `json_extract` SELECT guard
// are both exercised together.
//
// Why this exists (the residual gap): the dev's case-folding evidence lives in two
// places that each stop short of this exact path —
//   - register.test.ts proves core lowercases + maps a conflict to HANDLE_TAKEN,
//     but against an IN-MEMORY fake (no real json_extract guard);
//   - register.integration.test.ts proves `ada`/`ada` collide over MCP, but the
//     MCP Zod boundary REJECTS any non-canonical handle, so a non-canonical handle
//     never reaches the real SQLite guard through that path.
// The brief asks specifically that the core `register` DEFENSIVELY lowercases so a
// "non-canonical handle reaching core directly still collapses" against the real
// guard. data-access may import the @agentbbs/core barrel (adapter→port direction,
// lint-allowed — the race worker already does), so this drives `register` directly,
// BYPASSING the Zod boundary, and asserts the canonical collapse at the real ledger:
//   - register('Ada') stores the canonical 'ada' (actor + payload), real createdAt;
//   - a prior register('ada') then a direct register('Ada') (or 'ADA') collides
//     with HANDLE_TAKEN against the real json_extract guard — exactly ONE ledger row;
//   - registering 'ada' then 'aDa' then 'ADA' all collapse to one identity.
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BoardError, register } from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { DataAccessHandle } from './data-access.js';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

/** Count identity.registered events for a canonical handle in the real ledger. */
async function registeredCount(handle: string): Promise<number> {
  const events = await da!.eventsByType('identity.registered');
  return events.filter((e) => e.actor === handle).length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-register-direct-qa-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  da = createDataAccess({ dbPath });
});

afterEach(() => {
  try {
    da?.close();
  } catch {
    /* already closed */
  }
  da = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('register (core) directly against the real ledger — defensive case-folding (AC #2)', () => {
  it('canonicalizes a non-canonical handle to lowercase at the REAL ledger (actor + payload)', async () => {
    // 'Ada' would be rejected by the MCP Zod boundary, but reaching core directly it
    // must still collapse to 'ada' — proven against the real SQLite store, not a fake.
    const identity = await register(da!, {
      handle: 'Ada',
      currentFocus: 'shipping 2.2',
    });

    expect(identity.handle).toBe('ada');
    // createdAt is a real ISO-8601 instant the data-access layer assigned.
    expect(new Date(identity.createdAt).toISOString()).toBe(identity.createdAt);
    expect(identity.lastSeen).toBe(identity.createdAt);

    // The stored event's actor + payload handle are the canonical lowercased form.
    const events = await da!.eventsByType('identity.registered');
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe('ada');
    expect((events[0]?.payload as { handle: string }).handle).toBe('ada');
  });

  it('a prior canonical registration collides with a later non-canonical one via the REAL json_extract guard (HANDLE_TAKEN, exactly one row)', async () => {
    await register(da!, { handle: 'ada', currentFocus: 'first' });

    // A different casing reaching core directly collapses to 'ada' and the REAL
    // uniqueness guard (json_extract on the canonical stored value) trips.
    const err = await register(da!, {
      handle: 'Ada',
      currentFocus: 'second',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).code).toBe('HANDLE_TAKEN');

    // The atomic guard prevented the duplicate: exactly one canonical row remains.
    expect(await registeredCount('ada')).toBe(1);
  });

  it('multiple casings all collapse to a SINGLE identity (ada, aDa, ADA)', async () => {
    await register(da!, { handle: 'ada', currentFocus: 'first' });

    for (const variant of ['aDa', 'ADA', 'Ada']) {
      const err = await register(da!, {
        handle: variant,
        currentFocus: `attempt ${variant}`,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BoardError);
      expect((err as BoardError).code).toBe('HANDLE_TAKEN');
    }

    // Only the original canonical registration persisted.
    expect(await registeredCount('ada')).toBe(1);
    const all = await da!.eventsByType('identity.registered');
    expect(all).toHaveLength(1);
    expect((all[0]?.payload as { currentFocus: string }).currentFocus).toBe(
      'first',
    );
  });

  it('two DIFFERENT canonical handles both register independently', async () => {
    const a = await register(da!, { handle: 'ada', currentFocus: 'a' });
    const b = await register(da!, { handle: 'bob', currentFocus: 'b' });
    expect(a.handle).toBe('ada');
    expect(b.handle).toBe('bob');
    expect(await registeredCount('ada')).toBe(1);
    expect(await registeredCount('bob')).toBe(1);
  });
});
