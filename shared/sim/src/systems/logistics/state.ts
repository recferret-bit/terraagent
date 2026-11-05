import type { PlanetState } from '../../kernel/state';
import { setBlob } from '../../kernel/state';

/** Blob name of the persistent logistics service state (plain data, snapshot-safe, MessagePack-able). */
export const LOGISTICS_BLOB_KEY = 'logistics';
export const FULL_SERVICE_BP = 10000;

/** Micro-units (1e-6 of a unit) per resource key. */
export type MicroMap = Record<string, number>;

export type EntityServiceStatus = 'supplied' | 'reserve' | 'grace' | 'partial' | 'unavailable';

/** Persistent per-entity state: survives windows, reconnects, group splits and toggles (keyed by stable entity id). */
export interface EntityLocal {
  /** Resources physically held by this entity (already posted `logistics.supply`), micro-units. Bounded by `localReserveBp`. */
  reserve: MicroMap;
  /** Ticks of unsupplied full operation left before throughput scales by the delivered-service ratio. */
  graceLeftTicks: number;
  /** Delivered-service ratio (bp) pinned for the current window segment. */
  ratioBp: number;
  status: EntityServiceStatus;
}

/** What the current window segment pinned for one entity. */
export interface EntityWindow {
  kind: 'building' | 'unit';
  nodeId: string | null;
  routeTiles: number | null;
  unavailable: string | null;
  /** Required inputs for this segment, micro-units. */
  need: MicroMap;
  /** Stock reserved for this segment (held until settle), micro-units. */
  held: MicroMap;
  /** Planned consumption from the held supply and from the local reserve, micro-units. */
  fromSupply: MicroMap;
  fromReserve: MicroMap;
  /** Top-up moved into the local reserve at plan time (not released at settle). */
  topup: MicroMap;
}

export interface WindowSummary { K: number; L: string; u: string | null; M: string | null }

/** One pinned supply-window segment (profile hash, load, assignment, multiplier, spend are fixed until it settles). */
export interface WindowRecord {
  /** Dedupe key `<colony>/<window>.<segment>`: entity bills append `/<entityId>`. */
  key: string;
  index: number;
  seg: number;
  startTick: number;
  endTick: number;
  dataHash: string;
  summary: WindowSummary;
  /** Every node that contributed capacity to `K`: losing one invalidates the segment. */
  nodeIds: string[];
  entities: Record<string, EntityWindow>;
}

export interface ColonyLogistics {
  window: WindowRecord | null;
  /** The last settled key: a replay of an older or equal key never plans or bills again. */
  settledKey: string;
  entities: Record<string, EntityLocal>;
}

export interface LogisticsBlob { v: 1; colonies: Record<string, ColonyLogistics> }

export function readLogistics(state: PlanetState): LogisticsBlob {
  const v = state.blobs[LOGISTICS_BLOB_KEY]?.value as LogisticsBlob | undefined;
  return v && v.v === 1 ? v : { v: 1, colonies: {} };
}

export function writeLogistics(state: PlanetState, blob: LogisticsBlob, tick: number): void {
  setBlob(state, LOGISTICS_BLOB_KEY, blob, tick);
}

export function colonyLogistics(blob: LogisticsBlob, colony: number): ColonyLogistics {
  return (blob.colonies[String(colony)] ??= { window: null, settledKey: '', entities: {} });
}

/**
 * Delivered-service ratio (bp, 0..10000) of an entity, to apply ONCE in the work path (production throughput; attack/work
 * cadence is W13-54): 10000 when logistics is off, the entity has no logistics row, or its window is fully supplied or in
 * grace.
 */
export function deliveredServiceBp(state: PlanetState, colony: number, entityId: number): number {
  const rec = readLogistics(state).colonies[String(colony)]?.entities[String(entityId)];
  return rec ? rec.ratioBp : FULL_SERVICE_BP;
}

export interface LogisticsEntityView { ratioBp: number; status: EntityServiceStatus; graceLeftTicks: number; reserve: MicroMap; nodeId: string | null; routeTiles: number | null; unavailable: string | null; need: MicroMap }
export interface LogisticsView { windowKey: string | null; summary: WindowSummary | null; entities: Record<string, LogisticsEntityView> }

/** Read model for the HUD / W13-55: pinned window summary plus every entity's service, reserve and grace. */
export function getLogisticsView(state: PlanetState, colony: number): LogisticsView {
  const c = readLogistics(state).colonies[String(colony)];
  const out: LogisticsView = { windowKey: c?.window?.key ?? null, summary: c?.window?.summary ?? null, entities: {} };
  for (const [id, e] of Object.entries(c?.entities ?? {})) {
    const w = c?.window?.entities[id];
    out.entities[id] = {
      ratioBp: e.ratioBp, status: e.status, graceLeftTicks: e.graceLeftTicks, reserve: { ...e.reserve },
      nodeId: w?.nodeId ?? null, routeTiles: w?.routeTiles ?? null, unavailable: w?.unavailable ?? null, need: { ...(w?.need ?? {}) },
    };
  }
  return out;
}

/** `rate` scaled by a delivered-service ratio; returns `rate` itself (bit-identical) at full service. */
export function serviceScaled(rate: number, bp: number): number {
  return bp >= FULL_SERVICE_BP ? rate : (rate * Math.max(0, bp)) / FULL_SERVICE_BP;
}
