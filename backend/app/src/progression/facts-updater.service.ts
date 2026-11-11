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

function collectTruceColonies(e: PlanetEventV1, data: Record<string, unknown>): string[] {
  const result: string[] = [];
  const add = (c: unknown) => {
    if (typeof c === 'string' && c.trim().length > 0 && !result.includes(c.trim())) {
      result.push(c.trim());
    }
  };
  add(data.colonyA);
  add(data.colonyAId);
  add(data.colonyB);
  add(data.colonyBId);
  add(data.colonyId);
  if (Array.isArray(e.colonyIds)) {
    for (const cid of e.colonyIds) add(cid);
  }
  if (result.length === 0) {
    if (typeof data.colonyA === 'number' && data.colonyA >= 0) result.push(String(data.colonyA));
    if (typeof data.colonyB === 'number' && data.colonyB >= 0) result.push(String(data.colonyB));
  }
  return result;
}

function resolveTrucePlayerId(
  colonyId: string,
  data: Record<string, unknown>,
  allColonies: readonly string[],
  resolvePlayerId?: (colonyId: string) => string | undefined,
): string | undefined {
  if (resolvePlayerId) {
    const fromCb = resolvePlayerId(colonyId);
    if (fromCb) return fromCb;
  }
  const isA = colonyId === data.colonyA || colonyId === data.colonyAId || colonyId === String(data.colonyA);
  const isB = colonyId === data.colonyB || colonyId === data.colonyBId || colonyId === String(data.colonyB);
  if (isA && typeof data.playerAId === 'string' && data.playerAId) return data.playerAId;
  if (isA && typeof data.playerA === 'string' && data.playerA) return data.playerA;
  if (isB && typeof data.playerBId === 'string' && data.playerBId) return data.playerBId;
  if (isB && typeof data.playerB === 'string' && data.playerB) return data.playerB;
  if (colonyId === data.colonyId && typeof data.playerId === 'string' && data.playerId) return data.playerId;
  if (allColonies.length === 1 && typeof data.playerId === 'string' && data.playerId) return data.playerId;
  return undefined;
}

function resolveUnitDestroyedEvents(
  e: PlanetEventV1,
  data: Record<string, unknown>,
  family: AchievementFamilyId,
  metric: AchievementMetric,
  value: number,
  resolvePlayerId?: (colonyId: string) => string | undefined,
): ProgressEventV1[] {
  const killerColony =
    (typeof data.killerColonyId === 'string' && data.killerColonyId.trim().length > 0 && data.killerColonyId.trim()) ||
    (typeof data.attackerColonyId === 'string' && data.attackerColonyId.trim().length > 0 && data.attackerColonyId.trim()) ||
    '';
  const colonyId =
    killerColony ||
    (typeof data.colonyId === 'string' && data.colonyId) ||
    (typeof e.colonyIds?.[0] === 'string' && e.colonyIds[0]) ||
    '';
  const playerId = killerColony
    ? (typeof data.killerPlayerId === 'string' && data.killerPlayerId) ||
      (typeof data.attackerPlayerId === 'string' && data.attackerPlayerId) ||
      (resolvePlayerId ? resolvePlayerId(killerColony) : undefined) ||
      ''
    : (typeof data.playerId === 'string' && data.playerId) ||
      (colonyId && resolvePlayerId ? resolvePlayerId(colonyId) : undefined) ||
      '';
  if (!playerId || !colonyId) return [];
  return [{
    playerId,
    colonyId,
    planetId: e.planetId,
    atTick: e.tick ?? 0,
    eventId: progressEventId(e),
    family,
    metric,
    value,
  }];
}

function resolveTruceEndedEvents(
  e: PlanetEventV1,
  data: Record<string, unknown>,
  family: AchievementFamilyId,
  metric: AchievementMetric,
  value: number,
  resolvePlayerId?: (colonyId: string) => string | undefined,
): ProgressEventV1[] {
  const colonies = collectTruceColonies(e, data);
  const events: ProgressEventV1[] = [];
  for (const colonyId of colonies) {
    const playerId = resolveTrucePlayerId(colonyId, data, colonies, resolvePlayerId);
    if (!playerId) continue;
    events.push({
      playerId,
      colonyId,
      planetId: e.planetId,
      atTick: e.tick ?? 0,
      eventId: progressEventId({ ...e, colonyId }),
      family,
      metric,
      value,
    });
  }
  return events;
}

/** Maps a `planet.event` payload to a list of `ProgressEventV1` (e.g. bilateral truces or killer credit). */
export function planetEventToProgressEvents(
  e: PlanetEventV1,
  resolvePlayerId?: (colonyId: string) => string | undefined,
): ProgressEventV1[] {
  const rule = PROGRESSION_EVENT_RULES[e.kind];
  if (!rule) return [];
  const data = (e.data ?? {}) as Record<string, unknown>;
  if (rule.predicate && !rule.predicate(data)) return [];

  const family = (typeof data.op === 'string' && rule.familyByOp?.[data.op]) || rule.family;
  const raw = rule.fields.map(key => data[key]).find(value => typeof value === 'number');
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : rule.fallback;
  const spec = ACHIEVEMENT_FAMILY_BY_ID.get(family);
  if (!spec) return [];
  const metric = spec.metric;

  if (e.kind === 'unitDestroyed') {
    return resolveUnitDestroyedEvents(e, data, family, metric, value, resolvePlayerId);
  }
  if (e.kind === 'truceEnded') {
    return resolveTruceEndedEvents(e, data, family, metric, value, resolvePlayerId);
  }

  const colonyId =
    (typeof data.colonyId === 'string' && data.colonyId) ||
    (typeof e.colonyIds?.[0] === 'string' && e.colonyIds[0]) ||
    '';
  const playerId =
    (typeof data.playerId === 'string' && data.playerId) ||
    (colonyId && resolvePlayerId ? resolvePlayerId(colonyId) : undefined) ||
    '';
  if (!playerId || !colonyId) return [];

  return [{
    playerId,
    colonyId,
    planetId: e.planetId,
    atTick: e.tick ?? 0,
    eventId: progressEventId(e),
    family,
    metric,
    value,
  }];
}

/** Maps a `planet.event` payload to a `ProgressEventV1` when it corresponds to an achievement family. */
export function planetEventToProgress(
  e: PlanetEventV1,
  resolvePlayerId?: (colonyId: string) => string | undefined,
): ProgressEventV1 | null {
  return planetEventToProgressEvents(e, resolvePlayerId)[0] ?? null;
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
        async (ev) => {
          const progs = planetEventToProgressEvents(ev, (cid) => this.homeRepo?.findCachedColonyById(cid)?.playerId);
          for (const prog of progs) {
            if (this.checkpoint?.enabled) this.checkpoint.stage(prog);
            else await this.applyProgressEvent(prog);
          }
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
