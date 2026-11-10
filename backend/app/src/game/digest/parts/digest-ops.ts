import type { AwayDigestV1 } from '@terra/contracts';
import type { PlanetState } from '@terra/sim';
import { baselineFromState, stateOf } from '../baseline';
import { checkedDigest, isZeroBaseline, stampAfter, stampBaseline } from '../body';
import { mergeBodies } from '../folder';
import { awayFacts, withAwayParagraph, type DigestStory } from '../story';
import type { BaselineReader, DigestLog, DigestRecord, DigestStore, OpenDigest } from '../types';

export function toOpenDigest(row: DigestRecord, filled = !isZeroBaseline(row.body)): OpenDigest {
  return {
    id: row.id,
    planetId: row.planetId,
    colonyId: row.colonyId,
    openedAt: row.openedAt,
    body: row.body,
    lastEventSeq: row.lastEventSeq,
    dirty: false,
    baselineFilled: filled,
  };
}

export function fillOpenBaseline(live: OpenDigest, state: PlanetState): void {
  const base = baselineFromState(state, live.colonyId);
  if (!base) return;
  live.body = checkedDigest(stampBaseline(live.body, base));
  live.baselineFilled = true;
  live.dirty = true;
}

/** End baseline from bytes already in hand. A miss leaves `before === after` (BE-59). */
export function withEndBaseline(body: AwayDigestV1, raw?: Uint8Array): AwayDigestV1 {
  if (!raw) return body;
  const state = stateOf(raw);
  if (!state) return body;
  const base = baselineFromState(state, body.colonyId);
  if (!base) return body;
  return checkedDigest(stampAfter(body, base));
}

export async function readDigestBaseline(
  reader: BaselineReader | undefined,
  log: DigestLog | undefined,
  planetId: string,
  colonyId: string,
  body: AwayDigestV1,
): Promise<{ body: AwayDigestV1; filled: boolean }> {
  if (!reader) return { body, filled: false };
  try {
    const base = await reader.read(planetId, colonyId);
    if (!base) return { body, filled: false };
    return { body: checkedDigest(stampBaseline(body, base)), filled: true };
  } catch (err) {
    log?.warn(
      { planetId, colonyId, err: err instanceof Error ? err.message : String(err) },
      'digest baseline unread',
    );
    return { body, filled: false };
  }
}

/** One paragraph after the close merge. A throw or a null paragraph leaves the closed body without `story`. */
export async function sealDigestStory(
  store: DigestStore,
  story: DigestStory | undefined,
  log: DigestLog | undefined,
  colonyId: string,
  at: Date,
): Promise<void> {
  if (!story) return;
  const row = await store.latestUnseen(colonyId);
  if (!row?.closedAt) return;
  let paragraph: string | null = null;
  try {
    paragraph = story.paragraph(colonyId, at, awayFacts(row.body)) ?? null;
  } catch (err) {
    log?.warn({ colonyId, err: err instanceof Error ? err.message : String(err) }, 'away story omitted');
  }
  const next = withAwayParagraph(row.body, paragraph);
  if (next === row.body) return;
  await store.save(row.id, next, row.lastEventSeq, row.closedAt);
}

export async function mergeUnseenDigests(
  store: DigestStore,
  open: Map<string, OpenDigest>,
  colonyId: string,
  seenAt: Date,
): Promise<void> {
  const rows = await store.listUnseen(colonyId);
  if (rows.length < 2) return;
  const newest = rows[rows.length - 1];
  if (!newest) return;
  const older = rows.slice(0, -1);
  const liveHead = open.get(colonyId);
  const head = liveHead && liveHead.id === newest.id ? liveHead.body : newest.body;
  const merged = checkedDigest(mergeBodies([...older.map((row) => row.body), head]));
  const newestSeq = liveHead && liveHead.id === newest.id ? liveHead.lastEventSeq : newest.lastEventSeq;
  const seq = older.reduce((n, row) => (row.lastEventSeq > n ? row.lastEventSeq : n), newestSeq);
  await store.commitMerge({
    newestId: newest.id,
    body: merged,
    lastEventSeq: seq,
    olderIds: older.map((row) => row.id),
    seenAt,
  });
  const live = open.get(colonyId);
  if (live && live.id === newest.id) {
    live.body = merged;
    live.lastEventSeq = seq;
    live.dirty = false;
  }
}
