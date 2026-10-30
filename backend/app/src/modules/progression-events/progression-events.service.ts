import { Injectable, Optional } from '@nestjs/common';
import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import {
  buildingKindName,
  ensureColonyLedger,
  ENTITY_STATE,
  type ColonyState,
  type PlanetState,
  type SimEvent,
  type StepContext,
  type StepResult,
} from '@terra/sim';
import { EventBus, type PlanetEventOf } from '../../bus/bus.module';

export const WINDOW_S = 60;
export const TICKS_PER_WINDOW = 300; // 60s at 5 TPS (TICK_MS = 200)

export interface BuildingCompletedEvent {
  readonly entityId: number;
  readonly building: string;
  readonly kind?: string;
  readonly tier?: number;
  readonly q: number;
  readonly r: number;
  readonly playerId?: string;
  readonly colonyId?: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly tick: number;
}

export interface ResourceProducedEvent {
  readonly res: ResourceKey;
  readonly amount: number;
  readonly windowS: number;
  readonly playerId?: string;
  readonly colonyId?: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly tick: number;
}

declare module '../../bus/channels' {
  interface BusChannels {
    readonly buildingCompleted: BuildingCompletedEvent;
    readonly resourceProduced: ResourceProducedEvent;
    readonly 'progression.buildingCompleted': BuildingCompletedEvent;
    readonly 'progression.resourceProduced': ResourceProducedEvent;
  }
}

interface ColonyWindowTracking {
  windowStartTick: number;
  windowStartProduced: Record<ResourceKey, number>;
}

interface PlanetTracking {
  readonly colonies: Map<number, ColonyWindowTracking>;
  readonly constructingEntities: Set<number>;
  readonly completedEntities: Set<number>;
}

function roundAmount(val: number): number {
  const rounded = Math.round(val * 10_000) / 10_000;
  return Math.abs(rounded - Math.round(rounded)) < 1e-6 ? Math.round(rounded) : rounded;
}

/**
 * Bridges simulation progression events (Architect building completions and Stockpile
 * per-60s aggregated resource production batches) onto the server EventBus (UO-PB-01, W02-28).
 */
@Injectable()
export class ProgressionEventsService {
  private readonly planets = new Map<string, PlanetTracking>();

  constructor(@Optional() private readonly defaultBus?: EventBus) {}

  /** Resets tracking for a given planet or all planets. */
  reset(planetId?: string): void {
    if (planetId) this.planets.delete(planetId);
    else this.planets.clear();
  }

  /** Explicitly configures the window start tick and baseline produced amounts for a colony. */
  resetWindow(
    planetId: string,
    colonyIndex: number,
    tick: number,
    produced?: Partial<Record<ResourceKey, number>>,
  ): void {
    const pt = this.getPlanetTracking(planetId);
    const windowStartProduced = {} as Record<ResourceKey, number>;
    for (const res of RESOURCE_KEYS) {
      windowStartProduced[res] = produced?.[res] ?? 0;
    }
    pt.colonies.set(colonyIndex, { windowStartTick: tick, windowStartProduced });
  }

  /**
   * Main integration hook: inspects a step result and planet state, emitting buildingCompleted
   * and 60s resourceProduced batches onto the server event bus.
   */
  processSimStep(
    planetId: string,
    state: PlanetState,
    stepResult?: StepResult | null,
    eventBus?: EventBus,
    ctx?: StepContext,
  ): void {
    const bus = eventBus ?? this.defaultBus;
    this.detectCompletedEvents(planetId, state, stepResult, bus);
    this.detectCompletedTransitions(planetId, state, bus);
    this.recordProductionStep(planetId, state, state.meta.tick, bus, ctx, stepResult);
  }

  /**
   * Records a buildingCompleted event directly and publishes it to the event bus.
   */
  recordBuildingCompleted(
    event: BuildingCompletedEvent | SimEvent,
    planetId?: string,
    state?: PlanetState,
    eventBus?: EventBus,
  ): void {
    const bus = eventBus ?? this.defaultBus;
    if ('building' in event && 'entityId' in event && 'planetId' in event) {
      this.emitBuildingCompleted(event as BuildingCompletedEvent, bus);
      return;
    }
    const simEv = event as SimEvent;
    const pId = planetId ?? state?.meta.planetId ?? 'unknown';
    const tick = simEv.atTick ?? state?.meta.tick ?? 0;
    const d = simEv.data as Record<string, unknown>;
    const entityId = Number(d.entityId);
    const bName = String(d.building ?? d.kind ?? 'building');
    const colonyIndex = this.resolveColonyIndex(state, d, simEv.colonyIds);
    const colony = state?.colonies[colonyIndex];

    const payload: BuildingCompletedEvent = {
      entityId,
      building: bName,
      kind: String(d.kind ?? bName),
      tier: d.tier !== undefined ? Number(d.tier) : 1,
      q: Number(d.q ?? 0),
      r: Number(d.r ?? 0),
      playerId: d.playerId !== undefined ? String(d.playerId) : colony?.id,
      colonyId: d.colonyId !== undefined ? String(d.colonyId) : (colony?.id ?? String(colonyIndex)),
      planetId: pId,
      colonyIndex,
      tick,
    };
    this.emitBuildingCompleted(payload, bus);
  }

  /**
   * Evaluates colony production progress for the given planet and emits resourceProduced
   * batches for each colony with amount > 0 accumulated across the 60s (300-tick) window.
   */
  recordProductionStep(
    planetId: string,
    state: PlanetState,
    tick?: number,
    eventBus?: EventBus,
    ctx?: StepContext,
    stepResult?: StepResult | null,
  ): void {
    const bus = eventBus ?? this.defaultBus;
    const currentTick = tick ?? state.meta.tick;
    const pt = this.getPlanetTracking(planetId);

    for (const colony of state.colonies) {
      if (!colony) continue;
      let colTrack = pt.colonies.get(colony.index);
      if (!colTrack) {
        colTrack = this.initColonyTracking(colony, currentTick);
        pt.colonies.set(colony.index, colTrack);
      }

      const cLedger = ensureColonyLedger(colony);
      const hasAnyProduction = RESOURCE_KEYS.some(
        (res) => (cLedger.production?.produced?.[res] ?? 0) > (colTrack.windowStartProduced[res] ?? 0),
      );

      // If no resources have been produced yet in this window, shift window start to current tick
      if (!hasAnyProduction && currentTick - colTrack.windowStartTick < TICKS_PER_WINDOW) {
        colTrack.windowStartTick = currentTick;
        for (const res of RESOURCE_KEYS) {
          colTrack.windowStartProduced[res] = cLedger.production?.produced?.[res] ?? 0;
        }
        continue;
      }

      while (currentTick - colTrack.windowStartTick >= TICKS_PER_WINDOW) {
        for (const res of RESOURCE_KEYS) {
          const currentProduced = cLedger.production?.produced?.[res] ?? 0;
          const prevProduced = colTrack.windowStartProduced[res] ?? 0;
          const delta = roundAmount(currentProduced - prevProduced);
          if (delta > 0) {
            const payload: ResourceProducedEvent = {
              res,
              amount: delta,
              windowS: WINDOW_S,
              playerId: colony.id,
              colonyId: colony.id,
              planetId,
              colonyIndex: colony.index,
              tick: currentTick,
            };
            this.emitResourceProduced(payload, bus, ctx, stepResult);
          }
          colTrack.windowStartProduced[res] = currentProduced;
        }
        colTrack.windowStartTick += TICKS_PER_WINDOW;
      }
    }
  }

  /** Attaches to a GamePlanets event stream to bridge events automatically. */
  attach(
    planets: { onEvents: (l: (planetId: string, events: readonly SimEvent[]) => void) => () => void },
    bus?: EventBus,
  ): () => void {
    const targetBus = bus ?? this.defaultBus;
    return planets.onEvents((planetId, events) => {
      for (const e of events) {
        if (e.kind === 'buildingCompleted') {
          this.recordBuildingCompleted(e, planetId, undefined, targetBus);
        }
      }
    });
  }

  private getPlanetTracking(planetId: string): PlanetTracking {
    let pt = this.planets.get(planetId);
    if (!pt) {
      pt = { colonies: new Map(), constructingEntities: new Set(), completedEntities: new Set() };
      this.planets.set(planetId, pt);
    }
    return pt;
  }

  private initColonyTracking(colony: ColonyState, currentTick: number): ColonyWindowTracking {
    const windowStartTick =
      currentTick >= TICKS_PER_WINDOW && currentTick % TICKS_PER_WINDOW === 0
        ? currentTick - TICKS_PER_WINDOW
        : Math.floor(currentTick / TICKS_PER_WINDOW) * TICKS_PER_WINDOW;
    const cLedger = ensureColonyLedger(colony);
    const windowStartProduced = {} as Record<ResourceKey, number>;
    for (const res of RESOURCE_KEYS) {
      windowStartProduced[res] =
        windowStartTick === 0 && currentTick >= TICKS_PER_WINDOW
          ? 0
          : (cLedger.production?.produced?.[res] ?? 0);
    }
    return { windowStartTick, windowStartProduced };
  }

  private resolveColonyIndex(
    state: PlanetState | undefined,
    data: Record<string, unknown>,
    colonyIds: readonly (string | number)[] = [],
  ): number {
    if (data.colonyIndex !== undefined) return Number(data.colonyIndex);
    const id = data.colonyId ?? data.playerId ?? colonyIds[0];
    if (typeof id === 'number') return id;
    if (state && typeof id === 'string') {
      const found = state.colonies.findIndex((c) => c?.id === id);
      if (found >= 0) return found;
      const num = Number.parseInt(id, 10);
      if (Number.isFinite(num) && state.colonies[num]) return num;
    }
    return 0;
  }

  private detectCompletedEvents(
    planetId: string,
    state: PlanetState,
    stepResult: StepResult | null | undefined,
    bus: EventBus | undefined,
  ): void {
    if (!stepResult?.events?.length) return;
    const pt = this.getPlanetTracking(planetId);
    for (const e of stepResult.events) {
      if (e.kind !== 'buildingCompleted') continue;
      const d = (e.data ?? {}) as Record<string, unknown>;
      const entityId = Number(d.entityId);
      if (pt.completedEntities.has(entityId)) continue;
      pt.completedEntities.add(entityId);
      pt.constructingEntities.delete(entityId);

      const bName = String(d.building ?? d.kind ?? 'building');
      const colonyIndex = this.resolveColonyIndex(state, d, e.colonyIds);
      const colony = state.colonies[colonyIndex];

      const payload: BuildingCompletedEvent = {
        entityId,
        building: bName,
        kind: String(d.kind ?? bName),
        tier: d.tier !== undefined ? Number(d.tier) : 1,
        q: Number(d.q ?? 0),
        r: Number(d.r ?? 0),
        playerId: d.playerId !== undefined ? String(d.playerId) : colony?.id,
        colonyId: d.colonyId !== undefined ? String(d.colonyId) : (colony?.id ?? String(colonyIndex)),
        planetId,
        colonyIndex,
        tick: e.atTick ?? state.meta.tick,
      };
      this.emitBuildingCompleted(payload, bus);
    }
  }

  private detectCompletedTransitions(
    planetId: string,
    state: PlanetState,
    bus: EventBus | undefined,
  ): void {
    const pt = this.getPlanetTracking(planetId);
    const e = state.entities;
    if (!e || !e.cols) return;
    const cols = e.cols;

    for (let row = 0; row < e.count; row++) {
      const id = cols.id[row];
      const st = cols.state[row];
      if (st === ENTITY_STATE.constructing) {
        pt.constructingEntities.add(id);
      } else if (st === ENTITY_STATE.active && pt.constructingEntities.has(id)) {
        pt.constructingEntities.delete(id);
        if (pt.completedEntities.has(id)) continue;
        pt.completedEntities.add(id);

        const bName = buildingKindName(cols.kind[row]);
        const owner = cols.owner[row];
        const colony = state.colonies[owner];

        const payload: BuildingCompletedEvent = {
          entityId: id,
          building: bName,
          kind: bName,
          tier: cols.tier ? Number(cols.tier[row]) : 1,
          q: cols.q[row],
          r: cols.r[row],
          playerId: colony?.id ?? String(owner),
          colonyId: colony?.id ?? String(owner),
          planetId,
          colonyIndex: owner,
          tick: state.meta.tick,
        };
        this.emitBuildingCompleted(payload, bus);
      }
    }
  }

  private emitBuildingCompleted(payload: BuildingCompletedEvent, bus?: EventBus): void {
    if (!bus) return;
    bus.emit('buildingCompleted', payload);
    bus.emit('progression.buildingCompleted', payload);
    bus.emit('planet.event', {
      planetId: payload.planetId,
      tick: payload.tick,
      kind: 'buildingCompleted',
      severity: 'info',
      colonyIds: [payload.colonyId ?? String(payload.colonyIndex)],
      data: {
        colonyId: payload.colonyId ?? payload.playerId ?? String(payload.colonyIndex),
        playerId: payload.playerId,
        entityId: payload.entityId,
        building: payload.building,
        kind: payload.kind ?? payload.building,
        tier: payload.tier ?? 1,
        q: payload.q,
        r: payload.r,
      },
    } as PlanetEventOf<'buildingCompleted'>);
  }

  private emitResourceProduced(
    payload: ResourceProducedEvent,
    bus?: EventBus,
    ctx?: StepContext,
    stepResult?: StepResult | null,
  ): void {
    const colId = payload.colonyId ?? payload.playerId ?? String(payload.colonyIndex);
    if (bus) {
      bus.emit('resourceProduced', payload);
      bus.emit('progression.resourceProduced', payload);
      bus.emit('planet.event', {
        planetId: payload.planetId,
        tick: payload.tick,
        kind: 'resourceProduced',
        severity: 'info',
        colonyIds: [colId],
        data: {
          colonyId: colId,
          playerId: payload.playerId,
          res: payload.res,
          amount: payload.amount,
        },
      } as PlanetEventOf<'resourceProduced'>);
    }
    if (ctx?.emit) {
      ctx.emit({
        kind: 'resourceProduced',
        colonyIds: [colId],
        data: {
          colonyId: colId,
          playerId: payload.playerId,
          res: payload.res,
          amount: payload.amount,
        },
      });
    }
    if (stepResult?.events) {
      stepResult.events.push({
        kind: 'resourceProduced',
        severity: 'info',
        atTick: payload.tick,
        colonyIds: [colId],
        data: {
          colonyId: colId,
          playerId: payload.playerId,
          res: payload.res,
          amount: payload.amount,
        },
      });
    }
  }
}

export const ProgressionEventBridge = ProgressionEventsService;
export type ProgressionEventBridge = ProgressionEventsService;
