import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ProgressEventV1Schema,
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

  const base = { playerId, colonyId, planetId: e.planetId, atTick: e.tick ?? 0 };
  switch (e.kind) {
    case 'tilePrepared':
      return {
        ...base,
        family: 'groundbreaker',
        metric: 'counter',
        value: typeof data.count === 'number' && data.count > 0 ? Math.floor(data.count) : 1,
      };
    case 'obstacleRemoved':
      return {
        ...base,
        family: 'stone-mason',
        metric: 'counter',
        value: typeof data.count === 'number' && data.count > 0 ? Math.floor(data.count) : 1,
      };
    case 'colonyFounded':
      return { ...base, family: 'first-landfall', metric: 'counter', value: 1 };
    case 'buildingCompleted':
      return { ...base, family: 'architect', metric: 'counter', value: 1 };
    case 'resourceProduced': {
      const raw = typeof data.amount === 'number' ? data.amount : typeof data.count === 'number' ? data.count : 1;
      return { ...base, family: 'stockpile', metric: 'counter', value: Math.max(1, Math.floor(raw)) };
    }
    default:
      return null;
  }
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
    private readonly store: FactsStore,
    @Optional() private readonly bus?: EventBus,
    @Optional() private readonly homeRepo?: HomeRepository,
  ) {}

  onModuleInit(): void {
    if (!this.bus) return;
    this.unsubs.push(
      this.bus.on(
        'planet.event',
        (ev) => {
          const prog = planetEventToProgress(ev, (cid) => this.homeRepo?.findCachedColonyById(cid)?.playerId);
          if (prog) void this.applyProgressEvent(prog);
        },
        { module: 'progression' },
      ),
      this.bus.on(
        'progression.fact',
        (ev) => {
          void this.applyProgressEvent(ev);
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
    return this.recordFact(ev.playerId, ev.family, ev.value, ev.metric);
  }

  async recordFact(
    playerId: string,
    family: AchievementFamilyId,
    valueOrDelta: number,
    metricOverride?: AchievementMetric,
  ): Promise<FactUpdateResult> {
    const result = await this.store.update(playerId, family, valueOrDelta, metricOverride);
    const allFacts = await this.store.getAll(playerId);
    for (const fn of this.listeners) {
      await fn(result, allFacts);
    }
    return result;
  }
}
