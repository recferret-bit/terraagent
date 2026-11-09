import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import { HEX_DIRS, hexDistance, hexIndex } from '../grid/hex';
import { hexTileCenter, hexTileDisk, isHexTile, isOpenGround, joinPlaneHeight } from '../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { revealAroundChanged, type RevealedDeposit } from '../grid/subsurface';
import { setTileHeight, setTilePrep, setTileTerrain } from '../grid/tileModel';
import { touchTile, type PlanetState } from '../kernel/state';
import { occupiedGroundTiles } from '../systems/construction/occupancy';
import { dunePadHeight } from '../systems/terraform-basic/duneFootprint';
import { syncColonyTerraformStats } from '../systems/terraform-basic/rules';
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';
import {
  inspectCrossSeamHexTileFootprint,
  syncAtlasSectorTilesFromState,
  type CrossSeamHexTileFootprintReport,
} from './seamDiffsAndFeatures';
import type { GeneratedSmallAtlas } from './types';

export * from './seamDiffsAndFeatures';

export type CrossSeamTerraformOp =
  | 'flatten'
  | 'raise'
  | 'lower'
  | 'clear'
  | 'prepare'
  | 'reclaim'
  | 'dredge'
  | 'grade'
  | 'break'
  | 'level'
  | 'fill'
  | 'deepReclaim'
  | 'irrigate'
  | 'seed'
  | 'work';

export interface PlannedCrossSectorTileMutation {
  readonly q: number;
  readonly r: number;
  readonly tileIdx: number;
  readonly sectorId: SectorId;
  readonly distFromCenter: number;
  readonly inCoreDisk: boolean;
  readonly prevTerrain: number;
  readonly prevPrep: number;
  readonly prevHeight: number;
  readonly nextTerrain: number;
  readonly nextPrep: number;
  readonly nextHeight: number;
}

export interface CrossSectorTerraformOptions {
  readonly q: number;
  readonly r: number;
  readonly op?: CrossSeamTerraformOp;
  readonly tiles?: ReadonlyArray<{ readonly q: number; readonly r: number }>;
  readonly snapToLattice?: boolean;
  readonly diskRadius?: number;
  readonly r4Radius?: number;
  readonly targetHeightM?: number;
  readonly deltaHeightM?: number;
  readonly maxR4StepM?: number;
  readonly colonyId?: number;
  readonly tick?: number;
  readonly sectorRadius?: number;
  readonly atlas?: GeneratedSmallAtlas;
}

export interface CrossSectorTerraformPreview {
  readonly centerQ: number;
  readonly centerR: number;
  readonly centerSectorId: SectorId;
  readonly op: CrossSeamTerraformOp;
  readonly sectorRadius: number;
  readonly diskRadius: number;
  readonly r4Radius: number;
  readonly targetHeightM: number;
  readonly toTerrain: number;
  readonly toPrep: number;
  readonly diskChanges: readonly PlannedCrossSectorTileMutation[];
  readonly r4Changes: readonly PlannedCrossSectorTileMutation[];
  readonly allChanges: readonly PlannedCrossSectorTileMutation[];
  readonly diskSectorIds: readonly SectorId[];
  readonly affectedSectorIds: readonly SectorId[];
  readonly crossSectorNeighborLinks: readonly never[];
  readonly straddlesSectorSeam: boolean;
  readonly r4SpansMultipleSectors: boolean;
}

export interface CrossSectorTerraformResult extends CrossSectorTerraformPreview {
  readonly tick: number;
  readonly changedTileIndices: readonly number[];
  readonly revealedDeposits: readonly RevealedDeposit[];
  readonly footprintReport: CrossSeamHexTileFootprintReport;
}

function resolveSectorRadius(state: PlanetState, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isSafeInteger(explicit) && explicit > 0) {
    return explicit;
  }
  return getAtlasBlob(state)?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
}

function resolveOpTargetTerrainAndPrep(op: CrossSeamTerraformOp): { toTerrain: number; toPrep: number } {
  if (op === 'dredge') return { toTerrain: TERRAIN.shallow, toPrep: PREP.wild };
  if (op === 'irrigate') return { toTerrain: TERRAIN.flat, toPrep: PREP.irrigated };
  if (op === 'seed') return { toTerrain: TERRAIN.flat, toPrep: PREP.living };
  return { toTerrain: TERRAIN.flat, toPrep: PREP.prepared };
}

function computeCrossSeamTargetPlaneHeight(
  state: PlanetState,
  centerQ: number,
  centerR: number,
  op: CrossSeamTerraformOp,
  diskIndices: ReadonlySet<number>,
  r4Indices: readonly number[],
  opts: CrossSectorTerraformOptions,
): number {
  if (typeof opts.targetHeightM === 'number' && Number.isFinite(opts.targetHeightM)) {
    return Math.fround(opts.targetHeightM);
  }
  const L = state.grid.layers;
  const radius = state.grid.radius;
  const layers = { terrain: L.terrain, prep: L.prep, height: L.height };

  if (op === 'dredge') {
    const waterAnchors: number[] = [];
    for (const idx of r4Indices) {
      if (diskIndices.has(idx)) continue;
      const t = L.terrain[idx]!;
      if (t === TERRAIN.shallow || t === TERRAIN.deep) waterAnchors.push(L.height[idx]!);
    }
    return Math.fround(joinPlaneHeight(waterAnchors) ?? -0.18);
  }

  const hexAnchors: number[] = [];
  const openAnchors: number[] = [];
  for (const idx of r4Indices) {
    if (diskIndices.has(idx)) continue;
    const t = L.terrain[idx]!;
    const p = L.prep[idx]!;
    if (!isOpenGround(t, p)) continue;
    const h = L.height[idx]!;
    openAnchors.push(h);
    if (isHexTile(radius, idx, layers)) hexAnchors.push(h);
  }

  let baseH = joinPlaneHeight(hexAnchors) ?? joinPlaneHeight(openAnchors);
  if (baseH === null) {
    const padH = dunePadHeight(radius, centerQ, centerR, layers);
    baseH = padH > 0 ? padH : 0.08;
  }
  if ((op === 'reclaim' || op === 'deepReclaim') && baseH < 0.06) {
    baseH = 0.08;
  }
  if (op === 'raise') {
    baseH += opts.deltaHeightM ?? 0.35;
  } else if (op === 'lower') {
    baseH -= Math.abs(opts.deltaHeightM ?? 0.35);
    if (state.meta.planetType !== 'ocean' && baseH < 0.04) baseH = 0.04;
  }
  return Math.fround(baseH);
}

function collectDiskAndR4Coords(
  state: PlanetState,
  centerQ: number,
  centerR: number,
  sectorRadius: number,
  diskRadius: number,
  r4Radius: number,
  extraTiles?: ReadonlyArray<{ readonly q: number; readonly r: number }>,
): {
  centerSectorId: SectorId;
  coreMap: Map<number, { q: number; r: number; dist: number }>;
  r4Map: Map<number, { q: number; r: number; dist: number }>;
} {
  const hx = hexIndex(state.grid.radius);
  const centerSectorId = globalTileToSector(centerQ, centerR, sectorRadius).sectorId;
  const inCenterSector = (q: number, r: number): boolean =>
    globalTileToSector(q, r, sectorRadius).sectorId === centerSectorId;
  const coreSeeds: Array<{ q: number; r: number }> =
    diskRadius === 1 && (!extraTiles || extraTiles.length === 0)
      ? hexTileDisk(centerQ, centerR, state.grid.radius).filter((t) => inCenterSector(t.q, t.r))
      : [];

  if (coreSeeds.length === 0) {
    for (let dr = -diskRadius; dr <= diskRadius; dr++) {
      for (let dq = Math.max(-diskRadius, -dr - diskRadius); dq <= Math.min(diskRadius, -dr + diskRadius); dq++) {
        const tq = centerQ + dq + 0;
        const tr = centerR + dr + 0;
        if (hx.indexOf(tq, tr) >= 0 && inCenterSector(tq, tr)) coreSeeds.push({ q: tq, r: tr });
      }
    }
  }
  if (extraTiles) {
    for (const t of extraTiles) {
      if (hx.indexOf(t.q, t.r) >= 0 && inCenterSector(t.q, t.r)) coreSeeds.push({ q: t.q + 0, r: t.r + 0 });
    }
  }

  const coreMap = new Map<number, { q: number; r: number; dist: number }>();
  for (const c of coreSeeds) {
    const idx = hx.indexOf(c.q, c.r);
    if (idx >= 0 && !coreMap.has(idx)) {
      coreMap.set(idx, { q: c.q, r: c.r, dist: hexDistance(centerQ, centerR, c.q, c.r) });
    }
  }

  const r4Map = new Map<number, { q: number; r: number; dist: number }>();
  const skirtSpan = Math.max(0, r4Radius - diskRadius);
  for (const [idx, c] of coreMap) {
    r4Map.set(idx, { q: c.q, r: c.r, dist: 0 });
    for (let dr = -skirtSpan; dr <= skirtSpan; dr++) {
      for (let dq = Math.max(-skirtSpan, -dr - skirtSpan); dq <= Math.min(skirtSpan, -dr + skirtSpan); dq++) {
        const nq = c.q + dq + 0;
        const nr = c.r + dr + 0;
        const nIdx = hx.indexOf(nq, nr);
        if (nIdx < 0 || !inCenterSector(nq, nr)) continue;
        const dFromDisk = hexDistance(c.q, c.r, nq, nr);
        const prev = r4Map.get(nIdx);
        if (!prev || dFromDisk < prev.dist) {
          r4Map.set(nIdx, { q: nq, r: nr, dist: dFromDisk });
        }
      }
    }
  }
  return { centerSectorId, coreMap, r4Map };
}

function planR4Buffers(
  state: PlanetState,
  r4Map: ReadonlyMap<number, { q: number; r: number; dist: number }>,
  diskIndices: ReadonlySet<number>,
  toTerrain: number,
  toPrep: number,
  targetHeightM: number,
  skirtSpan: number,
  maxR4StepM: number,
): {
  plannedTerrains: Map<number, number>;
  plannedPreps: Map<number, number>;
  plannedHeights: Map<number, number>;
} {
  const L = state.grid.layers;
  const hx = hexIndex(state.grid.radius);
  const occupied = occupiedGroundTiles(state);
  const plannedHeights = new Map<number, number>();
  const plannedTerrains = new Map<number, number>();
  const plannedPreps = new Map<number, number>();

  for (const [idx, info] of r4Map) {
    const origT = L.terrain[idx]!;
    const origP = L.prep[idx]!;
    const origH = L.height[idx]!;
    if (diskIndices.has(idx)) {
      plannedTerrains.set(idx, toTerrain);
      plannedPreps.set(idx, toPrep);
      plannedHeights.set(idx, targetHeightM);
      continue;
    }
    const isFixed = occupied.has(idx) || (L.deposit[idx] ?? 0) !== DEPOSIT.none;
    if (isFixed || isOpenGround(origT, origP)) {
      plannedTerrains.set(idx, origT);
      plannedPreps.set(idx, origP);
      plannedHeights.set(idx, isOpenGround(origT, origP) ? targetHeightM : origH);
      continue;
    }
    if (toTerrain === TERRAIN.flat && origT === TERRAIN.deep && info.dist === 1) {
      plannedTerrains.set(idx, TERRAIN.shallow);
      plannedPreps.set(idx, PREP.wild);
      plannedHeights.set(idx, Math.fround(Math.max(-0.18, origH * 0.5)));
      continue;
    }
    const u = Math.min(1, Math.max(0, info.dist / (skirtSpan + 1)));
    const s = u * u * (3 - 2 * u);
    plannedTerrains.set(idx, origT);
    plannedPreps.set(idx, origP);
    plannedHeights.set(idx, Math.fround(targetHeightM + (origH - targetHeightM) * s));
  }

  for (let pass = 0; pass < 4; pass++) {
    for (const [idx, info] of r4Map) {
      if (diskIndices.has(idx) || isOpenGround(plannedTerrains.get(idx)!, plannedPreps.get(idx)!)) continue;
      let curH = plannedHeights.get(idx)!;
      for (const [dq, dr] of HEX_DIRS) {
        const nbH = plannedHeights.get(hx.indexOf(info.q + dq, info.r + dr));
        if (nbH === undefined) continue;
        if (curH - nbH > maxR4StepM) curH = Math.fround(nbH + maxR4StepM);
        else if (nbH - curH > maxR4StepM) curH = Math.fround(nbH - maxR4StepM);
      }
      plannedHeights.set(idx, curH);
    }
  }
  return { plannedTerrains, plannedPreps, plannedHeights };
}

/**
 * Computes a pure preview of a cross-sector terraforming operation at `(q, r)` (including all 7 sub-tiles
 * of the D-45 hex-tile disk and the R4 `hexDistance <= 4` slope/plane-joining skirt across sector seams).
 */
export function applyCrossSectorTerraformPreviewAndJoin(
  state: PlanetState,
  opts: CrossSectorTerraformOptions,
): CrossSectorTerraformPreview {
  const sectorRadius = resolveSectorRadius(state, opts.sectorRadius);
  const op: CrossSeamTerraformOp = opts.op ?? 'flatten';
  const diskRadius = opts.diskRadius ?? 1;
  const r4Radius = Math.max(diskRadius, opts.r4Radius ?? 4);
  const maxR4StepM = opts.maxR4StepM ?? 0.35;
  const center = opts.snapToLattice ? hexTileCenter(opts.q, opts.r) : { q: opts.q + 0, r: opts.r + 0 };
  const L = state.grid.layers;

  const { centerSectorId, coreMap, r4Map } = collectDiskAndR4Coords(
    state,
    center.q,
    center.r,
    sectorRadius,
    diskRadius,
    r4Radius,
    opts.tiles,
  );
  const diskIndices = new Set<number>(coreMap.keys());
  const r4Indices = [...r4Map.keys()];
  const targetHeightM = computeCrossSeamTargetPlaneHeight(state, center.q, center.r, op, diskIndices, r4Indices, opts);
  const { toTerrain, toPrep } = resolveOpTargetTerrainAndPrep(op);
  const { plannedTerrains, plannedPreps, plannedHeights } = planR4Buffers(
    state,
    r4Map,
    diskIndices,
    toTerrain,
    toPrep,
    targetHeightM,
    Math.max(1, r4Radius - diskRadius),
    maxR4StepM,
  );

  const diskChanges: PlannedCrossSectorTileMutation[] = [];
  const r4Changes: PlannedCrossSectorTileMutation[] = [];

  for (const [idx, info] of r4Map) {
    const inCoreDisk = diskIndices.has(idx);
    const entry: PlannedCrossSectorTileMutation = {
      q: info.q,
      r: info.r,
      tileIdx: idx,
      sectorId: centerSectorId,
      distFromCenter: hexDistance(center.q, center.r, info.q, info.r),
      inCoreDisk,
      prevTerrain: L.terrain[idx]!,
      prevPrep: L.prep[idx]!,
      prevHeight: L.height[idx]!,
      nextTerrain: plannedTerrains.get(idx)!,
      nextPrep: plannedPreps.get(idx)!,
      nextHeight: plannedHeights.get(idx)!,
    };
    if (inCoreDisk) diskChanges.push(entry);
    else r4Changes.push(entry);
  }

  return {
    centerQ: center.q,
    centerR: center.r,
    centerSectorId,
    op,
    sectorRadius,
    diskRadius,
    r4Radius,
    targetHeightM,
    toTerrain,
    toPrep,
    diskChanges,
    r4Changes,
    allChanges: [...diskChanges, ...r4Changes],
    diskSectorIds: [centerSectorId],
    affectedSectorIds: [centerSectorId],
    crossSectorNeighborLinks: [],
    straddlesSectorSeam: false,
    r4SpansMultipleSectors: false,
  };
}

/**
 * Executes a cross-sector terraforming operation at `(q, r)`, updating all 7 sub-tiles of the D-45 hex-tile disk
 * and joining heights smoothly across the R4 (`hexDistance <= 4`) neighbourhood spanning 1, 2, or 3 sectors.
 */
export function executeCrossSectorTerraformOp(
  state: PlanetState,
  opts: CrossSectorTerraformOptions,
): CrossSectorTerraformResult {
  const preview = applyCrossSectorTerraformPreviewAndJoin(state, opts);
  const tick = opts.tick ?? state.meta.tick;
  const holeVariant = (state.grid.layers as { holeVariant?: Uint8Array }).holeVariant;
  const changedTileIndices: number[] = [];

  for (const m of preview.allChanges) {
    const changed =
      m.prevTerrain !== m.nextTerrain ||
      m.prevPrep !== m.nextPrep ||
      Math.abs(m.prevHeight - m.nextHeight) > 1e-6 ||
      m.inCoreDisk;
    if (!changed) continue;
    setTileTerrain(state.grid, m.tileIdx, m.nextTerrain, tick);
    setTilePrep(state.grid, m.tileIdx, m.nextPrep, tick);
    setTileHeight(state.grid, m.tileIdx, m.nextHeight, tick);
    if (holeVariant && m.nextTerrain === TERRAIN.flat) holeVariant[m.tileIdx] = 0;
    touchTile(state, m.tileIdx, tick);
    changedTileIndices.push(m.tileIdx);
  }

  const revealedDeposits = revealAroundChanged(state, changedTileIndices, tick);
  if (typeof opts.colonyId === 'number' && opts.colonyId >= 0) {
    syncColonyTerraformStats(state, opts.colonyId, tick);
  }
  syncAtlasSectorTilesFromState(state, opts.atlas, changedTileIndices);

  const footprintReport = inspectCrossSeamHexTileFootprint(state, preview.centerQ, preview.centerR, {
    sectorRadius: preview.sectorRadius,
    diskRadius: preview.diskRadius,
    r4Radius: preview.r4Radius,
  });

  return {
    ...preview,
    tick,
    changedTileIndices,
    revealedDeposits,
    footprintReport,
  };
}

export function inspectSeamTerraforming(
  state: PlanetState,
  qOrOpts: number | CrossSectorTerraformOptions,
  r?: number,
  opts?: { snapToLattice?: boolean; sectorRadius?: number; diskRadius?: number; r4Radius?: number },
): CrossSeamHexTileFootprintReport | CrossSectorTerraformPreview {
  if (typeof qOrOpts === 'number') {
    return inspectCrossSeamHexTileFootprint(state, qOrOpts, r!, opts);
  }
  return applyCrossSectorTerraformPreviewAndJoin(state, qOrOpts);
}
export const applySeamSafeTerraform = executeCrossSectorTerraformOp;
