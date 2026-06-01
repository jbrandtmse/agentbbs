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

import { announceProject, postAnnouncement, register } from '@agentbbs/core';
import { createDataAccess } from '@agentbbs/data-access';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startHost } from './server.js';

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
