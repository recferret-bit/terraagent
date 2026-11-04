import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { PlanetState } from '../../kernel/state';
import { buildingFootprints, occupiedGroundTiles } from '../construction/occupancy';
import { buildGapField, compareRank, footprintGap, laneTier, organicTarget } from '../construction/siteSpacing';
import { getConstructionOrders } from '../construction/orders';
import { evaluatePlacement } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { getFootprintTileIndices, resolveBuildingRow } from '../economy/buildingRows';
import { ensureColonyLedger } from '../economy/ledger';
import { getColonyQueue } from '../queue';
import { resolveStartingCargo } from '../landing';

export interface HexCoord {
  q: number;
  r: number;
}

/**
 * Returns the primary hex anchor `{ q, r }` for `colonyIndex`:
 * 1. Alive `commandHub`
 * 2. Alive `pod`
 * 3. Alive `hq` drone
 * 4. `{ q: 0, r: 0 }`
 */
export function findColonyAnchor(state: PlanetState, colonyIndex: number): HexCoord {
  const { count, cols } = state.entities;
  let podPos: HexCoord | null = null;
  let hqPos: HexCoord | null = null;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    const kind = cols.kind[row];
    if (kind === ENTITY_KIND.commandHub) {
      return { q: cols.q[row], r: cols.r[row] };
    }
    if (kind === ENTITY_KIND.pod && !podPos) {
      podPos = { q: cols.q[row], r: cols.r[row] };
    } else if (kind === ENTITY_KIND.hq && !hqPos) {
      hqPos = { q: cols.q[row], r: cols.r[row] };
    }
  }
  return podPos ?? hqPos ?? { q: 0, r: 0 };
}

/**
 * Collects tile indices reserved by existing buildings, open `construction` queue entries,
 * or W01 construction orders so multiple queued HQ goal buildings never pick overlapping footprints.
 */
export function collectReservedTiles(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): Set<number> {
  const reserved = new Set<number>(occupiedGroundTiles(state, data));
  const queueEntries = getColonyQueue(state, colonyIndex, 'construction');
  for (const entry of queueEntries) {
    if (entry.state === 'done' || entry.state === 'cancelled') continue;
    if (entry.task.kind !== 'build') continue;
    const resolved = resolveBuildingRow(entry.task.building, data);
    const w = Number(resolved?.row.footprintW ?? resolved?.row.footprint ?? 2);
    const d = Number(resolved?.row.footprintD ?? resolved?.row.footprint ?? 2);
    const fp = getFootprintTileIndices(state, entry.task.q, entry.task.r, w, d, entry.task.rotation ?? 0);
    for (const idx of fp.indices) reserved.add(idx);
  }
  for (const order of getConstructionOrders(state, colonyIndex)) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    const resolved = resolveBuildingRow(order.building, data);
    const w = Number(resolved?.row.footprintW ?? resolved?.row.footprint ?? 3);
    const d = Number(resolved?.row.footprintD ?? resolved?.row.footprint ?? 3);
    const fp = getFootprintTileIndices(state, order.q, order.r, w, d, 0);
    for (const idx of fp.indices) reserved.add(idx);
  }
  return reserved;
}

function collectUnitTileSet(state: PlanetState, colonyIndex: number): Set<number> {
  const idx = hexIndex(state.grid.radius);
  const out = new Set<number>();
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    const k = cols.kind[row];
    if (k === ENTITY_KIND.hq || k === ENTITY_KIND.harvester || k === ENTITY_KIND.pod) {
      const tIdx = idx.indexOf(cols.q[row], cols.r[row]);
      if (tIdx >= 0) out.add(tIdx);
    }
  }
  return out;
}

export function hasAnyDepositOnGrid(state: PlanetState, depositKind?: number): boolean {
  const { deposit } = state.grid.layers;
  for (let i = 0; i < deposit.length; i++) {
    if (depositKind !== undefined ? deposit[i] === depositKind : deposit[i] !== DEPOSIT.none) {
      return true;
    }
  }
  return false;
}

/**
 * Ensures a bare test grid (created via `createState` without `generateWorld`) has at least one
 * buildable `DEPOSIT.metals` tile near the colony anchor when an HQ goal needs to place a `metalsExtractor`.
 */
export function ensureStarterMetalsDeposit(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): void {
  if (hasAnyDepositOnGrid(state, DEPOSIT.metals)) return;
  const anchor = findColonyAnchor(state, colonyIndex);
  const reserved = collectReservedTiles(state, colonyIndex, data);
  const unitTiles = collectUnitTileSet(state, colonyIndex);
  const idx = hexIndex(state.grid.radius);
  const { terrain, prep, deposit, richness } = state.grid.layers;

  for (let dist = 3; dist <= state.grid.radius - 1; dist++) {
    for (let dr = -dist; dr <= dist; dr++) {
      for (let dq = -dist; dq <= dist; dq++) {
        if (hexDistance(0, 0, dq, dr) !== dist) continue;
        const q = anchor.q + dq;
        const r = anchor.r + dr;
        const fp = getFootprintTileIndices(state, q, r, 2, 2, 0);
        if (!fp.valid) continue;
        const blocked = fp.indices.some(
          (i) =>
            reserved.has(i) ||
            unitTiles.has(i) ||
            terrain[i] !== TERRAIN.flat ||
            prep[i] === PREP.ridge ||
            prep[i] === PREP.moat,
        );
        if (blocked) continue;
        const tIdx = idx.indexOf(q, r);
        if (tIdx < 0) continue;
        deposit[tIdx] = DEPOSIT.metals;
        if (richness) richness[tIdx] = 10000;
        return;
      }
    }
  }
}

/**
 * Ensures an S0 colony whose `stock` was never initialized (`colony.stock === undefined`) receives
 * the standard starting kit cargo so HQ goal builds can pay their progressive slices.
 */
export function ensureStarterGoalStock(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
): void {
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  if (colony.stock !== undefined) return;
  const ledger = ensureColonyLedger(colony);
  const cargo = resolveStartingCargo(data);
  for (const [k, v] of Object.entries(cargo)) {
    if (typeof v === 'number' && v > 0 && k in ledger.stock) {
      ledger.stock[k as keyof typeof ledger.stock] = v;
    }
  }
}

/**
 * Finds the nearest valid 2x2 `metalsExtractor` placement site covering an uncovered `DEPOSIT.metals` tile.
 */
export function findExtractorSiteForGoal(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  extraReserved?: ReadonlySet<number>,
): HexCoord | null {
  const anchor = findColonyAnchor(state, colonyIndex);
  const reserved = collectReservedTiles(state, colonyIndex, data);
  if (extraReserved) {
    for (const i of extraReserved) reserved.add(i);
  }
  const unitTiles = collectUnitTileSet(state, colonyIndex);
  const world = placementWorldFromState(state);
  const { deposit } = state.grid.layers;
  const rad = Math.min(state.grid.radius, 14);

  let best: { q: number; r: number; overlapsUnit: number; unowned: number; dist: number } | null = null;
  for (let r = Math.max(-state.grid.radius, anchor.r - rad); r <= Math.min(state.grid.radius, anchor.r + rad); r++) {
    for (let q = Math.max(-state.grid.radius, anchor.q - rad); q <= Math.min(state.grid.radius, anchor.q + rad); q++) {
      if (hexDistance(0, 0, q, r) > state.grid.radius) continue;
      const fp = getFootprintTileIndices(state, q, r, 2, 2, 0);
      if (!fp.valid || fp.indices.some((i) => reserved.has(i))) continue;
      if (!fp.indices.some((i) => deposit[i] === DEPOSIT.metals)) continue;
      const evalRes = evaluatePlacement(world, {
        colonyId: colonyIndex,
        building: 'metalsExtractor',
        q,
        r,
        requireBuilder: false,
        data,
      });
      if (!evalRes.ok) continue;
      const overlapsUnit = fp.indices.some((i) => unitTiles.has(i)) ? 1 : 0;
      const unowned = fp.indices.some((i) => state.grid.layers.owner[i] !== colonyIndex) ? 1 : 0;
      const dist = hexDistance(anchor.q, anchor.r, q, r);
      if (
        !best ||
        overlapsUnit < best.overlapsUnit ||
        (overlapsUnit === best.overlapsUnit && unowned < best.unowned) ||
        (overlapsUnit === best.overlapsUnit && unowned === best.unowned && dist < best.dist) ||
        (overlapsUnit === best.overlapsUnit && unowned === best.unowned && dist === best.dist && (r < best.r || (r === best.r && q < best.q)))
      ) {
        best = { q, r, overlapsUnit, unowned, dist };
      }
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/**
 * Finds the nearest valid 3x3 `commandHub` placement site around the colony anchor,
 * avoiding reserved tiles, unit positions, and leaving any nearby `metalsExtractor` site unobstructed.
 */
export function findHubSiteForGoal(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): HexCoord | null {
  const anchor = findColonyAnchor(state, colonyIndex);
  const reserved = collectReservedTiles(state, colonyIndex, data);
  const unitTiles = collectUnitTileSet(state, colonyIndex);
  const world = placementWorldFromState(state);
  const { deposit } = state.grid.layers;
  const hasMetals = hasAnyDepositOnGrid(state, DEPOSIT.metals);
  const rad = Math.min(state.grid.radius, 10);

  let best: { q: number; r: number; blocksExtractor: number; overlapsUnit: number; dist: number } | null = null;
  for (let r = Math.max(-state.grid.radius, anchor.r - rad); r <= Math.min(state.grid.radius, anchor.r + rad); r++) {
    for (let q = Math.max(-state.grid.radius, anchor.q - rad); q <= Math.min(state.grid.radius, anchor.q + rad); q++) {
      const dist = hexDistance(anchor.q, anchor.r, q, r);
      if (dist > 10) continue;
      const fp = getFootprintTileIndices(state, q, r, 3, 3, 0);
      if (!fp.valid || fp.indices.some((i) => reserved.has(i))) continue;
      const evalRes = evaluatePlacement(world, {
        colonyId: colonyIndex,
        building: 'commandHub',
        q,
        r,
        requireBuilder: false,
        data,
      });
      if (!evalRes.ok) continue;
      const overlapsUnit = fp.indices.some((i) => unitTiles.has(i)) ? 1 : 0;
      const touchesMetals = hasMetals && fp.indices.some((i) => deposit[i] === DEPOSIT.metals);
      const blocksExtractor =
        touchesMetals && !findExtractorSiteForGoal(state, colonyIndex, data, new Set(fp.indices)) ? 1 : 0;
      if (
        !best ||
        blocksExtractor < best.blocksExtractor ||
        (blocksExtractor === best.blocksExtractor && overlapsUnit < best.overlapsUnit) ||
        (blocksExtractor === best.blocksExtractor && overlapsUnit === best.overlapsUnit && dist < best.dist) ||
        (blocksExtractor === best.blocksExtractor &&
          overlapsUnit === best.overlapsUnit &&
          dist === best.dist &&
          (r < best.r || (r === best.r && q < best.q)))
      ) {
        best = { q, r, blocksExtractor, overlapsUnit, dist };
      }
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/**
 * Finds a 2x2 `solar` / `depot` site around the colony anchor. Ranking (first difference wins): does not block the last
 * extractor site, does not overlap a unit, inside own territory, keeps a walkable lane to other buildings, then closest
 * to this building's organic target point (see `siteSpacing.ts`), then `r`, `q`. Every candidate passes `evaluatePlacement`.
 */
export function findGeneratorSiteForGoal(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  building: 'solar' | 'depot' = 'solar',
): HexCoord | null {
  const anchor = findColonyAnchor(state, colonyIndex);
  const reserved = collectReservedTiles(state, colonyIndex, data);
  const unitTiles = collectUnitTileSet(state, colonyIndex);
  const world = placementWorldFromState(state);
  const { deposit } = state.grid.layers;
  const hasMetals = hasAnyDepositOnGrid(state, DEPOSIT.metals);
  const rad = Math.min(state.grid.radius, 10);
  const gaps = buildGapField(state.grid.radius, reserved);
  const target = organicTarget(anchor, colonyIndex, occupiedFootprintCount(state, data));

  let best: { q: number; r: number; rank: number[] } | null = null;
  for (let r = Math.max(-state.grid.radius, anchor.r - rad); r <= Math.min(state.grid.radius, anchor.r + rad); r++) {
    for (let q = Math.max(-state.grid.radius, anchor.q - rad); q <= Math.min(state.grid.radius, anchor.q + rad); q++) {
      if (hexDistance(anchor.q, anchor.r, q, r) > 10) continue;
      const fp = getFootprintTileIndices(state, q, r, 2, 2, 0);
      if (!fp.valid || fp.indices.some((i) => reserved.has(i))) continue;
      const evalRes = evaluatePlacement(world, { colonyId: colonyIndex, building, q, r, requireBuilder: false, data });
      if (!evalRes.ok) continue;
      const touchesMetals = hasMetals && fp.indices.some((i) => deposit[i] === DEPOSIT.metals);
      const rank = [
        touchesMetals && !findExtractorSiteForGoal(state, colonyIndex, data, new Set(fp.indices)) ? 1 : 0,
        fp.indices.some((i) => unitTiles.has(i)) ? 1 : 0,
        fp.indices.some((i) => state.grid.layers.owner[i] !== colonyIndex) ? 1 : 0,
        laneTier(footprintGap(gaps, fp.indices)),
        hexDistance(target.q, target.r, q, r),
        r,
        q,
      ];
      if (!best || compareRank(rank, best.rank) < 0) best = { q, r, rank };
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/** Number of buildings standing or under construction: the stable "which building is this" index for `organicTarget`. */
function occupiedFootprintCount(state: PlanetState, data?: CompiledDataLike): number {
  return buildingFootprints(state, data).length;
}
