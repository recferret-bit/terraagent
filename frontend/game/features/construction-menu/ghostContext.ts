import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, hexIndex, type CompiledDataLike, type PlacementWorld, type ViewEntity } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { FeatureStore, GameView } from '../../core/registry/types';
import { forEachEntity } from '../../store/replica/viewCodec';
import { viewPlacementWorld, viewQueueEntries } from '../shared/placementWorld';

/** A building row as the ghost reads it (label, footprint, deposit rule). */
export interface BuildingRowMeta {
  label: string;
  footprintW: number;
  footprintD: number;
  requiresDeposit?: string;
}

/**
 * Everything a ghost evaluation reads that does not depend on the site: built once per evaluation, or once per
 * auto-site search (`findValidPlacementSite` scores ~330 sites; rebuilding the data tables, the entity occupancy and the
 * sim's `PlacementWorld` per site made one card click cost ~100 ms).
 */
export interface GhostContext {
  data: CompiledDataLike;
  hIndex: { indexOf(q: number, r: number): number };
  radius: number;
  occupied: ReadonlySet<number>;
  world: PlacementWorld;
}

function toFlagSet(flags: ReadonlySet<string> | FlagSet): FlagSet {
  if ('spec' in flags && 'list' in flags && typeof flags.has === 'function') return flags as FlagSet;
  const set = flags as ReadonlySet<string>;
  const list = Array.from(set);
  return { has: (w: string) => set.has(w), list, spec: list.join(',') };
}

let lastCompiled: { spec: string; data: CompiledDataLike } | null = null;

/**
 * The balance data the ghost judges with: the replica's (`store.simData()`, compiled with the planet's balance
 * overrides, D-35, like the host), else the client flags' tables (compiled once per flag set; the tables are immutable).
 */
export function ghostData(flags: ReadonlySet<string> | FlagSet, store?: FeatureStore | null): CompiledDataLike {
  const fromStore = store?.simData?.();
  if (fromStore) return fromStore;
  const fs = toFlagSet(flags);
  if (lastCompiled?.spec !== fs.spec) lastCompiled = { spec: fs.spec, data: clientDataFor(fs) };
  return lastCompiled.data;
}

const DEFAULT_LABELS: Record<string, string> = {
  commandHub: 'Command Hub',
  metalsExtractor: 'Resource Extractor',
  solar: 'Solar Collector Array',
  pylon: 'Power Pylon',
  capacitor: 'Capacitor Bank',
  wind: 'Wind Turbine',
  thermal: 'Thermal Plant',
  supplyDepot: 'Supply Depot',
  mineralsQuarry: 'Minerals Quarry',
  waterExtractor: 'Water Extractor',
  petroleumWell: 'Petroleum Well',
  tradeHub: 'Inter-Colony Trade Hub',
};

const TWO_BY_TWO_KINDS = new Set<number>([
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
]);

export function resolveBuildingMeta(data: CompiledDataLike, building: string): BuildingRowMeta {
  const tables = (data as { tables?: Record<string, Record<string, unknown> | undefined> }).tables ?? {};
  let row: Record<string, unknown> | undefined;
  if (building === 'tradeHub') {
    row = tables['tradeHub']?.['t1'] as Record<string, unknown> | undefined;
  }
  if (!row) {
    for (const table of Object.values(tables)) {
      if (!table) continue;
      for (const r of Object.values(table) as Array<Record<string, unknown> | undefined>) {
        if (r && (r.building === building || r.id === building)) { row = r; break; }
      }
      if (row) break;
    }
  }
  const label = typeof row?.label === 'string' ? row.label : (DEFAULT_LABELS[building] ?? building);
  const defFp = building === 'commandHub' ? 3 : building === 'pylon' ? 1 : 2;
  const footprintW = typeof row?.footprintW === 'number' ? row.footprintW : defFp;
  const footprintD = typeof row?.footprintD === 'number' ? row.footprintD : defFp;
  const fallbackDep =
    building === 'metalsExtractor'
      ? 'metals'
      : building === 'mineralsQuarry' || building === 'quarry'
        ? 'minerals'
        : building === 'petroleumWell' || building === 'oilWell'
          ? 'oil'
          : undefined;
  const requiresDeposit = typeof row?.requiresDeposit === 'string' ? row.requiresDeposit : fallbackDep;
  return { label, footprintW, footprintD, requiresDeposit };
}

export function getPlanetRadius(view?: GameView): number {
  if (!view) return 56;
  const v = view as { planet?: { radius?: number }; tiles?: { count?: number } };
  if (typeof v.planet?.radius === 'number' && v.planet.radius > 0) return v.planet.radius;
  if (typeof v.tiles?.count === 'number' && v.tiles.count > 0) {
    return Math.round((-3 + Math.sqrt(Math.max(0, 12 * v.tiles.count - 3))) / 6);
  }
  return 56;
}

function markFootprintIndices(occupied: Set<number>, hIndex: { indexOf(q: number, r: number): number }, q: number, r: number, w: number, d: number, rot = 0): void {
  const swap = (((Math.round(rot) % 6) + 6) % 2) !== 0;
  const fw = swap ? d : w, fd = swap ? w : d;
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const idx = hIndex.indexOf(q + minQ + dq, r + minR + dr);
      if (idx >= 0) occupied.add(idx);
    }
  }
}


function collectOccupiedTileIndices(view: GameView | undefined, hIndex: { indexOf(q: number, r: number): number }): Set<number> {
  const occupied = new Set<number>();
  if (!view) return occupied;
  const v = view as { entities?: Float32Array | readonly ViewEntity[]; count?: number };
  // Occupancy comes from the buildings themselves; the `anchors` tile layer is the territory claim count, not "occupied".
  if (v.entities) {
    forEachEntity(v.entities, v.count, (e) => {
      if (e.hpMax > 0 && e.hp <= 0) return;
      const size = e.kind === ENTITY_KIND.commandHub
        ? 3
        : (TWO_BY_TWO_KINDS.has(e.kind) ? 2 : (e.kind === ENTITY_KIND.pylon || e.kind === ENTITY_KIND.pod ? 1 : 0));
      if (size > 0) markFootprintIndices(occupied, hIndex, e.q, e.r, size, size, e.rot);
    });
  }
  for (const entry of viewQueueEntries(view)) {
    if (!entry || entry.state === 'done' || entry.state === 'cancelled') continue;
    const t = entry.task;
    if (t?.kind === 'build' && typeof t.q === 'number' && typeof t.r === 'number') {
      const sz = t.building === 'commandHub' ? 3 : t.building === 'pylon' ? 1 : 2;
      markFootprintIndices(occupied, hIndex, t.q, t.r, sz, sz, t.rotation ?? 0);
    }
  }
  return occupied;
}

/** The site-independent part of a ghost evaluation on `view` (see `GhostContext`). */
export function buildGhostContext(flags: ReadonlySet<string> | FlagSet, view: GameView | undefined, store?: FeatureStore | null): GhostContext {
  const radius = getPlanetRadius(view);
  const hIndex = hexIndex(radius);
  return {
    data: ghostData(flags, store),
    hIndex,
    radius,
    occupied: collectOccupiedTileIndices(view, hIndex),
    world: viewPlacementWorld(view),
  };
}
