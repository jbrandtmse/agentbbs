// AC3 — the Story 9.3 Integration AC (skill-rules Rule 1 + Rule 3): REAL-RUNTIME
// evidence over the whole stack, NOTHING mocked. A real on-demand host (`startHost`)
// is bound to a REAL `createDataAccess` better-sqlite3 ledger in an OS temp dir, and a
// real HTTP client (`fetch`) talks to it over a real bound port. The wire, the host,
// the JSON API, the SSE channel, core's read/write ops, and the SQLite ledger are ALL
// real.
//
// It proves the two load-bearing paths the story is about:
//   (a) UI → JSON-API → core → data-access: seed board state via core write ops, GET
//       the JSON API over real HTTP, assert the response carries the real seeded state;
//   (b) MAX(seq)-poll → SSE push: open an SSE connection (a raw HTTP stream — Node 24 has
//       NO global EventSource, verified, so the test reads `text/event-stream` frames
//       directly), append a NEW event out-of-band via a core write (simulating another
//       client), and assert the SSE client receives a delta frame carrying that event's
//       `seq` within a bounded time.
// The host + DB are torn down cleanly. The web client (apps/web) is the consumer this
// test stands in for (it speaks the same JSON API + SSE — proven separately in its own
// DOM render test).
//
// Never touches the repo's real `.agentbbs/`: the DB lives under os.tmpdir(), and the
// host's web-dist is pointed at a throwaway temp dir (the integration proves the API +
// SSE, not static serving — that has its own unit test).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  announceProject,
  MAX_BODY_BYTES,
  postAnnouncement,
  register,
  reply,
} from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_REQUEST_BODY_BYTES, startHost } from './server.js';

import type { RunningHost } from './server.js';
import type { DataAccessHandle } from '@agentbbs/data-access';

let dir: string;
let dataAccess: DataAccessHandle | undefined;
let host: RunningHost | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-host-'));
  const dbPath = join(dir, 'agentbbs.db');
  dataAccess = createDataAccess({ dbPath });
});

afterEach(async () => {
  if (host !== undefined) {
    await host.close();
    host = undefined;
  }
  if (dataAccess !== undefined) {
    dataAccess.close();
    dataAccess = undefined;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Read SSE frames from a raw fetch stream until `predicate` is satisfied or timeout. */
async function readSseUntil(
  response: Response,
  predicate: (frames: string[]) => boolean,
  timeoutMs = 4000,
): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ value: undefined; done: true }>(
        (resolvePromise) =>
          setTimeout(
            () => resolvePromise({ value: undefined, done: true }),
            Math.max(0, deadline - Date.now()),
          ),
      );
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        frames.push(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');
      }
      if (predicate(frames)) break;
    }
  } finally {
    void reader.cancel();
  }
  return frames;
}

describe('AC3 — on-demand host integration over the real stack', () => {
  it('(a) GET /api/directory returns real seeded board state over HTTP', async () => {
    // Seed REAL board state via core write ops against the real ledger.
    await register(dataAccess!, {
      handle: 'alice',
      currentFocus: 'wiring 9.3',
    });
    await announceProject(dataAccess!, 'alice', {
      title: 'Calling Interface',
      description: 'How agents dial in.',
    });

    host = await startHost({ dataAccess: dataAccess!, webDist: dir });

    const response = await fetch(`${host.url}/api/directory`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projects: { project_id: string; title: string; announcer: string }[];
    };
    // The response carries the REAL ledger-derived directory (NOT mocked).
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      project_id: 'calling-interface',
      title: 'Calling Interface',
      announcer: 'alice',
    });
  });

  it('(a) GET an unknown room returns 404 with the closed ROOM_NOT_FOUND code', async () => {
    host = await startHost({ dataAccess: dataAccess!, webDist: dir });
    const response = await fetch(`${host.url}/api/rooms/no-such-room`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe('ROOM_NOT_FOUND');
  });

  it('(b) SSE delivers a delta carrying the seq of an out-of-band core write', async () => {
    // Seed a board + a member so we have somewhere to post an out-of-band event.
    await register(dataAccess!, { handle: 'bob', currentFocus: 'init' });
    await announceProject(dataAccess!, 'bob', {
      title: 'Room Host',
      description: 'For the SSE proof.',
    });

    // A short poll interval keeps the test fast (the poller detects maxSeq advance).
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      ssePollIntervalMs: 25,
    });

    // Open the SSE channel as a raw HTTP stream (Node 24 has no global EventSource).
    const sseResponse = await fetch(`${host.url}/api/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain(
      'text/event-stream',
    );

    // Give the poller one tick to seed its high-water-mark to the current maxSeq, so
    // the post below is detected as a NEW advance (not part of the seed).
    await new Promise((r) => setTimeout(r, 80));

    // Append a NEW event OUT-OF-BAND via a core write (simulating another client).
    const room = await postAnnouncement(dataAccess!, 'bob', {
      projectId: 'room-host',
      subject: 'Live delta please',
      body: 'This announcement should arrive over SSE.',
    });

    // Assert the SSE client receives a delta frame carrying that new event's seq.
    const frames = await readSseUntil(sseResponse, (collected) =>
      collected.some((f) => f.includes(`"seq":${room.seq}`)),
    );
    const dataFrames = frames
      .flatMap((f) => f.split('\n'))
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length));

    const deltaSeqs = dataFrames
      .map((d) => {
        try {
          return (JSON.parse(d) as { seq?: number }).seq;
        } catch {
          return undefined;
        }
      })
      .filter((s): s is number => typeof s === 'number');

    expect(deltaSeqs).toContain(room.seq);
    // The delta also carries the snake_case event shape (the wire contract).
    const matching = dataFrames
      .map((d) => {
        try {
          return JSON.parse(d) as { seq: number; type: string };
        } catch {
          return undefined;
        }
      })
      .find((e) => e?.seq === room.seq);
    expect(matching?.type).toBe('announcement.posted');
  });
});

// --- Story 9.7: the BODY-carrying WRITE path over REAL HTTP — proves `server.ts` parses +
// size-bounds the request stream (Node 24 async-iteration body parse) and the operator
// posts as a peer over the SAME core `reply` agents use. The unit tests
// (json-api.test.ts) call handleApiRequest with a parsed-object body directly; THIS test
// drives the whole real `node:http` body-read path with a real `fetch` POST + JSON body. ---
describe('Story 9.7 — body-carrying reply write over real HTTP (Mode B, same-core)', () => {
  /** Seed a board + an active room (alice announces + replies) and return the room id. */
  async function seedActiveRoom(): Promise<string> {
    await register(dataAccess!, { handle: 'alice', currentFocus: 'wiring' });
    await register(dataAccess!, { handle: 'ops', currentFocus: 'watching' });
    await announceProject(dataAccess!, 'alice', {
      title: 'Calling Interface',
      description: 'How agents dial in.',
    });
    const room = await postAnnouncement(dataAccess!, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a decision',
      body: 'announcement body',
    });
    await reply(dataAccess!, 'alice', {
      roomId: room.roomId,
      body: 'starting',
    });
    return room.roomId;
  }

  it('POST /api/rooms/:id/reply with a JSON body posts the operator message + grants room participation', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });

    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Ship it — operator decision.' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      room: { room_id: string; active: boolean };
    };
    expect(body.room.room_id).toBe(roomId);
    expect(body.room.active).toBe(true);

    // The operator is now a ROOM PARTICIPANT + their message is in the thread (real HTTP read).
    const roomRes = await fetch(`${host.url}/api/rooms/${roomId}`);
    const roomBody = (await roomRes.json()) as {
      participants: string[];
      messages: { actor: string; body: string }[];
    };
    expect(roomBody.participants).toContain('ops');
    expect(
      roomBody.messages.some(
        (m) => m.actor === 'ops' && m.body === 'Ship it — operator decision.',
      ),
    ).toBe(true);
  });

  it('POST /api/rooms/:id/reply with NO operator (watching-only host) → 403 NO_OPERATOR', async () => {
    const roomId = await seedActiveRoom();
    // No operatorHandle → watching-only host.
    host = await startHost({ dataAccess: dataAccess!, webDist: dir });
    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'NO_OPERATOR',
    );
  });

  it('POST /api/rooms/:id/reply with an over-host-limit body → 413 BODY_TOO_LARGE (rejected before buffering it all)', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    // A body well over the host request-body ceiling (MAX_BODY_BYTES + slack). The host
    // rejects it with 413 from its stream bound (the core cap would also be 413).
    const huge = 'x'.repeat(MAX_BODY_BYTES + 200 * 1024);
    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: huge }),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { code: string }).code).toBe(
      'BODY_TOO_LARGE',
    );
  });

  it('POST /api/rooms/:id/reply with a malformed (non-JSON) body → 400 BAD_REQUEST', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json{',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'BAD_REQUEST',
    );
  });
});

// --- QA hardening (Story 9.7 qa stage) — the 413 BODY-cap EDGE over REAL HTTP. Two distinct
// rejection paths converge on 413 BODY_TOO_LARGE and the dev's host bound is the seam between
// them; the dev-shipped integration test only covers the way-over (host-surface) case. These
// pin the LOAD-BEARING boundary the dev's Completion Notes assert: the host request-body bound
// (MAX_REQUEST_BODY_BYTES = MAX_BODY_BYTES + 64 KB) is set ABOVE the core cap deliberately so a
// body OVER the CORE cap but UNDER the host bound REACHES core and is rejected with the CONTRACT
// BODY_TOO_LARGE (not a premature host truncation), while an at-core-cap body still POSTS (200).
// Plus the explicit no-ECONNRESET proof: the over-host-bound 413 must be a readable HTTP status
// (the dev noted replacing an early req.destroy() that caused ECONNRESET — verify the fix holds
// over a real socket). All over a real bound port + real SQLite (Rule 3). ---
describe('Story 9.7 qa — 413 body-cap boundary over real HTTP (no premature truncation, no ECONNRESET)', () => {
  async function seedActiveRoom(): Promise<string> {
    await register(dataAccess!, { handle: 'alice', currentFocus: 'wiring' });
    await register(dataAccess!, { handle: 'ops', currentFocus: 'watching' });
    await announceProject(dataAccess!, 'alice', {
      title: 'Calling Interface',
      description: 'How agents dial in.',
    });
    const room = await postAnnouncement(dataAccess!, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a decision',
      body: 'announcement body',
    });
    await reply(dataAccess!, 'alice', {
      roomId: room.roomId,
      body: 'starting',
    });
    return room.roomId;
  }

  /** The current MAX(seq) over the real ledger — to assert nothing landed on a rejection. */
  async function maxSeq(): Promise<number> {
    const events = await dataAccess!.eventsSince(0);
    return events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  it('a body EXACTLY at the core cap POSTS (200) — the host does NOT truncate an at-cap body', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    // An ASCII body of EXACTLY MAX_BODY_BYTES chars → byteLength === MAX_BODY_BYTES (core's cap
    // is `> MAX_BODY_BYTES`, so at-cap is accepted). The JSON envelope (`{"body":"…"}`) adds a
    // few bytes but stays well under the host bound (MAX_BODY_BYTES + 64 KB), so it reaches core.
    const atCap = 'a'.repeat(MAX_BODY_BYTES);
    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: atCap }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { room: { room_id: string } };
    expect(body.room.room_id).toBe(roomId);
    // The at-cap message actually landed in the thread (real read-back).
    const roomRes = await fetch(`${host.url}/api/rooms/${roomId}`);
    const roomBody = (await roomRes.json()) as {
      messages: { actor: string; body: string }[];
    };
    expect(
      roomBody.messages.some(
        (m) => m.actor === 'ops' && m.body.length === MAX_BODY_BYTES,
      ),
    ).toBe(true);
  });

  it('a body OVER the core cap but UNDER the host bound REACHES core → the CONTRACT 413 BODY_TOO_LARGE (not a host truncation), nothing appended', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    const before = await maxSeq();
    // ONE byte over the CORE cap (MAX_BODY_BYTES + 1) — but well under the HOST request-body
    // bound (MAX_BODY_BYTES + 64 KB), so the host does NOT short-circuit; the whole body is
    // buffered + parsed + handed to core, and CORE's assertBodyWithinCap throws the contract
    // BODY_TOO_LARGE. This is the AC-faithful code (the host bound is set above the core cap
    // EXACTLY so this contract path fires rather than a premature host-surface 413).
    const overCoreCap = 'a'.repeat(MAX_BODY_BYTES + 1);
    // Confirm the test's own premise: this payload is under the host bound, so it must reach core.
    expect(JSON.stringify({ body: overCoreCap }).length).toBeLessThan(
      MAX_REQUEST_BODY_BYTES,
    );
    const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: overCoreCap }),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { code: string }).code).toBe(
      'BODY_TOO_LARGE',
    );
    // Core rejected before appending — the ledger high-water-mark is unchanged.
    expect(await maxSeq()).toBe(before);
  });

  it('a body OVER the host bound → 413 with a READABLE body (the host-surface reject does NOT ECONNRESET the socket)', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    const before = await maxSeq();
    // WELL over the host request-body bound → the host rejects from its stream guard BEFORE
    // fully buffering (it pauses the request + sends `Connection: close`). The dev noted an
    // early `req.destroy()` here caused ECONNRESET (the client never read the status); the fix
    // must let the client RELIABLY read the 413 JSON. If the socket were reset, `fetch` or
    // `.json()` would REJECT (TypeError: fetch failed / terminated) instead of resolving — so
    // a clean `.json()` IS the no-ECONNRESET proof.
    const overHostBound = 'a'.repeat(MAX_REQUEST_BODY_BYTES + 4096);
    let parsed: { code: string } | undefined;
    let threw: unknown;
    try {
      const response = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: overHostBound }),
      });
      expect(response.status).toBe(413);
      parsed = (await response.json()) as { code: string };
    } catch (err: unknown) {
      threw = err;
    }
    // No socket reset: the request resolved AND the JSON body parsed cleanly.
    expect(threw).toBeUndefined();
    expect(parsed?.code).toBe('BODY_TOO_LARGE');
    // Nothing landed (the oversize body never reached a core append).
    expect(await maxSeq()).toBe(before);
  });
});

// --- QA hardening (Story 9.7 qa stage) — the add_participant GATE over REAL HTTP. The
// dev-shipped integration coverage drives the reply body-parse path; add_participant is the
// OTHER body-carrying write and its participant gate / NO_OPERATOR gate are only exercised at
// the unit layer (handleApiRequest with an object body). These prove the gate over the whole
// real node:http body-parse → core path: a watching host → 403 NO_OPERATOR; a known operator
// who has NOT yet posted → 403 NOT_A_MEMBER (nothing appended); AFTER the operator replies
// (grant-on-act participant) → the target is actually added (real read-back). Rule 3. ---
describe('Story 9.7 qa — add_participant gate over real HTTP (NO_OPERATOR / NOT_A_MEMBER / granted-after-reply)', () => {
  async function seedActiveRoom(): Promise<string> {
    await register(dataAccess!, { handle: 'alice', currentFocus: 'wiring' });
    await register(dataAccess!, { handle: 'ops', currentFocus: 'watching' });
    await register(dataAccess!, { handle: 'cleo', currentFocus: 'reviewing' });
    await announceProject(dataAccess!, 'alice', {
      title: 'Calling Interface',
      description: 'How agents dial in.',
    });
    const room = await postAnnouncement(dataAccess!, 'alice', {
      projectId: 'calling-interface',
      subject: 'Need a decision',
      body: 'announcement body',
    });
    await reply(dataAccess!, 'alice', {
      roomId: room.roomId,
      body: 'starting',
    });
    return room.roomId;
  }

  async function maxSeq(): Promise<number> {
    const events = await dataAccess!.eventsSince(0);
    return events.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  it('a WATCHING host (no operator) add_participant → 403 NO_OPERATOR, nothing appended', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({ dataAccess: dataAccess!, webDist: dir });
    const before = await maxSeq();
    const response = await fetch(
      `${host.url}/api/rooms/${roomId}/participants`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'cleo' }),
      },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'NO_OPERATOR',
    );
    expect(await maxSeq()).toBe(before);
  });

  it('an operator add_participant BEFORE they are a participant → 403 NOT_A_MEMBER, nothing appended', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    const before = await maxSeq();
    // ops has NOT replied → it is not a ROOM PARTICIPANT → the core gate rejects.
    const response = await fetch(
      `${host.url}/api/rooms/${roomId}/participants`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'cleo' }),
      },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'NOT_A_MEMBER',
    );
    expect(await maxSeq()).toBe(before);
  });

  it('AFTER the operator replies (now a participant) add_participant → 200, the target is actually added (real read-back)', async () => {
    const roomId = await seedActiveRoom();
    host = await startHost({
      dataAccess: dataAccess!,
      webDist: dir,
      operatorHandle: 'ops',
    });
    // 1. ops replies → grant-on-act makes it a ROOM PARTICIPANT, so the gate now passes.
    const replyRes = await fetch(`${host.url}/api/rooms/${roomId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'pulling cleo in' }),
    });
    expect(replyRes.status).toBe(200);
    // 2. Now ops pulls cleo in.
    const addRes = await fetch(`${host.url}/api/rooms/${roomId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'cleo' }),
    });
    expect(addRes.status).toBe(200);
    const addBody = (await addRes.json()) as { participants: string[] };
    expect(addBody.participants).toContain('cleo');
    expect(addBody.participants).toContain('ops');
    // Real read-back: cleo is a participant of the room (a pulled-in peer with no message).
    const roomRes = await fetch(`${host.url}/api/rooms/${roomId}`);
    const roomBody = (await roomRes.json()) as {
      participants: string[];
      messages: { actor: string }[];
    };
    expect(roomBody.participants).toContain('cleo');
    expect(roomBody.messages.some((m) => m.actor === 'cleo')).toBe(false);
  });
});
