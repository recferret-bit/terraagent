import { CheckpointProgression } from './checkpoint-progression.js';
import { PROGRESSION_EVENT_RULES, progressEventId } from './event-rules.js';
import { ProgressionEngine } from './progression-engine.js';
import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ProgressEventV1Schema,
  ACHIEVEMENT_FAMILY_BY_ID,
  type AchievementFamilyId,
  type AchievementMetric,
  type ProgressEventV1,
} from '@terra/contracts';
import type { PlanetEventV1 } from '../bus/channels.js';
import { EventBus, type Unsubscribe } from '../bus/event-bus.js';
import { HomeRepository } from '../core/home/home.repository.js';
import { FactsStore, type FactUpdateResult } from './facts.store.js';

export type FactUpdatedListener = (
  result: FactUpdateResult,
  allFacts: Readonly<Record<string, number>>,
) => void | Promise<void>;

declare module '../bus/channels.js' {
  interface BusChannels {
    'progression.fact': ProgressEventV1;
  }
}

/** Maps a `planet.event` payload to a `ProgressEventV1` when it corresponds to an achievement family. */
export function planetEventToProgress(
  e: PlanetEventV1,
  resolvePlayerId?: (colonyId: string) => string | undefined,
): ProgressEventV1 | null {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const colonyId =
    (typeof data.colonyId === 'string' && data.colonyId) ||
    (typeof e.colonyIds?.[0] === 'string' && e.colonyIds[0]) ||
    '';
  const playerId =
    (typeof data.playerId === 'string' && data.playerId) ||
    (colonyId && resolvePlayerId ? resolvePlayerId(colonyId) : undefined) ||
    '';
  if (!playerId || !colonyId) return null;

  const rule = PROGRESSION_EVENT_RULES[e.kind];
  if (!rule) return null;
  const family = (typeof data.op === 'string' && rule.familyByOp?.[data.op]) || rule.family;
  const raw = rule.fields.map(key => data[key]).find(value => typeof value === 'number');
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : rule.fallback;
  return { playerId, colonyId, planetId: e.planetId, atTick: e.tick ?? 0,
    eventId: progressEventId(e), family, metric: ACHIEVEMENT_FAMILY_BY_ID.get(family)!.metric, value };

}

/**
 * Listens on the in-process bus (`planet.event` and `progression.fact`), updates `FactsStore` (`counter` += delta,
 * `max` = GREATEST(old, new)), and notifies downstream subscribers (`AchievementEvaluator`, W12-03).
 */
@Injectable()
export class FactsUpdaterService implements OnModuleInit, OnModuleDestroy {
  private readonly unsubs: Unsubscribe[] = [];
  private readonly listeners = new Set<FactUpdatedListener>();

  constructor(
    @Inject(FactsStore) private readonly store: FactsStore,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(HomeRepository) private readonly homeRepo?: HomeRepository,
    @Optional() @Inject(ProgressionEngine) private readonly engine?: ProgressionEngine,
    @Optional() @Inject(CheckpointProgression) private readonly checkpoint?: CheckpointProgression,
  ) {}

  onModuleInit(): void {
    if (!this.bus) return;
    this.unsubs.push(
      this.bus.on(
        'planet.event',
        (ev) => {
          const prog = planetEventToProgress(ev, (cid) => this.homeRepo?.findCachedColonyById(cid)?.playerId);
          if (prog && this.checkpoint?.enabled) this.checkpoint.stage(prog);
          else if (prog) return this.applyProgressEvent(prog);
        },
        { module: 'progression' },
      ),
      this.bus.on(
        'progression.fact',
        (ev) => {
          return this.applyProgressEvent(ev);
        },
        { module: 'progression' },
      ),
    );
  }

  onModuleDestroy(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  onFactUpdated(fn: FactUpdatedListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async applyProgressEvent(raw: ProgressEventV1): Promise<FactUpdateResult> {
    const ev = ProgressEventV1Schema.parse(raw);
    if (this.engine?.enabled) return this.engine.apply(ev);
    return this.recordFact(ev.playerId, ev.family, ev.value, ev.metric);
  }

  async recordFact(
    playerId: string,
    family: AchievementFamilyId,
    valueOrDelta: number,
    metricOverride?: AchievementMetric,
  ): Promise<FactUpdateResult> {
    if (this.engine?.enabled) {
      const metric = metricOverride ?? ACHIEVEMENT_FAMILY_BY_ID.get(family)!.metric;
      return this.engine.apply({ playerId, family, value: valueOrDelta, metric, colonyId: 'admin', planetId: 'admin', atTick: 0 });
    }
    const result = await this.store.update(playerId, family, valueOrDelta, metricOverride);
    const allFacts = await this.store.getAll(playerId);
    for (const fn of this.listeners) {
      await fn(result, allFacts);
    }
    return result;
  }
}
