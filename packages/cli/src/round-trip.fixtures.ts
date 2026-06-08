// Story 11.4 — shared, test-only fixtures for the canonical FR34 round-trip fidelity test.
//
// TEST-ONLY (no `.test.ts` suffix, so Vitest does NOT collect it as a suite — it is imported by
// `round-trip.fidelity.test.ts`). It changes NO production code (AC5): it only factors the
// Story-11.2/11.3 seed + the per-category derived-state snapshot into one canonical place so the
// fidelity test can compare source-vs-restored category by category.
//
// Two exports:
//   - `seedComprehensiveBoard(da)` — the comprehensive seed exercising ALL 10 `EVENT_TYPES` AND a
//     NON-ZERO stored read-state cursor AND a live contract (a 👍'd message). It is the broadened,
//     canonical version of the Story-11.2 `export.test.ts` / Story-11.3 `import.test.ts` seed.
//   - `deriveComparableState(da)` — reads EACH derived-state category (identities / membership /
//     rooms / messages / reactions / contracts / cursors) through the CORE PROJECTIONS (never a raw
//     row diff), returning a per-category plain object. Display-only `createdAt`/`lastSeen` are
//     EXCLUDED (see the WHY note on the return shape) — the Story-11.3 AC4 ratified carve-out.
//
// Plus `exportToText(dbPath)` — run the real export codec over a (closed) ledger to NDJSON text.

import {
  addParticipant,
  announceProject,
  check,
  currentContract,
  foldIdentities,
  foldProjects,
  foldRooms,
  liveReactors,
  listAnnouncements,
  listProjects,
  listRooms,
  postAnnouncement,
  react,
  reply,
  register,
  roomMessages,
  roomParticipants,
  unreact,
  updateFocus,
} from '@agentbbs/core';

import { runExport } from './export.js';

import type { DataAccessHandle } from '@agentbbs/data-access';

/** What {@link seedComprehensiveBoard} produces, for the tests that need the ids/cursor back. */
export interface SeededBoard {
  /** The announced project / sub-board id. */
  projectId: string;
  /** The activated room id (the proto-room bob's reply activated). */
  roomId: string;
  /** bob's NON-ZERO stored read-state cursor (a real `check` past his join floor). */
  bobCursor: number;
}

/**
 * Seed a comprehensive, representative board over the REAL ledger that exercises ALL 10
 * `EVENT_TYPES` AND guarantees a NON-ZERO stored read-state cursor AND a live contract — the
 * canonical FR34 source board (AC2). Broadens the Story-11.2/11.3 seed so the round-trip proves
 * fidelity across the WHOLE event vocabulary + the cursor carve-out, not a trivial subset.
 *
 *   identity.registered     — alice + bob + carol register
 *   identity.focus_updated  — alice updates her focus
 *   project.announced       — alice announces a project (alice auto-joins the sub-board)
 *   board.joined            — alice on announce; carol when bob pulls her in
 *   announcement.posted     — alice posts an announcement (a proto-room)
 *   room.replied            — bob (activates the room, auto-joins) + alice reply
 *   room.participant_added  — bob pulls carol into the room
 *   message.reacted         — alice 👍 bob's reply (THE LIVE CONTRACT) AND alice 👍 her own reply
 *   message.unreacted       — alice retracts the 👍 on her OWN reply (bob's stays live)
 *   identity.seen           — bob `check`s → ALSO stores his non-zero read-state cursor (AC2)
 *
 * @param da An OPEN handle to a fresh empty ledger.
 * @returns The project/room ids + bob's non-zero stored cursor.
 */
export async function seedComprehensiveBoard(
  da: DataAccessHandle,
): Promise<SeededBoard> {
  await register(da, { handle: 'alice', currentFocus: 'kickoff' });
  await register(da, { handle: 'bob', currentFocus: 'helping' });
  await register(da, { handle: 'carol', currentFocus: 'lurking' });
  // identity.focus_updated — alice changes focus.
  await updateFocus(da, 'alice', 'designing the interface');
  const project = await announceProject(da, 'alice', {
    title: 'Calling Interface',
    description: 'Design the calling interface.',
  });
  const room = await postAnnouncement(da, 'alice', {
    projectId: project.projectId,
    subject: 'Need a calling interface',
    body: 'Who can help design **the calling interface**?',
  });
  // A SECOND announcement that NOBODY replies to → it stays a PROTO-room (active=false), so
  // `listAnnouncements` is NON-EMPTY and the proto-room half of the rooms category is actually
  // compared in the round-trip (otherwise `announcements` is trivially []===[] on both sides and
  // proves nothing). QA-hardened (Story 11.4): the seed MUST exercise BOTH listAnnouncements
  // (proto) AND listRooms (activated) per AC3.
  await postAnnouncement(da, 'alice', {
    projectId: project.projectId,
    subject: 'Also need a settings panel',
    body: 'A *proto-room* with no reply yet — stays an announcement.',
  });
  // bob replies → activates the FIRST room + auto-joins bob (acting = joining).
  await reply(da, 'bob', { roomId: room.roomId, body: 'I can. Proposing X.' });
  // bob (a participant) pulls carol into the room → room.participant_added + carol board.joined.
  await addParticipant(da, 'bob', { roomId: room.roomId, handle: 'carol' });
  await reply(da, 'alice', { roomId: room.roomId, body: 'X looks good.' });
  // alice 👍 bob's reply (the activating message — THE LIVE CONTRACT). Find seqs via the history.
  const messages = roomMessages(await da.eventsSince(0), room.roomId);
  const bobReply = messages.find(
    (m) => m.actor === 'bob' && m.kind === 'reply',
  );
  const aliceReply = messages.find(
    (m) => m.actor === 'alice' && m.kind === 'reply',
  );
  if (bobReply === undefined || aliceReply === undefined) {
    throw new Error('seed invariant: expected a bob reply and an alice reply');
  }
  await react(da, 'alice', bobReply.seq);
  // alice 👍 her OWN reply, then retracts it → message.reacted + message.unreacted (bob's 👍 on
  // bobReply stays live; only alice's reaction on aliceReply flips off — so the contract is
  // bobReply, NOT the higher-seq aliceReply, which discriminates the contract category sharply).
  await react(da, 'alice', aliceReply.seq);
  await unreact(da, 'alice', aliceReply.seq);
  // bob dials in → advances + STORES his per-identity cursor (the read-state carve-out). bob sees
  // alice's later reply + the reactions (all past his join floor), so his stored cursor is > 0.
  const result = await check(da, 'bob');
  const bobCursor = await da.getCursor('bob');
  if (bobCursor !== result.cursor || bobCursor <= 0) {
    throw new Error(
      `seed invariant: expected a non-zero stored cursor for bob (got ${String(bobCursor)})`,
    );
  }
  return { projectId: project.projectId, roomId: room.roomId, bobCursor };
}

/**
 * The comprehensive, per-category snapshot of a board's DERIVED STATE — read through the CORE
 * PROJECTIONS, never a raw row diff (AC3). The FR34 comparison object: two boards are fidelity-
 * equal iff their `deriveComparableState` snapshots are deep-equal.
 *
 * Every category in the epics list is read explicitly so a break LOCALIZES to one category:
 *   - identities — `foldIdentities` (handle + currentFocus only)
 *   - membership — `foldProjects`/`listProjects` member sets per project
 *   - rooms      — `listRooms` + `listAnnouncements` per project (proto vs activated) + the
 *                  per-room metadata via `foldRooms`
 *   - messages   — `roomMessages` per room (seq-ordered body/actor/kind)
 *   - reactions  — `liveReactors` per message (the live 👍 set)
 *   - contracts  — `currentContract` per room (the FR21 highest-seq live-👍'd message)
 *   - cursors    — `getCursor(handle)` per identity (the read-state carve-out)
 *
 * WHY `createdAt`/`lastSeen` are EXCLUDED (a recorded decision, NOT a silent loosening):
 * replay-via-`append` RE-ASSIGNS each event's `createdAt` to import-time, so the restored
 * board's `Identity.createdAt`/`lastSeen` (both derived FROM event `createdAt`) differ by design.
 * They are DISPLAY-ONLY and are NOT seq-derived board state — the Story-11.3 AC4 reconciliation
 * (its QA/CR explicitly confirmed Story 11.4 adopts the strip-display-timestamps comparison).
 * Everything else here is seq-keyed (handle/focus/membership/rooms/messages/reactions/contract/
 * cursor) and reproduces 1:1 because ordered replay into an empty board reproduces `seq` 1..N.
 */
export interface ComparableState {
  identities: { handle: string; currentFocus: string }[];
  membership: { projectId: string; members: string[] }[];
  rooms: {
    projectId: string;
    announcements: ComparableRoom[];
    activated: ComparableRoom[];
  }[];
  messages: ComparableMessage[];
  reactions: { messageSeq: number; liveReactors: string[] }[];
  contracts: { roomId: string; contract: ComparableContract | null }[];
  cursors: { handle: string; cursor: number }[];
}

interface ComparableRoom {
  roomId: string;
  projectId: string;
  subject: string;
  body: string;
  postedBy: string;
  seq: number;
  active: boolean;
  activatedBy: string | undefined;
  activatedAtSeq: number | undefined;
  participants: string[];
}

interface ComparableMessage {
  roomId: string;
  seq: number;
  actor: string;
  kind: string;
  body: string;
}

interface ComparableContract {
  seq: number;
  actor: string;
  kind: string;
  body: string;
}

/**
 * Read the full per-category {@link ComparableState} from a ledger through the core projections.
 *
 * @param da An OPEN handle to the ledger to snapshot.
 */
export async function deriveComparableState(
  da: DataAccessHandle,
): Promise<ComparableState> {
  const events = await da.eventsSince(0);

  // --- identities (handle + currentFocus; createdAt/lastSeen EXCLUDED — see the WHY note) ---
  const identityRecords = [...foldIdentities(events).values()];
  const identities = identityRecords.map((id) => ({
    handle: id.handle,
    currentFocus: id.currentFocus,
  }));

  // --- membership (board members per project) ---
  const projects = await listProjects(da);
  const membership = projects.map((p) => ({
    projectId: p.projectId,
    members: [...foldProjects(events).get(p.projectId)!.members],
  }));

  // --- rooms (proto vs activated per project + per-room metadata + participants) ---
  const allRooms = [...foldRooms(events).values()];
  const toComparableRoom = (roomId: string): ComparableRoom => {
    const room = foldRooms(events).get(roomId)!;
    return {
      roomId: room.roomId,
      projectId: room.projectId,
      subject: room.subject,
      body: room.body,
      postedBy: room.postedBy,
      seq: room.seq,
      active: room.active,
      activatedBy: room.activatedBy,
      activatedAtSeq: room.activatedAtSeq,
      participants: roomParticipants(events, room.roomId),
    };
  };
  const rooms = await Promise.all(
    projects.map(async (p) => ({
      projectId: p.projectId,
      announcements: (await listAnnouncements(da, p.projectId)).map((r) =>
        toComparableRoom(r.roomId),
      ),
      activated: (await listRooms(da, p.projectId)).map((r) =>
        toComparableRoom(r.roomId),
      ),
    })),
  );

  // --- messages (per room, seq-ordered) + reactions (live 👍 per message) ---
  const messages: ComparableMessage[] = [];
  const reactions: { messageSeq: number; liveReactors: string[] }[] = [];
  const contracts: { roomId: string; contract: ComparableContract | null }[] =
    [];
  for (const room of allRooms) {
    for (const m of roomMessages(events, room.roomId)) {
      messages.push({
        roomId: room.roomId,
        seq: m.seq,
        actor: m.actor,
        kind: m.kind,
        body: m.body,
      });
      reactions.push({
        messageSeq: m.seq,
        liveReactors: liveReactors(events, m.seq),
      });
    }
    // --- contracts (the FR21 highest-seq live-👍'd message per room) ---
    const contract = currentContract(events, room.roomId);
    contracts.push({
      roomId: room.roomId,
      contract:
        contract === null
          ? null
          : {
              seq: contract.seq,
              actor: contract.actor,
              kind: contract.kind,
              body: contract.body,
            },
    });
  }

  // --- cursors (the read-state carve-out — getCursor per identity; the category most likely to
  //     silently break, so it is asserted explicitly). 0 = the unset sentinel. ---
  const cursors = await Promise.all(
    identityRecords.map(async (id) => ({
      handle: id.handle,
      cursor: await da.getCursor(id.handle),
    })),
  );

  return {
    identities,
    membership,
    rooms,
    messages,
    reactions,
    contracts,
    cursors,
  };
}

/** Export a (closed) ledger at `dbPath` to NDJSON archive text via the REAL export codec/port. */
export async function exportToText(dbPath: string): Promise<string> {
  const out: string[] = [];
  await runExport({ dbPath }, { out: (text) => out.push(text) });
  return out.join('');
}
