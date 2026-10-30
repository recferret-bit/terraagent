import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SimEvent } from '@terra/sim';
import type {
  BatchedColonyFoundedEvent,
  BatchedObstacleRemovedEvent,
  BatchedTilePreparedEvent,
  PlanetEventV1,
} from '../bus/channels';
import { EventBus } from '../bus/event-bus';
import { HomeRepository } from '../core/home/home.repository';

export const PROGRESSION_PLAYER_RESOLVER = Symbol('PROGRESSION_PLAYER_RESOLVER');

export type ProgressionEvent =
  | BatchedTilePreparedEvent
  | BatchedObstacleRemovedEvent
  | BatchedColonyFoundedEvent;

export interface BatchedProgressionEventsList extends Array<ProgressionEvent> {
  readonly tilePrepared: readonly BatchedTilePreparedEvent[];
  readonly obstacleRemoved: readonly BatchedObstacleRemovedEvent[];
  readonly colonyFounded: readonly BatchedColonyFoundedEvent[];
  readonly all: readonly ProgressionEvent[];
}

export type PlayerIdResolver = (colonyId: string) => string | undefined;

/** Checks whether `kind` is one of the three Landfall progression event kinds. */
export function isProgressionEventKind(kind: string): boolean {
  return kind === 'tilePrepared' || kind === 'obstacleRemoved' || kind === 'colonyFounded';
}

function resolvePlayer(
  rawColonyId: unknown,
  rawPlayerId: unknown,
  resolvePlayerId?: PlayerIdResolver,
): { colonyId: string; playerId: string } {
  const colonyId = typeof rawColonyId === 'string' && rawColonyId.length > 0 ? rawColonyId : 'col_0';
  const resolved =
    (typeof rawPlayerId === 'string' && rawPlayerId.length > 0 ? rawPlayerId : undefined) ??
    resolvePlayerId?.(colonyId) ??
    colonyId;
  return { colonyId, playerId: resolved };
}

interface TileAccumulator {
  planetId: string;
  tick: number;
  colonyId: string;
  playerId: string;
  count: number;
  q?: number;
  r?: number;
}

interface ObstacleAccumulator {
  planetId: string;
  tick: number;
  colonyId: string;
  playerId: string;
  op: 'clear' | 'break';
  count: number;
  q?: number;
  r?: number;
}

function aggregateTileEvents(
  planetId: string,
  tickEvents: readonly SimEvent[],
  resolvePlayerId?: PlayerIdResolver,
): BatchedTilePreparedEvent[] {
  const map = new Map<string, TileAccumulator>();
  for (const e of tickEvents) {
    if (e.kind !== 'tilePrepared') continue;
    const rawData = (e.data ?? {}) as Record<string, unknown>;
    const { colonyId, playerId } = resolvePlayer(rawData.colonyId ?? e.colonyIds?.[0], rawData.playerId, resolvePlayerId);
    const key = `${colonyId}\0${playerId}`;
    const rawCount = typeof rawData.count === 'number' && rawData.count > 0 ? Math.floor(rawData.count) : 1;
    const acc = map.get(key) ?? {
      planetId,
      tick: e.atTick ?? 0,
      colonyId,
      playerId,
      count: 0,
      q: typeof rawData.q === 'number' ? rawData.q : undefined,
      r: typeof rawData.r === 'number' ? rawData.r : undefined,
    };
    acc.count += rawCount;
    if (typeof rawData.q === 'number') acc.q = rawData.q;
    if (typeof rawData.r === 'number') acc.r = rawData.r;
    map.set(key, acc);
  }

  return [...map.values()].map((acc) => ({
    planetId: acc.planetId,
    tick: acc.tick,
    kind: 'tilePrepared' as const,
    severity: 'info' as const,
    colonyIds: [acc.colonyId],
    colonyId: acc.colonyId,
    playerId: acc.playerId,
    count: acc.count,
    ...(acc.q !== undefined ? { q: acc.q } : {}),
    ...(acc.r !== undefined ? { r: acc.r } : {}),
    achievement: 'Groundbreaker',
    data: {
      colonyId: acc.colonyId,
      playerId: acc.playerId,
      count: acc.count,
      ...(acc.q !== undefined ? { q: acc.q } : {}),
      ...(acc.r !== undefined ? { r: acc.r } : {}),
      achievement: 'Groundbreaker',
    },
  }));
}

function aggregateObstacleEvents(
  planetId: string,
  tickEvents: readonly SimEvent[],
  resolvePlayerId?: PlayerIdResolver,
): BatchedObstacleRemovedEvent[] {
  const map = new Map<string, ObstacleAccumulator>();
  for (const e of tickEvents) {
    if (e.kind !== 'obstacleRemoved') continue;
    const rawData = (e.data ?? {}) as Record<string, unknown>;
    const { colonyId, playerId } = resolvePlayer(rawData.colonyId ?? e.colonyIds?.[0], rawData.playerId, resolvePlayerId);
    const op: 'clear' | 'break' = rawData.op === 'break' ? 'break' : 'clear';
    const key = `${colonyId}\0${playerId}\0${op}`;
    const rawCount = typeof rawData.count === 'number' && rawData.count > 0 ? Math.floor(rawData.count) : 1;
    const acc = map.get(key) ?? {
      planetId,
      tick: e.atTick ?? 0,
      colonyId,
      playerId,
      op,
      count: 0,
      q: typeof rawData.q === 'number' ? rawData.q : undefined,
      r: typeof rawData.r === 'number' ? rawData.r : undefined,
    };
    acc.count += rawCount;
    if (typeof rawData.q === 'number') acc.q = rawData.q;
    if (typeof rawData.r === 'number') acc.r = rawData.r;
    map.set(key, acc);
  }

  return [...map.values()].map((acc) => ({
    planetId: acc.planetId,
    tick: acc.tick,
    kind: 'obstacleRemoved' as const,
    severity: 'info' as const,
    colonyIds: [acc.colonyId],
    colonyId: acc.colonyId,
    playerId: acc.playerId,
    op: acc.op,
    count: acc.count,
    ...(acc.q !== undefined ? { q: acc.q } : {}),
    ...(acc.r !== undefined ? { r: acc.r } : {}),
    achievement: 'Stone Mason',
    data: {
      colonyId: acc.colonyId,
      playerId: acc.playerId,
      op: acc.op,
      count: acc.count,
      ...(acc.q !== undefined ? { q: acc.q } : {}),
      ...(acc.r !== undefined ? { r: acc.r } : {}),
      achievement: 'Stone Mason',
    },
  }));
}

function forwardColonyFoundedEvents(
  planetId: string,
  tickEvents: readonly SimEvent[],
  resolvePlayerId?: PlayerIdResolver,
): BatchedColonyFoundedEvent[] {
  const result: BatchedColonyFoundedEvent[] = [];
  for (const e of tickEvents) {
    if (e.kind !== 'colonyFounded') continue;
    const rawData = (e.data ?? {}) as Record<string, unknown>;
    const { colonyId, playerId } = resolvePlayer(rawData.colonyId ?? e.colonyIds?.[0], rawData.playerId, resolvePlayerId);
    const hubId = typeof rawData.hubId === 'number' ? rawData.hubId : undefined;
    const q = typeof rawData.q === 'number' ? rawData.q : undefined;
    const r = typeof rawData.r === 'number' ? rawData.r : undefined;
    result.push({
      planetId,
      tick: e.atTick ?? 0,
      kind: 'colonyFounded' as const,
      severity: 'info' as const,
      colonyIds: [colonyId],
      colonyId,
      playerId,
      ...(hubId !== undefined ? { hubId } : {}),
      ...(q !== undefined ? { q } : {}),
      ...(r !== undefined ? { r } : {}),
      achievement: 'Landfall',
      data: {
        colonyId,
        playerId,
        ...(hubId !== undefined ? { hubId } : {}),
        ...(q !== undefined ? { q } : {}),
        ...(r !== undefined ? { r } : {}),
        achievement: 'Landfall',
      },
    });
  }
  return result;
}

/**
 * Batches progression events within each simulation step (by tick) for a planet:
 *  - `tilePrepared`: aggregated by (colonyId, playerId) with summed `count` (Groundbreaker)
 *  - `obstacleRemoved`: aggregated by (colonyId, playerId, op) with summed `count` (Stone Mason)
 *  - `colonyFounded`: forwarded carrying playerId, colonyId, planetId, q, r, achievement: 'Landfall'
 */
export function batchProgressionEventsForStep(
  planetId: string,
  events: readonly SimEvent[],
  resolvePlayerId?: PlayerIdResolver,
): BatchedProgressionEventsList {
  const ticksMap = new Map<number, SimEvent[]>();
  for (const e of events) {
    if (!isProgressionEventKind(e.kind)) continue;
    const tick = e.atTick ?? 0;
    const list = ticksMap.get(tick) ?? [];
    list.push(e);
    ticksMap.set(tick, list);
  }

  const allPrepared: BatchedTilePreparedEvent[] = [];
  const allObstacles: BatchedObstacleRemovedEvent[] = [];
  const allFoundings: BatchedColonyFoundedEvent[] = [];

  const sortedTicks = [...ticksMap.keys()].sort((a, b) => a - b);
  for (const t of sortedTicks) {
    const list = ticksMap.get(t) ?? [];
    allPrepared.push(...aggregateTileEvents(planetId, list, resolvePlayerId));
    allObstacles.push(...aggregateObstacleEvents(planetId, list, resolvePlayerId));
    allFoundings.push(...forwardColonyFoundedEvents(planetId, list, resolvePlayerId));
  }

  const allCombined: ProgressionEvent[] = [...allPrepared, ...allObstacles, ...allFoundings];
  return Object.assign(allCombined, {
    tilePrepared: allPrepared,
    obstacleRemoved: allObstacles,
    colonyFounded: allFoundings,
    all: allCombined,
  });
}

/**
 * Service that batches per-step simulation progression events and forwards them onto the EventBus.
 */
@Injectable()
export class ProgressionEventForwarder {
  private readonly colonyPlayerMap = new Map<string, string>();
  private customResolver?: PlayerIdResolver;

  constructor(
    private readonly bus: EventBus,
    @Optional() private readonly homeRepo?: HomeRepository,
    @Optional() @Inject(PROGRESSION_PLAYER_RESOLVER) resolver?: PlayerIdResolver,
  ) {
    this.customResolver = resolver;
  }

  setCustomResolver(resolver: PlayerIdResolver): this {
    this.customResolver = resolver;
    return this;
  }

  registerColony(colonyId: string, playerId: string): void {
    this.colonyPlayerMap.set(colonyId, playerId);
  }

  resolvePlayerId(colonyId: string): string | undefined {
    if (this.customResolver) {
      const custom = this.customResolver(colonyId);
      if (custom) return custom;
    }
    const cached = this.colonyPlayerMap.get(colonyId);
    if (cached) return cached;
    if (this.homeRepo) {
      const col = this.homeRepo.findMemColonyById(colonyId);
      if (col?.playerId) return col.playerId;
    }
    return undefined;
  }

  forwardStep(
    planetId: string,
    events: readonly SimEvent[],
    resolvePlayerId?: PlayerIdResolver,
  ): BatchedProgressionEventsList {
    const resolver: PlayerIdResolver = (colonyId: string) =>
      resolvePlayerId?.(colonyId) ?? this.resolvePlayerId(colonyId);
    const batched = batchProgressionEventsForStep(planetId, events, resolver);
    for (const ev of batched) {
      this.publish(ev);
    }
    return batched;
  }

  publish(event: ProgressionEvent): void {
    this.bus.emit(event.kind, event as never);
    this.bus.emit(`progression.${event.kind}` as never, event as never);
    this.bus.emit('planet.event', {
      planetId: event.planetId,
      tick: event.tick,
      kind: event.kind,
      severity: event.severity,
      colonyIds: event.colonyIds,
      colonyId: event.colonyId,
      playerId: event.playerId,
      achievement: event.achievement,
      ...('count' in event ? { count: event.count } : {}),
      ...('op' in event ? { op: event.op } : {}),
      ...('hubId' in event && event.hubId !== undefined ? { hubId: event.hubId } : {}),
      ...('q' in event && event.q !== undefined ? { q: event.q } : {}),
      ...('r' in event && event.r !== undefined ? { r: event.r } : {}),
      data: event.data,
    } as unknown as PlanetEventV1);
  }

  wireSimHost(
    host: {
      onEvents: (cb: (events: readonly SimEvent[], tick: number) => void) => () => void;
      state?: { meta?: { planetId?: string }; colonies?: Array<{ id?: string; index?: number; playerId?: string }> };
    },
    planetId?: string,
  ): () => void {
    const pid = planetId ?? host.state?.meta?.planetId ?? 'pl_dev';
    return host.onEvents((events) => {
      this.forwardStep(pid, events, (colId) => {
        const col = host.state?.colonies?.find((c) => c.id === colId || `col_${c.index}` === colId);
        return (typeof col?.playerId === 'string' ? col.playerId : undefined) ?? this.resolvePlayerId(colId);
      });
    });
  }

  wireGamePlanets(planets: { onEvents: (l: (planetId: string, events: readonly SimEvent[]) => void) => () => void }): () => void {
    return planets.onEvents((planetId, events) => {
      this.forwardStep(planetId, events);
    });
  }
}

/** Convenience helper to wire a SimHost to an EventBus via a ProgressionEventForwarder. */
export function wireProgressionEvents(
  host: {
    onEvents: (cb: (events: readonly SimEvent[], tick: number) => void) => () => void;
    state?: { meta?: { planetId?: string }; colonies?: Array<{ id?: string; index?: number; playerId?: string }> };
  },
  bus: EventBus,
  resolvePlayerId?: PlayerIdResolver,
): () => void {
  const forwarder = new ProgressionEventForwarder(bus, undefined, resolvePlayerId);
  return forwarder.wireSimHost(host);
}
