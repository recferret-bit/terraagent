import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SimEvent } from '@terra/sim';
import type { Logger } from 'pino';
import type {
  BatchedColonyFoundedEvent,
  BatchedObstacleRemovedEvent,
  BatchedTilePreparedEvent,
  PlanetEventV1,
} from '../bus/channels';
import { EventBus } from '../bus/event-bus';
import { HomeRepository } from '../core/home/home.repository';
import { LOGGER } from '../core/tokens';
import { isProgressionEventKind, PROGRESSION_ACHIEVEMENTS, type ProgressionKind } from './progression-achievements';

export { isProgressionEventKind } from './progression-achievements';

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

/** Called for a progression event whose colony or player cannot be resolved: it is skipped, never guessed (BE-22). */
export type UnresolvedHandler = (event: SimEvent) => void;

interface Who { readonly colonyId: string; readonly playerId: string }
type Fields = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
/** Drops undefined fields so optional ones stay absent. */
const defined = (f: Fields): Fields => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));

/** The event's colony and player: `data.playerId`, else the resolver; null when either is unknown. */
function resolveWho(e: SimEvent, resolvePlayerId?: PlayerIdResolver): Who | null {
  const data = (e.data ?? {}) as Fields;
  const colonyId = nonEmpty(data.colonyId) ?? nonEmpty(e.colonyIds?.[0]);
  if (!colonyId) return null;
  const playerId = nonEmpty(data.playerId) ?? resolvePlayerId?.(colonyId);
  return playerId ? { colonyId, playerId } : null;
}

/** A batched progression event: `fields` both at the top level and in `data`, plus the kind's achievement. */
function toEvent(kind: ProgressionKind, planetId: string, tick: number, who: Who, fields: Fields): ProgressionEvent {
  const payload = { ...who, ...defined(fields), achievement: PROGRESSION_ACHIEVEMENTS[kind] };
  return { planetId, tick, kind, severity: 'info', colonyIds: [who.colonyId], ...payload, data: payload } as unknown as ProgressionEvent;
}

/** How a counted kind groups its events: extra key fields (e.g. `op`) beyond (colony, player). */
const COUNT_KEYS: Readonly<Record<'tilePrepared' | 'obstacleRemoved', (data: Fields) => Fields>> = {
  tilePrepared: () => ({}),
  obstacleRemoved: (data) => ({ op: data.op === 'break' ? 'break' : 'clear' }),
};

/**
 * One step's events of a counted kind summed per (colony, player, key fields): `count` adds up (default 1 per event),
 * `q`/`r` are the last tile's (XC-09: one aggregator for every counted kind).
 */
function aggregateCounts(
  kind: 'tilePrepared' | 'obstacleRemoved', planetId: string, events: readonly SimEvent[], resolvePlayerId?: PlayerIdResolver, onUnresolved?: UnresolvedHandler,
): ProgressionEvent[] {
  const acc = new Map<string, { tick: number; who: Who; key: Fields; count: number; q?: number; r?: number }>();
  for (const e of events) {
    if (e.kind !== kind) continue;
    const who = resolveWho(e, resolvePlayerId);
    if (!who) { onUnresolved?.(e); continue; }
    const data = (e.data ?? {}) as Fields;
    const key = COUNT_KEYS[kind](data);
    const id = JSON.stringify([who.colonyId, who.playerId, key]);
    const a = acc.get(id) ?? { tick: e.atTick ?? 0, who, key, count: 0 };
    a.count += typeof data.count === 'number' && data.count > 0 ? Math.floor(data.count) : 1;
    a.q = num(data.q) ?? a.q;
    a.r = num(data.r) ?? a.r;
    acc.set(id, a);
  }
  return [...acc.values()].map((a) => toEvent(kind, planetId, a.tick, a.who, { ...a.key, count: a.count, q: a.q, r: a.r }));
}

/** `colonyFounded` events are forwarded one by one (they are not counted). */
function forwardFoundings(planetId: string, events: readonly SimEvent[], resolvePlayerId?: PlayerIdResolver, onUnresolved?: UnresolvedHandler): ProgressionEvent[] {
  const out: ProgressionEvent[] = [];
  for (const e of events) {
    if (e.kind !== 'colonyFounded') continue;
    const who = resolveWho(e, resolvePlayerId);
    if (!who) { onUnresolved?.(e); continue; }
    const data = (e.data ?? {}) as Fields;
    out.push(toEvent('colonyFounded', planetId, e.atTick ?? 0, who, { hubId: num(data.hubId), q: num(data.q), r: num(data.r) }));
  }
  return out;
}

/**
 * Batches progression events within each simulation step (by tick) for a planet:
 *  - `tilePrepared`: summed per (colonyId, playerId) (Groundbreaker)
 *  - `obstacleRemoved`: summed per (colonyId, playerId, op) (Stone Mason)
 *  - `colonyFounded`: forwarded with hubId, q, r (Landfall)
 * An event whose colony or player cannot be resolved is skipped (`onUnresolved`).
 */
export function batchProgressionEventsForStep(
  planetId: string,
  events: readonly SimEvent[],
  resolvePlayerId?: PlayerIdResolver,
  onUnresolved?: UnresolvedHandler,
): BatchedProgressionEventsList {
  const byTick = new Map<number, SimEvent[]>();
  for (const e of events) {
    if (!isProgressionEventKind(e.kind)) continue;
    const tick = e.atTick ?? 0;
    byTick.set(tick, [...(byTick.get(tick) ?? []), e]);
  }
  const prepared: ProgressionEvent[] = [];
  const obstacles: ProgressionEvent[] = [];
  const foundings: ProgressionEvent[] = [];
  for (const t of [...byTick.keys()].sort((a, b) => a - b)) {
    const list = byTick.get(t) ?? [];
    prepared.push(...aggregateCounts('tilePrepared', planetId, list, resolvePlayerId, onUnresolved));
    obstacles.push(...aggregateCounts('obstacleRemoved', planetId, list, resolvePlayerId, onUnresolved));
    foundings.push(...forwardFoundings(planetId, list, resolvePlayerId, onUnresolved));
  }
  const all: ProgressionEvent[] = [...prepared, ...obstacles, ...foundings];
  return Object.assign(all, {
    tilePrepared: prepared as BatchedTilePreparedEvent[],
    obstacleRemoved: obstacles as BatchedObstacleRemovedEvent[],
    colonyFounded: foundings as BatchedColonyFoundedEvent[],
    all,
  });
}

/**
 * Batches per-step simulation progression events and publishes each batch once on the bus as `planet.event`. The player
 * comes from the event, a colony registered at seating, or the colony cache of `HomeRepository`; an event without one is
 * skipped with a warning.
 */
@Injectable()
export class ProgressionEventForwarder {
  private readonly colonyPlayerMap = new Map<string, string>();

  constructor(
    private readonly bus: EventBus,
    @Optional() private readonly homeRepo?: HomeRepository,
    @Optional() @Inject(LOGGER) private readonly log?: Pick<Logger, 'warn'>,
  ) {}

  registerColony(colonyId: string, playerId: string): void {
    this.colonyPlayerMap.set(colonyId, playerId);
  }

  /** Forgets a colony registered by {@link registerColony} (its seat was rolled back: the landing was rejected). */
  unregisterColony(colonyId: string): void {
    this.colonyPlayerMap.delete(colonyId);
  }

  resolvePlayerId(colonyId: string): string | undefined {
    return this.colonyPlayerMap.get(colonyId) ?? this.homeRepo?.findCachedColonyById(colonyId)?.playerId;
  }

  forwardStep(planetId: string, events: readonly SimEvent[]): BatchedProgressionEventsList {
    const batched = batchProgressionEventsForStep(planetId, events, (c) => this.resolvePlayerId(c), (e) => {
      this.log?.warn({ planetId, kind: e.kind, colonyIds: e.colonyIds, tick: e.atTick }, `progression event ${e.kind} skipped: its player is unknown`);
    });
    for (const ev of batched) this.publish(ev);
    return batched;
  }

  publish(event: ProgressionEvent): void {
    this.bus.emit('planet.event', event as unknown as PlanetEventV1);
  }
}
