import type { AwayDigestV1 } from '@terra/contracts';
import type { PlanetState } from '@terra/sim';
import { baselineFromState, stateOf } from './baseline';
import { checkedDigest, digestCutoff, draftDigest, isZeroBaseline, stampBaseline } from './body';
import { digestSignal } from './events';
import { foldAttack, mergeBodies } from './folder';
import type {
  AttackFold,
  BaselineReader,
  DigestLog,
  DigestRecord,
  DigestStore,
  OpenDigest,
  PlanetEventLike,
} from './types';

export interface DigestDeps {
  readonly store: DigestStore;
  readonly reader?: BaselineReader;
  readonly now?: () => Date;
  readonly log?: DigestLog;
}

/**
 * Opens one digest when the sim emits `colonyAway`, folds raids while that row is open, and closes it on
 * `colonyBack` or a presence return. Snapshot writes call {@link flushPlanet} (CT-31).
 */
export class AwayDigestService {
  private readonly open = new Map<string, OpenDigest>();
  private readonly tails = new Map<string, Promise<void>>();
  /** Set on a presence return so a late `colonyAway` does not reopen after the player is back. */
  private readonly suppressAway = new Set<string>();

  constructor(private readonly deps: DigestDeps) {}

  onPresence(info: { planetId: string; colonyId: string; away: boolean; at: Date }): Promise<void> {
    if (info.away) {
      this.suppressAway.delete(info.colonyId);
      return Promise.resolve();
    }
    this.suppressAway.add(info.colonyId);
    return this.noteBack(info.colonyId, info.at);
  }

  onPlanetEvent(event: PlanetEventLike): Promise<void> {
    const signal = digestSignal(event);
    if (signal.type === 'ignore') return Promise.resolve();
    if (signal.type === 'away') {
      if (this.suppressAway.has(signal.colonyId)) return Promise.resolve();
      return this.noteAway(signal.planetId, signal.colonyId, this.now());
    }
    if (signal.type === 'back') return this.noteBack(signal.colonyId, this.now());
    return this.enqueue(signal.colonyId, () => this.fold(signal.colonyId, signal.attack));
  }

  /** Writes dirty open bodies. `raw` is the snapshot just saved; it fills a baseline that is still zero. */
  async flushPlanet(planetId: string, raw?: Uint8Array): Promise<void> {
    const state = raw ? stateOf(raw) : null;
    const ids = [...this.open.values()].filter((row) => row.planetId === planetId).map((row) => row.colonyId);
    await Promise.all(ids.map((id) => this.enqueue(id, () => this.persist(id, state))));
    await this.purge();
  }

  async restoreOpen(): Promise<void> {
    await this.purge();
    for (const row of await this.deps.store.listOpen()) this.remember(row);
  }

  async purge(now = this.now()): Promise<number> {
    const removed = await this.deps.store.purgeOpenedBefore(digestCutoff(now));
    if (removed > 0) {
      for (const [id, row] of this.open) {
        if (row.openedAt.getTime() < digestCutoff(now).getTime()) this.open.delete(id);
      }
    }
    return removed;
  }

  private noteAway(planetId: string, colonyId: string, at: Date): Promise<void> {
    return this.enqueue(colonyId, () => this.openRow(planetId, colonyId, at));
  }

  private noteBack(colonyId: string, at: Date): Promise<void> {
    return this.enqueue(colonyId, () => this.closeRow(colonyId, at));
  }

  private async openRow(planetId: string, colonyId: string, at: Date): Promise<void> {
    if (this.suppressAway.has(colonyId) || this.open.has(colonyId)) return;
    const existing = await this.deps.store.findOpen(colonyId);
    if (existing) {
      this.remember(existing);
      return;
    }
    const drafted = draftDigest(colonyId, at.toISOString());
    if (!drafted) {
      this.deps.log?.warn({ colonyId }, 'digest skipped: colony id is not a home id');
      return;
    }
    const { body, filled } = await this.readBaseline(planetId, colonyId, drafted);
    const row = await this.deps.store.insert({ colonyId, planetId, openedAt: at, lastEventSeq: 0n, body });
    this.remember(row, filled);
    await this.mergeUnseen(colonyId);
    await this.purge();
  }

  private async closeRow(colonyId: string, at: Date): Promise<void> {
    const live = await this.live(colonyId);
    if (!live) return;
    const durationS = Math.max(0, Math.floor((at.getTime() - live.openedAt.getTime()) / 1000));
    live.body = checkedDigest({ ...live.body, awayTo: at.toISOString(), durationS });
    await this.deps.store.save(live.id, live.body, live.lastEventSeq, at);
    this.open.delete(colonyId);
    await this.mergeUnseen(colonyId);
  }

  private async fold(colonyId: string, event: AttackFold): Promise<void> {
    const live = await this.live(colonyId);
    if (!live) return;
    live.body = checkedDigest(foldAttack(live.body, event));
    const tick = BigInt(Math.max(0, Math.floor(event.tick)));
    if (tick > live.lastEventSeq) live.lastEventSeq = tick;
    live.dirty = true;
  }

  private async persist(colonyId: string, state: PlanetState | null): Promise<void> {
    const live = this.open.get(colonyId);
    if (!live) return;
    if (state && !live.baselineFilled) this.fill(live, state);
    if (!live.dirty) return;
    const body = live.body;
    await this.deps.store.save(live.id, body, live.lastEventSeq);
    if (live.body === body) live.dirty = false;
  }

  private fill(live: OpenDigest, state: PlanetState): void {
    const base = baselineFromState(state, live.colonyId);
    if (!base) return;
    live.body = checkedDigest(stampBaseline(live.body, base));
    live.baselineFilled = true;
    live.dirty = true;
  }

  private async readBaseline(
    planetId: string,
    colonyId: string,
    body: AwayDigestV1,
  ): Promise<{ body: AwayDigestV1; filled: boolean }> {
    if (!this.deps.reader) return { body, filled: false };
    try {
      const base = await this.deps.reader.read(planetId, colonyId);
      if (!base) return { body, filled: false };
      return { body: checkedDigest(stampBaseline(body, base)), filled: true };
    } catch (err) {
      this.deps.log?.warn(
        { planetId, colonyId, err: err instanceof Error ? err.message : String(err) },
        'digest baseline unread',
      );
      return { body, filled: false };
    }
  }

  private async live(colonyId: string): Promise<OpenDigest | null> {
    const have = this.open.get(colonyId);
    if (have) return have;
    const row = await this.deps.store.findOpen(colonyId);
    return row ? this.remember(row) : null;
  }

  private remember(row: DigestRecord, filled = !isZeroBaseline(row.body)): OpenDigest {
    const live: OpenDigest = {
      id: row.id,
      planetId: row.planetId,
      colonyId: row.colonyId,
      openedAt: row.openedAt,
      body: row.body,
      lastEventSeq: row.lastEventSeq,
      dirty: false,
      baselineFilled: filled,
    };
    this.open.set(row.colonyId, live);
    return live;
  }

  private async mergeUnseen(colonyId: string): Promise<void> {
    const rows = await this.deps.store.listUnseen(colonyId);
    if (rows.length < 2) return;
    const newest = rows[rows.length - 1];
    if (!newest) return;
    const older = rows.slice(0, -1);
    const liveHead = this.open.get(colonyId);
    const head = liveHead && liveHead.id === newest.id ? liveHead.body : newest.body;
    const merged = checkedDigest(mergeBodies([...older.map((row) => row.body), head]));
    const seq = older.reduce((n, row) => (row.lastEventSeq > n ? row.lastEventSeq : n), this.seqOf(newest));
    await this.deps.store.commitMerge({
      newestId: newest.id,
      body: merged,
      lastEventSeq: seq,
      olderIds: older.map((row) => row.id),
      seenAt: this.now(),
    });
    const live = this.open.get(colonyId);
    if (live && live.id === newest.id) {
      live.body = merged;
      live.lastEventSeq = seq;
      live.dirty = false;
    }
  }

  private seqOf(row: DigestRecord): bigint {
    const live = this.open.get(row.colonyId);
    return live && live.id === row.id ? live.lastEventSeq : row.lastEventSeq;
  }

  private enqueue(colonyId: string, work: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(colonyId) ?? Promise.resolve();
    const run = prev.then(work);
    this.tails.set(
      colonyId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
