import type { AwayDigestV1, AwaySummary } from '@terra/contracts';
import type { PlanetState } from '@terra/sim';
import { stateOf } from './baseline';
import { checkedDigest, digestCutoff, draftDigest, isZeroBaseline } from './body';
import { digestSignal } from './events';
import { foldAttack, foldDirectorTrade } from './folder';
import {
  fillOpenBaseline,
  mergeUnseenDigests,
  readDigestBaseline,
  sealDigestStory,
  toOpenDigest,
  withEndBaseline,
} from './parts/digest-ops';
import type { DigestStory } from './story';
import { awaySummary } from './summary';
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
  /** Empty when W16 is off. Asked once at close, never while folding a raid. */
  readonly story?: DigestStory;
}

/**
 * Opens one digest when the sim emits `colonyAway`, folds raids while that row is open, and closes it on
 * `colonyBack` or a presence return. Snapshot writes call {@link flushPlanet} (CT-31).
 * {@link deliverWelcome} closes a still-open row, stamps `after` from the welcome snapshot, and marks it seen.
 * The away paragraph is attached once at close. A null paragraph does not add a `story` key.
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
    return this.enqueue(info.colonyId, () => this.closeRow(info.colonyId, info.at));
  }

  onPlanetEvent(event: PlanetEventLike): Promise<void> {
    const signal = digestSignal(event);
    if (signal.type === 'ignore') return Promise.resolve();
    if (signal.type === 'away') {
      if (this.suppressAway.has(signal.colonyId)) return Promise.resolve();
      const at = this.now();
      return this.enqueue(signal.colonyId, () => this.openRow(signal.planetId, signal.colonyId, at));
    }
    if (signal.type === 'back') {
      const at = this.now();
      return this.enqueue(signal.colonyId, () => this.closeRow(signal.colonyId, at));
    }
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
    await this.deps.store.warm();
    await this.purge();
    for (const row of await this.deps.store.listOpen()) this.remember(row);
  }

  /** Rows in `world.planet_event_digest`. O(1); a scrape must not scan the table. */
  rowCount(): number {
    return this.deps.store.rowCount();
  }

  /**
   * Latest closed unseen digest for `welcome.away`. Closes an open row first. `raw` is the snapshot already
   * loaded for that welcome; it sets `after` without a second `fullState`. Marks every closed unseen row seen.
   */
  deliverWelcome(colonyId: string, at: Date, raw?: Uint8Array): Promise<AwayDigestV1 | null> {
    return this.enqueue(colonyId, () => this.deliver(colonyId, at, raw));
  }

  /** Headline of the newest unseen row. Does not mark it seen, so welcome can still carry the digest. */
  headline(colonyId: string, at = this.now()): Promise<AwaySummary | null> {
    return this.enqueue(colonyId, () => this.summarize(colonyId, at));
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
    const { body, filled } = await readDigestBaseline(this.deps.reader, this.deps.log, planetId, colonyId, drafted);
    const row = await this.deps.store.insert({ colonyId, planetId, openedAt: at, lastEventSeq: 0n, body });
    this.remember(row, filled);
    await mergeUnseenDigests(this.deps.store, this.open, colonyId, this.now());
    await this.purge();
  }

  private async closeRow(colonyId: string, at: Date): Promise<void> {
    const live = await this.live(colonyId);
    if (!live) return;
    const durationS = Math.max(0, Math.floor((at.getTime() - live.openedAt.getTime()) / 1000));
    live.body = checkedDigest({ ...live.body, awayTo: at.toISOString(), durationS });
    await this.deps.store.save(live.id, live.body, live.lastEventSeq, at);
    this.open.delete(colonyId);
    await mergeUnseenDigests(this.deps.store, this.open, colonyId, this.now());
    await sealDigestStory(this.deps.store, this.deps.story, this.deps.log, colonyId, at);
  }

  /** One director sentence on the open away row. No open row means the line is not stored. */
  noteDirectorTrade(colonyId: string, line: string, tick = 0): Promise<void> {
    if (colonyId.length === 0 || line.length === 0) return Promise.resolve();
    return this.enqueue(colonyId, () => this.foldTrade(colonyId, line, tick));
  }

  private async fold(colonyId: string, event: AttackFold): Promise<void> {
    const live = await this.live(colonyId);
    if (!live) return;
    live.body = checkedDigest(foldAttack(live.body, event));
    const tick = BigInt(Math.max(0, Math.floor(event.tick)));
    if (tick > live.lastEventSeq) live.lastEventSeq = tick;
    live.dirty = true;
  }

  private async foldTrade(colonyId: string, line: string, tick: number): Promise<void> {
    const live = await this.live(colonyId);
    if (!live) return;
    live.body = checkedDigest(foldDirectorTrade(live.body, line));
    const at = BigInt(Math.max(0, Math.floor(tick)));
    if (at > live.lastEventSeq) live.lastEventSeq = at;
    live.dirty = true;
  }

  private async persist(colonyId: string, state: PlanetState | null): Promise<void> {
    const live = this.open.get(colonyId);
    if (!live) return;
    if (state && !live.baselineFilled) fillOpenBaseline(live, state);
    if (!live.dirty) return;
    const body = live.body;
    await this.deps.store.save(live.id, body, live.lastEventSeq);
    if (live.body === body) live.dirty = false;
  }

  private async live(colonyId: string): Promise<OpenDigest | null> {
    const have = this.open.get(colonyId);
    if (have) return have;
    const row = await this.deps.store.findOpen(colonyId);
    return row ? this.remember(row) : null;
  }

  private remember(row: DigestRecord, filled = !isZeroBaseline(row.body)): OpenDigest {
    const live = toOpenDigest(row, filled);
    this.open.set(row.colonyId, live);
    return live;
  }

  private async deliver(colonyId: string, at: Date, raw?: Uint8Array): Promise<AwayDigestV1 | null> {
    await this.closeRow(colonyId, at);
    const row = await this.deps.store.latestUnseen(colonyId);
    if (!row?.closedAt) return null;
    const body = withEndBaseline(row.body, raw);
    if (body !== row.body) await this.deps.store.save(row.id, body, row.lastEventSeq, row.closedAt);
    await this.deps.store.markClosedUnseen(colonyId, at);
    return body;
  }

  private async summarize(colonyId: string, at: Date): Promise<AwaySummary | null> {
    const row = await this.deps.store.latestUnseen(colonyId);
    if (!row) return null;
    const live = this.open.get(colonyId);
    const body = live?.id === row.id ? live.body : row.body;
    return awaySummary({ ...row, body }, at);
  }

  private enqueue<T>(colonyId: string, work: () => Promise<T>): Promise<T> {
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
