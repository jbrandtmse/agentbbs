// Integration AC #6 (Story 4.6, Task 3) — REAL-RUNTIME evidence (skill-rules Rule 1 + 3).
//
// The per-(identity, room) JOIN-CURSOR projection (core: `roomJoinSeq` + `roomMessagesSince`) is
// exercised against the REAL `createDataAccess` (better-sqlite3 behind the NFR2 seam) over a
// genuine SQLite file in an OS temp dir. NOTHING is mocked: core's `register` / `announceProject` /
// `postAnnouncement` / `reply` / `addParticipant` ops drive the REAL ledger, and the join-cursor
// projection folds the events those ops actually appended.
//
// This story introduces the join-cursor PRODUCER with NO Epic-4 consumer — the first consumer is
// Story 6.1 (`check`), per the Rule 1 escape clause. So the binding real-runtime proof is the
// projection over the real ledger (NOT an MCP-client round-trip — there is no new MCP tool). It
// asserts the AC #6 outcomes:
//   - a new identity who JOINS BY REPLYING mid-stream has `roomJoinSeq` == their `room.replied`
//     `seq` (the ledger position at the instant of join), and `roomMessagesSince(roomId, cursor)`
//     returns ONLY the post-join messages — the pre-join back-history (the seeding announcement +
//     the replies before they joined) is EXCLUDED (no flood), and their OWN join message is
//     excluded too (strict `>`), while every LATER participant's message is included;
//   - a new identity who JOINS BY BEING ADDED (`add_participant`) mid-stream has `roomJoinSeq` ==
//     the `room.participant_added` `seq`, with the same back-history-excluded delta;
//   - a participant ADDED then later REPLYING floors at the EARLIEST (the add) — the moment they
//     FIRST became a participant (AC #4) — over the real ledger;
//   - a NON-participant (the announcer who never replied; a registered bystander) → `undefined`
//     (AC #5), so `check` (6.1) would not surface that room to them at all;
//   - `read_room`'s full history (the `roomMessages` fold) is NEVER cursor-scoped — the complete
//     ordered history is available on demand regardless of any join cursor (AC #2).
//
// This test lives in data-access (not core) because it needs BOTH @agentbbs/core (the ops + the
// projection) AND the real better-sqlite3-backed `createDataAccess` — and core's lint forbids it
// from importing the storage adapter. data-access already depends on both. As of Story 3.0, the
// root vitest `resolve.alias` maps @agentbbs/core to its src/index.ts, so core resolves from live
// TS source — no prior `pnpm run build` is required for this in-process cross-package suite.
//
// Never touches the repo's real `.agentbbs/`: every DB lives under os.tmpdir().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addParticipant,
  announceProject,
  postAnnouncement,
  register,
  reply,
  roomJoinSeq,
  roomMessages,
  roomMessagesSince,
} from '@agentbbs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataAccess } from './data-access.js';

import type { DataAccessHandle } from './data-access.js';
import type { Event } from '@agentbbs/core';

let dir: string;
let dbPath: string;
let da: DataAccessHandle | undefined;

/** The full `seq`-ordered ledger (every type) — the input the pure projections fold. */
async function ledger(): Promise<Event[]> {
  return da!.eventsSince(0);
}

/** The `seq` of `actor`'s earliest `room.replied` for `roomId` over the real ledger. */
async function firstReplySeq(
  roomId: string,
  actor: string,
): Promise<number | undefined> {
  const replies = (await da!.eventsByActor(actor))
    .filter((e) => e.type === 'room.replied' && e.payload.roomId === roomId)
    .sort((a, b) => a.seq - b.seq);
  return replies[0]?.seq;
}

/** The `seq` of the `room.participant_added` that named `handle` for `roomId` (real ledger). */
async function addedSeq(
  roomId: string,
  handle: string,
): Promise<number | undefined> {
  const adds = (await da!.eventsByType('room.participant_added'))
    .filter(
      (e) =>
        e.type === 'room.participant_added' &&
        e.payload.roomId === roomId &&
        e.payload.handle === handle,
    )
    .sort((a, b) => a.seq - b.seq);
  return adds[0]?.seq;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentbbs-join-cursor-int-'));
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

describe('roomJoinSeq / roomMessagesSince over a real createDataAccess ledger (Story 4.6, AC #6)', () => {
  it('a NEW identity that joins by REPLYING mid-stream floors at their reply seq; the pre-join back-history is EXCLUDED (no flood)', async () => {
    // Build a room with REAL existing history: ada announces a board + posts an announcement
    // (proto-room), ada replies (activates it), bob replies — all BEFORE dave arrives.
    await register(da!, { handle: 'ada', currentFocus: 'shipping 4.6' });
    const project = await announceProject(da!, 'ada', {
      title: 'Calling Interface',
      description: 'design the calling interface',
    });
    const room = await postAnnouncement(da!, 'ada', {
      projectId: project.projectId,
      subject: 'Calling Interface',
      body: 'we need to agree the calling interface',
    });
    const roomId = room.roomId;

    await reply(da!, 'ada', { roomId, body: 'kicking off' }); // activates the room
    await register(da!, { handle: 'bob', currentFocus: 'helping' });
    await reply(da!, 'bob', { roomId, body: 'bob here, some context' });

    // The room now has existing history: [announcement, ada-reply, bob-reply]. Snapshot the
    // pre-join message seqs so we can assert dave does NOT receive them.
    const preJoin = roomMessages(await ledger(), roomId);
    expect(preJoin.map((m) => m.kind)).toEqual([
      'announcement',
      'reply',
      'reply',
    ]);
    const preJoinSeqs = preJoin.map((m) => m.seq);

    // dave (a brand-new identity) joins mid-stream by REPLYING — this is the instant of join.
    await register(da!, { handle: 'dave', currentFocus: 'joining late' });
    await reply(da!, 'dave', { roomId, body: 'dave joining now' });
    // ... and AFTER dave joins, a later participant posts (this MUST be "new for me" to dave).
    await reply(da!, 'bob', { roomId, body: 'reply after dave joined' });

    const events = await ledger();

    // AC #6 / AC #1: dave's join cursor == the seq of their joining `room.replied` (== the
    // current ledger position at the instant of join, since the join event is newest at append).
    const cursor = roomJoinSeq(events, roomId, 'dave');
    expect(cursor).toBeDefined();
    expect(cursor).toBe(await firstReplySeq(roomId, 'dave'));

    // AC #6 / AC #2 / AC #3: "new for me in this room" = roomMessages filtered seq > cursor.
    const newForDave = roomMessagesSince(events, roomId, cursor ?? 0);
    // The pre-join back-history (announcement + ada/bob replies before dave) is EXCLUDED.
    for (const s of preJoinSeqs) {
      expect(newForDave.some((m) => m.seq === s)).toBe(false);
    }
    // dave's OWN join message is NOT re-surfaced (strict `>`).
    expect(newForDave.some((m) => m.seq === cursor)).toBe(false);
    // ONLY the post-join message (bob's reply after dave joined) is new.
    expect(newForDave.map((m) => m.body)).toEqual(['reply after dave joined']);

    // AC #2: the FULL history remains available on demand (read_room is never cursor-scoped) —
    // dave can still see all 5 messages via roomMessages, even though only 1 is "new".
    expect(roomMessages(events, roomId)).toHaveLength(5);
  });

  it('a NEW identity that joins by being ADDED mid-stream floors at the participant_added seq; back-history EXCLUDED', async () => {
    // ada announces + posts; ada replies (activates); bob replies → bob is a participant who can
    // add a peer. All before erin is pulled in.
    await register(da!, { handle: 'ada', currentFocus: 'f' });
    const project = await announceProject(da!, 'ada', {
      title: 'Pull A Peer',
      description: 'pull a peer into the room',
    });
    const room = await postAnnouncement(da!, 'ada', {
      projectId: project.projectId,
      subject: 'Pull A Peer',
      body: 'need a peer',
    });
    const roomId = room.roomId;
    await reply(da!, 'ada', { roomId, body: 'activating' });
    await register(da!, { handle: 'bob', currentFocus: 'f' });
    await reply(da!, 'bob', { roomId, body: 'bob context' });

    const preJoinSeqs = roomMessages(await ledger(), roomId).map((m) => m.seq);
    expect(preJoinSeqs).toHaveLength(3); // announcement + 2 replies

    // erin is REGISTERED then bob (a participant) PULLS her in via add_participant — her join.
    await register(da!, { handle: 'erin', currentFocus: 'pulled in' });
    await addParticipant(da!, 'bob', { roomId, handle: 'erin' });
    // A later reply after erin's add must be "new for me" to erin.
    await reply(da!, 'ada', { roomId, body: 'reply after erin added' });

    const events = await ledger();

    // erin's cursor == the seq of the room.participant_added that named her.
    const cursor = roomJoinSeq(events, roomId, 'erin');
    expect(cursor).toBeDefined();
    expect(cursor).toBe(await addedSeq(roomId, 'erin'));

    const newForErin = roomMessagesSince(events, roomId, cursor ?? 0);
    // Pre-join back-history excluded.
    for (const s of preJoinSeqs) {
      expect(newForErin.some((m) => m.seq === s)).toBe(false);
    }
    // erin never authored a message (she was added, not a replier), so nothing of hers is in the
    // history; the only "new" message is the post-add reply.
    expect(newForErin.map((m) => m.body)).toEqual(['reply after erin added']);
    // Full history still available on demand (announcement + 2 pre + 1 post = 4 messages).
    expect(roomMessages(events, roomId)).toHaveLength(4);
  });

  it('an ADDED-then-REPLYING participant floors at the EARLIEST (the add) over the real ledger (AC #4)', async () => {
    await register(da!, { handle: 'ada', currentFocus: 'f' });
    const project = await announceProject(da!, 'ada', {
      title: 'Earliest Wins',
      description: 'earliest participating event wins',
    });
    const room = await postAnnouncement(da!, 'ada', {
      projectId: project.projectId,
      subject: 'Earliest Wins',
      body: 'need agreement',
    });
    const roomId = room.roomId;
    await reply(da!, 'ada', { roomId, body: 'activating' });

    // cleo is ADDED first, then LATER replies. Her floor must be the ADD seq, not the reply seq.
    await register(da!, { handle: 'cleo', currentFocus: 'f' });
    await addParticipant(da!, 'ada', { roomId, handle: 'cleo' });
    const addSeq = await addedSeq(roomId, 'cleo');
    await reply(da!, 'cleo', {
      roomId,
      body: 'cleo replying after being added',
    });
    const cleoReplySeq = await firstReplySeq(roomId, 'cleo');

    // Sanity: the add genuinely precedes the reply in the real ledger.
    expect(addSeq).toBeDefined();
    expect(cleoReplySeq).toBeDefined();
    expect((addSeq ?? 0) < (cleoReplySeq ?? 0)).toBe(true);

    // The floor is the EARLIEST participating event — the add.
    expect(roomJoinSeq(await ledger(), roomId, 'cleo')).toBe(addSeq);
  });

  it('a NON-participant (announcer-who-never-replied; registered bystander) has NO join cursor → undefined (AC #5)', async () => {
    await register(da!, { handle: 'ada', currentFocus: 'f' });
    const project = await announceProject(da!, 'ada', {
      title: 'No Cursor For Non Participants',
      description: 'non-participants have no floor',
    });
    const room = await postAnnouncement(da!, 'ada', {
      projectId: project.projectId,
      subject: 'No Cursor For Non Participants',
      body: 'a need',
    });
    const roomId = room.roomId;
    // bob replies (activates + becomes the sole participant). ada only ANNOUNCED — never replied.
    await register(da!, { handle: 'bob', currentFocus: 'f' });
    await reply(da!, 'bob', { roomId, body: 'on it' });
    // A registered bystander who never touches the room.
    await register(da!, { handle: 'zoe', currentFocus: 'elsewhere' });

    const events = await ledger();
    // The announcer-who-never-replied is NOT a participant → no floor.
    expect(roomJoinSeq(events, roomId, 'ada')).toBeUndefined();
    // A registered bystander is NOT a participant → no floor.
    expect(roomJoinSeq(events, roomId, 'zoe')).toBeUndefined();
    // bob (the replier) DOES have a floor — sanity that the projection is live, not always-undefined.
    expect(roomJoinSeq(events, roomId, 'bob')).toBe(
      await firstReplySeq(roomId, 'bob'),
    );
  });

  // QA-added (Story 4.6 — de-risks the Story 6.1 `check` integration). The join cursor is HALF of
  // what 6.1 applies: `check` returns, per room, messages with `seq > max(perIdentityCheckCursor,
  // roomJoinSeq)` — the per-room FLOOR (this story) combined with the stored per-identity
  // high-water-mark (6.1). The dev's suite exercises `roomMessagesSince` with the join cursor
  // ALONE; nothing proves the COMBINATION (the docblock's `max(...)` appears only as prose). This
  // test composes BOTH helpers off the REAL ledger exactly as 6.1 will — in BOTH `max` directions —
  // so 6.1's integration inherits a proven floor-composition primitive (the `max` itself is 6.1's
  // one line; everything it feeds on is verified here).
  it('combines with a hypothetical check-cursor as seq > max(checkCursor, joinSeq): the HIGHER bound wins in BOTH directions (Story 6.1 preview)', async () => {
    // Real room with history, then a late joiner + several post-join messages so there is a
    // genuine gap between "joined here" and "already read up to there".
    await register(da!, { handle: 'ada', currentFocus: 'f' });
    const project = await announceProject(da!, 'ada', {
      title: 'Combined Floor',
      description: 'join floor combined with the check high-water-mark',
    });
    const room = await postAnnouncement(da!, 'ada', {
      projectId: project.projectId,
      subject: 'Combined Floor',
      body: 'the need',
    });
    const roomId = room.roomId;
    await reply(da!, 'ada', { roomId, body: 'kickoff' }); // activates
    await register(da!, { handle: 'bob', currentFocus: 'f' });
    await reply(da!, 'bob', { roomId, body: 'bob pre-join context' });

    // dave joins by replying (mid-stream), then THREE later messages land.
    await register(da!, { handle: 'dave', currentFocus: 'late' });
    await reply(da!, 'dave', { roomId, body: 'dave joining' });
    await reply(da!, 'ada', { roomId, body: 'post-join 1' });
    await reply(da!, 'bob', { roomId, body: 'post-join 2' });
    await reply(da!, 'ada', { roomId, body: 'post-join 3' });

    const events = await ledger();
    const joinSeq = roomJoinSeq(events, roomId, 'dave');
    expect(joinSeq).toBeDefined();
    const all = roomMessages(events, roomId).map((m) => m.seq);
    // Layout sanity: [announce, ada, bob, dave(join), post1, post2, post3] = 7 messages, dave's
    // join is the 4th, leaving exactly 3 post-join messages.
    expect(all).toHaveLength(7);
    const postJoin = all.filter((s) => s > (joinSeq ?? 0));
    expect(postJoin).toHaveLength(3);

    // The combined floor 6.1 applies. Pure one-liner mirroring the docblock; the helpers under it
    // are what this proves.
    const combinedSince = (checkCursor: number): number[] =>
      roomMessagesSince(
        events,
        roomId,
        Math.max(checkCursor, joinSeq ?? 0),
      ).map((m) => m.seq);

    // (a) checkCursor BELOW the join seq (a fresh joiner who never `check`ed this room, or whose
    //     stored cursor predates it): the JOIN floor wins → no back-history flood, all 3 post-join
    //     messages are new, the pre-join history and dave's own join are excluded.
    expect(combinedSince(0)).toEqual(postJoin);
    expect(combinedSince((joinSeq ?? 0) - 1)).toEqual(postJoin);
    // The join seq itself as the check cursor: max == joinSeq, still the 3 post-join messages.
    expect(combinedSince(joinSeq ?? 0)).toEqual(postJoin);

    // (b) checkCursor ABOVE the join seq (dave already `check`ed and read PAST his join — say up to
    //     the first post-join message): the CHECK high-water-mark wins → the already-seen messages
    //     do NOT re-show; only what is newer than the check cursor remains.
    const seenUpTo = postJoin[0]; // dave has seen through the first post-join message
    expect(combinedSince(seenUpTo)).toEqual(postJoin.slice(1)); // only post-join 2 & 3
    // Having read EVERYTHING (check cursor at the latest seq) → nothing new, even though dave is a
    // participant with a valid join floor.
    expect(combinedSince(all[all.length - 1])).toEqual([]);

    // Neither bound alone is sufficient — the `max` is load-bearing: the join floor alone would
    // RE-SHOW the already-seen post-join-1 in case (b); the check cursor alone (0 here) would FLOOD
    // the pre-join back-history in case (a). The combination does neither.
    expect(
      roomMessagesSince(events, roomId, joinSeq ?? 0).map((m) => m.seq),
    ).toEqual(postJoin); // join-only: would re-show post-join-1 if dave had already seen it
    expect(roomMessagesSince(events, roomId, 0).map((m) => m.seq)).toEqual(all); // check-only(0): floods all back-history
  });
});
