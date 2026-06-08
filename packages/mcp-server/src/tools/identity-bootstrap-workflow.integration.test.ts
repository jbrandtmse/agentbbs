// EXECUTION proof for the Story 8.1 identity-bootstrap workflow
// (`integration/bmad/identity-bootstrap.md`) — REAL-RUNTIME evidence (skill-rules
// Rule 3), complementary to the dev's CONTENT-GUARD (`identity-bootstrap-doc.test.ts`).
//
// The content-guard proves the workflow DOC says the right words (it names `register`
// /`login`, covers the three identity cases, states the no-secret rule). It does NOT
// prove the flow the doc prescribes is actually EXECUTABLE against the shipped tools.
// This test closes that gap: it drives the EXACT branches the workflow prescribes
// through a real MCP `Client` ↔ a `createBoardServer`-built `McpServer` over the SDK's
// `InMemoryTransport`, backed by the REAL `createDataAccess` (better-sqlite3 behind the
// NFR2 seam) against a genuine SQLite file in an OS temp dir. NOTHING is mocked: the
// wire, the server, the `register`/`login` tools, core, and the ledger are all real.
//
// The workflow (`integration/bmad/identity-bootstrap.md`) prescribes three branches;
// each test below is one of them, using the doc's OWN worked example handle
// (`amelia-dev@taskflow`) so the proof is recognisably the doc's flow:
//
//   Step 3 (no recorded handle → derive `persona@project`, register):
//     - `register{ handle: 'amelia-dev@taskflow', current_focus: 'x' }` SUCCEEDS — i.e.
//       the default `persona@project` handle the doc derives is a LEGAL handle the live
//       tool accepts (the `@` and `-` are in the canonical charset `[a-z0-9._@-]`).
//
//   Step 3 on `HANDLE_TAKEN` (a second `dev` agent → disambiguate with `-2`):
//     - a SECOND `register` of the SAME `amelia-dev@taskflow` returns `HANDLE_TAKEN`;
//       then `register{ handle: 'amelia-dev@taskflow-2' }` (the doc's discriminator
//       strategy) SUCCEEDS — proving the disambiguation actually resolves the collision
//       against the real uniqueness guard.
//
//   Step 2 (recorded handle → login; with the `LOGIN_UNKNOWN` fall-through):
//     - `login{ handle }` of a registered handle SUCCEEDS (re-establishes it);
//     - `login{ handle }` of a never-registered (but "recorded") handle returns
//       `LOGIN_UNKNOWN` — the exact signal the doc's Step 2 fall-through ("recorded but
//       never registered → fall through to register") keys off.
//
//   Step 5 (Story 12.2 — announce-or-join the project's sub-board, after identity):
//     - register → `announce_project{ title: 'Taskflow', … }` creates the sub-board, the
//       announcer its first member, with `project_id` = slug(title) = `taskflow` = the
//       handle's `@taskflow` scope (AR10 / AC #2);
//     - a SECOND run (same agent, fresh session) re-announces → `PROJECT_EXISTS`, then
//       `join_board{ project_id }` is a no-op re-join (no dup, no error — AC #3);
//     - a SECOND AGENT in the same repo derives the same `project_id` → `PROJECT_EXISTS`
//       → `join_board` → becomes a member of the ONE existing sub-board (AC #3). All
//       assertions read board state OUT-OF-BAND via the live `list_projects` tool.
//
// This is an EXECUTION proof of the asset's described flow; the doc-content guard and
// this runtime guard are complementary (says-the-right-words vs. the-words-actually-work).
//
// Harness mirrors `tools/register.integration.test.ts` / `tools/login.integration.test.ts`
// exactly (same `connect()` seam with a caller-owned session holder, same temp-DB
// lifecycle, same `readErrorPayload`). Never touches the repo's real `.agentbbs/`: the DB
// lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBoardServer } from '../server.js';
import { createSessionIdentity } from '../session.js';
import { readErrorPayload } from '../error-map.js';

import type { SessionIdentity } from '../session.js';
import type { DataAccessHandle } from '@agentbbs/data-access';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// The doc's worked example handle (`persona@project` form): persona `amelia-dev`, project
// slug `taskflow`. Using the doc's literal example keeps this proof recognisably the
// workflow's flow — and exercises that the `@`/`-` the doc relies on are in the live
// canonical charset `[a-z0-9._@-]`.
const DEFAULT_HANDLE = 'amelia-dev@taskflow';
// The doc's first disambiguator on `HANDLE_TAKEN` (Step 3: append `-2`, then `-3`, …).
const DISAMBIGUATED_HANDLE = 'amelia-dev@taskflow-2';

let dir: string;
let dbPath: string;
let dataAccess: DataAccessHandle | undefined;
const disposers: (() => Promise<void>)[] = [];

/**
 * Stand up a real Client↔server pair over the in-memory transport, real ledger, with a
 * caller-owned {@link SessionIdentity} holder so the test can OBSERVE the session the
 * identity tools establish (the construction seam — no public "who am I" tool). Mirrors
 * the `connect()` in `tools/login.integration.test.ts`.
 */
async function connect(): Promise<{
  client: Client;
  session: SessionIdentity;
}> {
  const session = createSessionIdentity();
  const server = createBoardServer({
    dataAccess: dataAccess!,
    sessionIdentity: session,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  disposers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, session };
}

/** Count identity.registered events for a given handle in the real ledger. */
async function registeredCount(handle: string): Promise<number> {
  const events = await dataAccess!.eventsByType('identity.registered');
  return events.filter((e) => e.actor === handle).length;
}

/**
 * The Story 12.2 announce-or-join step (bootstrap Step 5) uses the doc's worked example:
 * project_id `taskflow` (the `@<project>` scope of `amelia-dev@taskflow`) and a title that
 * slugs to it. The board derives `project_id = slugify(title)`, so `Taskflow` → `taskflow`
 * (lowercase → strip non-`[a-z0-9]`), matching the handle's `@taskflow` (AR10 / AC #2).
 */
const PROJECT_TITLE = 'Taskflow';
const PROJECT_ID = 'taskflow';

/**
 * Core's project/sub-board slug rule (AR10), mirrored from `packages/core/src/projects/slug.ts`
 * (`announceProject` derives `project_id = slugify(title)` through it): lowercase → collapse every
 * run of non-`[a-z0-9]` characters to a single `-` → strip leading/trailing `-`. Mirrored locally
 * (not deep-imported) to avoid a cross-package import on the gate's typecheck path; the content-guard
 * `identity-bootstrap-doc.test.ts` is what PINS the asset's stated rule to slug.ts's real literals,
 * and pins this mirror's correctness on the worked example. Used here so the AC2 three-way
 * consistency assertion is bound to the REAL algorithm, not just the hardcoded `PROJECT_ID` constant.
 */
function coreSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Read the projects directory through the REAL `list_projects` tool over the wire, then return
 * the matching project record (or undefined). Out-of-band board-state read for the AC #3 "exactly
 * one sub-board, agent is a member" assertions — uses the shipped read tool, not a re-implementation.
 */
async function readProject(
  client: Client,
  projectId: string,
): Promise<{ project_id: string; members: string[] } | undefined> {
  const result = (await client.callTool({
    name: 'list_projects',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  const projects = (result.structuredContent as { projects: unknown[] })
    .projects as { project_id: string; members: string[] }[];
  return projects.find((p) => p.project_id === projectId);
}

/**
 * Count how many records in the live `list_projects` directory have this project_id. The AC #3
 * "exactly one sub-board" claim is stronger than "announcedCount === 1": it asserts the DIRECTORY
 * PROJECTION exposes a single record for the id. `readProject` uses `.find` (first match), which
 * would silently hide a second record with the same id — so this `.filter().length` is the
 * non-hiding companion that makes "exactly one sub-board exists" a real assertion (the lead's AC3
 * strengthening).
 */
async function projectRecordCount(
  client: Client,
  projectId: string,
): Promise<number> {
  const result = (await client.callTool({
    name: 'list_projects',
    arguments: {},
  })) as CallToolResult;
  expect(result.isError).toBeFalsy();
  const projects = (result.structuredContent as { projects: unknown[] })
    .projects as { project_id: string }[];
  return projects.filter((p) => p.project_id === projectId).length;
}

/**
 * Count `project.announced` events for a given project_id in the real ledger (the dup check). The
 * READ/folded `Event.payload` is camelCase (`projectId`) — the data-access layer maps at-rest
 * snake_case → camelCase on read, so the projection-side key is `projectId`, not `project_id`.
 */
async function announcedCount(projectId: string): Promise<number> {
  const events = await dataAccess!.eventsByType('project.announced');
  return events.filter(
    (e) => (e.payload as { projectId?: string }).projectId === projectId,
  ).length;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-identity-bootstrap-int-'));
  dbPath = join(dir, '.agentbbs', 'agentbbs.db');
  dataAccess = createDataAccess({ dbPath });
});

afterEach(async () => {
  while (disposers.length > 0) {
    await disposers.pop()?.();
  }
  try {
    dataAccess?.close();
  } catch {
    /* already closed */
  }
  dataAccess = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('identity-bootstrap workflow — EXECUTION proof against the live register/login tools (Story 8.1)', () => {
  it('Step 3 (no recorded handle): the derived `persona@project` default handle registers successfully', async () => {
    // The workflow's no-recorded-handle branch: derive `persona@project` and `register`
    // it. This proves the DERIVED handle (`amelia-dev@taskflow`) is a handle the live
    // tool actually ACCEPTS — the `@`/`-` are in the canonical charset, so the doc's
    // default-handle shape is not merely documented but executable.
    const { client, session } = await connect();

    const result = (await client.callTool({
      name: 'register',
      arguments: {
        handle: DEFAULT_HANDLE,
        current_focus: 'bootstrapping identity',
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBe(DEFAULT_HANDLE);
    expect(sc.current_focus).toBe('bootstrapping identity');
    // The real ledger holds exactly one identity for the derived handle, and the session
    // is established as it (register-or-login establishes the session — the bootstrap's
    // Step 3 success state).
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);
    expect(session.handle).toBe(DEFAULT_HANDLE);
  });

  it('Step 3 on collision (a second `dev`): default handle taken → HANDLE_TAKEN → disambiguate to `-2` → success', async () => {
    // The workflow's `HANDLE_TAKEN` disambiguation branch: a second same-persona agent
    // finds its derived default already claimed and appends `-2`. This proves the doc's
    // discriminator strategy actually RESOLVES the collision against the real uniqueness
    // guard — the registered `-2` handle is a distinct, accepted identity.
    const { client } = await connect();

    // A first agent has already claimed the default handle.
    const first = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'first dev' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();

    // The second agent derives the SAME default → the live tool rejects it HANDLE_TAKEN.
    const collision = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'second dev' },
    })) as CallToolResult;
    expect(collision.isError).toBe(true);
    expect(readErrorPayload(collision)).toMatchObject({ code: 'HANDLE_TAKEN' });
    // The collision appended nothing — still exactly one holder of the default handle.
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);

    // The workflow's disambiguation: append `-2` and re-register. This SUCCEEDS — the
    // disambiguated handle resolves the collision (the whole point of the doc's Step 3
    // retry loop).
    const disambiguated = (await client.callTool({
      name: 'register',
      arguments: {
        handle: DISAMBIGUATED_HANDLE,
        current_focus: 'second dev (disambiguated)',
      },
    })) as CallToolResult;
    expect(disambiguated.isError).toBeFalsy();
    expect(
      (disambiguated.structuredContent as Record<string, unknown>).handle,
    ).toBe(DISAMBIGUATED_HANDLE);
    // Two distinct identities now exist — the collision was genuinely resolved, not
    // silently merged.
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);
    expect(await registeredCount(DISAMBIGUATED_HANDLE)).toBe(1);
  });

  it('Step 2 (recorded handle): `login` re-establishes a registered handle; an unknown recorded handle returns LOGIN_UNKNOWN', async () => {
    // The workflow's recorded-handle branch: a handle recorded in AGENTS.md → `login`
    // with it. This proves BOTH halves of the doc's Step 2:
    //   (a) a recorded handle that WAS registered → `login` re-establishes it; and
    //   (b) a recorded handle that was NEVER registered → `login` returns LOGIN_UNKNOWN,
    //       the exact signal the doc's fall-through ("recorded but never registered →
    //       fall through to register") keys off.
    const { client, session } = await connect();

    // A prior session registered and recorded this handle (the steady state Step 1 finds).
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'prior session' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();

    // Simulate a FRESH session that has only the recorded handle (not yet authenticated),
    // so the post-login assertion proves LOGIN — not the earlier register — established it.
    session.handle = null;

    // (a) Recorded + registered → `login` re-establishes the SAME stable identity (the
    // doc's "reuse it across sessions; do not register a second one").
    const ok = (await client.callTool({
      name: 'login',
      arguments: { handle: DEFAULT_HANDLE },
    })) as CallToolResult;
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as Record<string, unknown>).handle).toBe(
      DEFAULT_HANDLE,
    );
    expect(session.handle).toBe(DEFAULT_HANDLE);
    // login is claim-based (NFR7) — it appends NOTHING; the ledger still holds exactly
    // the one registration. (This is the basis for the doc's "no secret, the handle is
    // the credential" claim being executable, not just stated.)
    expect(await registeredCount(DEFAULT_HANDLE)).toBe(1);

    // (b) Recorded but NEVER registered (e.g. a fresh/reset DB) → `login` returns
    // LOGIN_UNKNOWN, which is precisely the trigger for the doc's register-and-record
    // fall-through. A failed login must not establish a session.
    session.handle = null;
    const unknown = (await client.callTool({
      name: 'login',
      arguments: { handle: 'ghost@taskflow' },
    })) as CallToolResult;
    expect(unknown.isError).toBe(true);
    expect(readErrorPayload(unknown)).toMatchObject({ code: 'LOGIN_UNKNOWN' });
    expect(session.handle).toBeNull();
    // The fall-through is genuinely available: re-registering the SAME recorded handle
    // after a LOGIN_UNKNOWN succeeds (the doc's "reuse the recorded handle" path), so a
    // recorded-but-unregistered handle is not a dead end.
    const recovered = (await client.callTool({
      name: 'register',
      arguments: {
        handle: 'ghost@taskflow',
        current_focus: 'recovered after LOGIN_UNKNOWN',
      },
    })) as CallToolResult;
    expect(recovered.isError).toBeFalsy();
    expect(
      (recovered.structuredContent as Record<string, unknown>).handle,
    ).toBe('ghost@taskflow');
    expect(session.handle).toBe('ghost@taskflow');
  });
});

describe('identity-bootstrap Step 5 — announce-or-join sub-board EXECUTION proof against live announce_project/join_board (Story 12.2)', () => {
  it('Step 5 (first agent): register → announce_project creates the sub-board with the agent as first member (AC #1/#2)', async () => {
    // The workflow's Step 5 first-agent branch: after establishing identity, announce THIS project as
    // a sub-board. This proves the announce-or-join move is EXECUTABLE against the live tools — the
    // derived project_id (`taskflow`) is the slug of the chosen title (`Taskflow`), matching the
    // handle's `@taskflow` scope (AR10 / AC #2), and the announcer becomes the board's first member.
    const { client, session } = await connect();

    // Establish identity first (bootstrap Steps 1–4) — Step 5 presupposes an identity.
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'starting taskflow' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();
    expect(session.handle).toBe(DEFAULT_HANDLE);

    // Step 5: announce_project with a title whose slug equals the derived project_id.
    const announced = (await client.callTool({
      name: 'announce_project',
      arguments: {
        title: PROJECT_TITLE,
        description: 'Taskflow — a task system. Integrate via its REST API.',
      },
    })) as CallToolResult;
    expect(announced.isError).toBeFalsy();
    const sc = announced.structuredContent as Record<string, unknown>;
    // AR10 / AC #2 — the THREE-WAY consistency, bound to core's REAL slug rule (not just the hardcoded
    // constant): the board-derived project_id === coreSlug(title) === the handle's `@<project>` scope.
    // Asserting against `coreSlug(PROJECT_TITLE)` (the mirror of slug.ts) rather than the literal
    // `PROJECT_ID` means a slug-rule drift that changed how the LIVE tool derives the id would surface
    // here as `sc.project_id !== coreSlug(title)`, not pass against a stale constant.
    const derivedId = coreSlug(PROJECT_TITLE);
    expect(derivedId).toBe(PROJECT_ID); // the title slugs to the expected id under core's rule
    expect(sc.project_id).toBe(derivedId); // the LIVE tool derived the same id
    expect(DEFAULT_HANDLE.endsWith(`@${derivedId}`)).toBe(true); // and the handle's @<project> agrees
    expect(sc.members).toEqual([DEFAULT_HANDLE]);

    // Out-of-band: the directory shows exactly one sub-board for this id, announcer is a member.
    const proj = await readProject(client, PROJECT_ID);
    expect(proj?.members).toContain(DEFAULT_HANDLE);
    expect(await announcedCount(PROJECT_ID)).toBe(1);
  });

  it('Step 5 (second session, SAME agent): re-running hits PROJECT_EXISTS → join_board is an idempotent no-op — no dup, no error (AC #3)', async () => {
    // The workflow's idempotent re-run: a second SESSION of the same agent re-runs Step 5. The
    // announce_project returns PROJECT_EXISTS (the sub-board already exists), and the join_board
    // fallback is a harmless no-op. Proves AC #3 "no duplicate announcement, no error" for the
    // same-agent re-run path.
    const { client, session } = await connect();
    const reg = (await client.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'starting taskflow' },
    })) as CallToolResult;
    expect(reg.isError).toBeFalsy();

    // First run announces the board.
    const first = (await client.callTool({
      name: 'announce_project',
      arguments: { title: PROJECT_TITLE, description: 'first announcement' },
    })) as CallToolResult;
    expect(first.isError).toBeFalsy();
    expect(await announcedCount(PROJECT_ID)).toBe(1);

    // Simulate a fresh session of the same agent re-running Step 5 (identity re-established).
    session.handle = DEFAULT_HANDLE;

    // Re-run announce_project → PROJECT_EXISTS (the closed error the workflow branches on).
    const second = (await client.callTool({
      name: 'announce_project',
      arguments: { title: PROJECT_TITLE, description: 'second run' },
    })) as CallToolResult;
    expect(second.isError).toBe(true);
    expect(readErrorPayload(second)).toMatchObject({ code: 'PROJECT_EXISTS' });

    // The workflow's fallback on PROJECT_EXISTS: join_board the existing sub-board — a no-op re-join.
    const joined = (await client.callTool({
      name: 'join_board',
      arguments: { project_id: PROJECT_ID },
    })) as CallToolResult;
    expect(joined.isError).toBeFalsy();
    expect(
      (joined.structuredContent as Record<string, unknown>).members,
    ).toEqual([DEFAULT_HANDLE]);

    // AC #3: still exactly ONE announcement and ONE sub-board record — the re-run did not duplicate.
    expect(await announcedCount(PROJECT_ID)).toBe(1);
    // EXACTLY ONE directory record (not just one announcement event): the `.filter().length` is the
    // non-hiding form — `readProject`'s `.find` would mask a second same-id record. (Lead AC3 tighten.)
    expect(await projectRecordCount(client, PROJECT_ID)).toBe(1);
    const proj = await readProject(client, PROJECT_ID);
    expect(proj?.members).toEqual([DEFAULT_HANDLE]);
  });

  it('Step 5 (SECOND agent, same repo): derives the same project_id → PROJECT_EXISTS → join_board → becomes a member, no dup (AC #3)', async () => {
    // The workflow's cross-agent idempotency: a DIFFERENT agent onboarding in the same repo derives
    // the SAME project_id, tries announce_project, gets PROJECT_EXISTS, and join_boards — ending up a
    // member of the existing sub-board with NO duplicate announcement. This is the AC #3 "second agent"
    // path: peers on the same project converge on one sub-board, operator sees no error.
    const { client: clientA } = await connect();
    const regA = (await clientA.callTool({
      name: 'register',
      arguments: { handle: DEFAULT_HANDLE, current_focus: 'agent A' },
    })) as CallToolResult;
    expect(regA.isError).toBeFalsy();
    const announced = (await clientA.callTool({
      name: 'announce_project',
      arguments: { title: PROJECT_TITLE, description: 'agent A announces' },
    })) as CallToolResult;
    expect(announced.isError).toBeFalsy();

    // A SECOND agent (distinct handle, distinct session/connection) onboards on the SAME repo.
    const { client: clientB } = await connect();
    const secondHandle = `winston-arch@${PROJECT_ID}`;
    const regB = (await clientB.callTool({
      name: 'register',
      arguments: { handle: secondHandle, current_focus: 'agent B' },
    })) as CallToolResult;
    expect(regB.isError).toBeFalsy();

    // Agent B derives the same project_id and tries to announce → PROJECT_EXISTS.
    const collision = (await clientB.callTool({
      name: 'announce_project',
      arguments: { title: PROJECT_TITLE, description: 'agent B announces' },
    })) as CallToolResult;
    expect(collision.isError).toBe(true);
    expect(readErrorPayload(collision)).toMatchObject({
      code: 'PROJECT_EXISTS',
    });

    // Agent B's fallback: join_board → becomes a member of the existing sub-board.
    const joined = (await clientB.callTool({
      name: 'join_board',
      arguments: { project_id: PROJECT_ID },
    })) as CallToolResult;
    expect(joined.isError).toBeFalsy();

    // AC #3: exactly ONE announcement / ONE sub-board record; BOTH agents are members; no dup.
    expect(await announcedCount(PROJECT_ID)).toBe(1);
    // EXACTLY ONE directory record for the id — the second agent converged onto the SAME sub-board,
    // it did not create a parallel one (the non-hiding `.filter().length`, not `.find`). Lead AC3.
    expect(await projectRecordCount(clientB, PROJECT_ID)).toBe(1);
    const proj = await readProject(clientB, PROJECT_ID);
    expect(proj?.members).toContain(DEFAULT_HANDLE);
    expect(proj?.members).toContain(secondHandle);
    expect(proj?.members).toHaveLength(2);
  });
});
