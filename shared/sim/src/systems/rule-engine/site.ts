import { DEPOSIT_MAX_RICHNESS_BP } from '../../data';
import { geoBuildBlock, isPreparedGround, isTileUneven, MAX_FOOTPRINT_SPREAD_M } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { nextFloat } from '../../kernel/rng';
import type { Grid, PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import {
  buildGapField,
  colonyBuildingOrdinal,
  evaluateFootprintPassability,
  footprintGap,
  LANE_GAP,
  laneTier,
  organicTarget,
  type FootprintPassability,
} from '../construction/siteSpacing';
import { collectReservedTiles } from '../goals/sites';
import { needsPowerZoneExpansion } from '../terraform-basic/aiTerritory';
import {
  evaluatePlacement,
  getBuildingFootprintTiles,
  type PlacementWorld,
} from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { findColonySupportNodes, resolveSiteBuildingSpec, type SiteBuildingSpec } from './siteSupport';

export const DEFAULT_SITE_MAX_RADIUS = 20;

export interface SelectBuildSiteOptions {
  rng?: () => number;
  maxRadius?: number;
  randomTieBreak?: boolean;
  jitterBp?: number;
  requireOwned?: boolean;
  data?: CompiledDataLike;
}

export interface BuildSiteSelection {
  q: number;
  r: number;
  tileIndex: number;
  score: number;
  distanceToHub: number;
  distanceToSupport: number;
  depositRichnessBp: number;
  preparedCount: number;
  unpreparedCount: number;
}

function detectGridFlags(state: PlanetState, colonyIndex: number): {
  colonyHasTerritory: boolean;
  planetHasRichness: boolean;
} {
  const ownerLayer = state.grid.layers.owner as Int16Array;
  const richnessLayer = state.grid.layers.richness as Float32Array | undefined;
  let colonyHasTerritory = false;
  let planetHasRichness = false;
  for (let i = 0; i < state.grid.count; i++) {
    if (ownerLayer[i] === colonyIndex) colonyHasTerritory = true;
    if (richnessLayer && richnessLayer[i]! > 0) planetHasRichness = true;
    if (colonyHasTerritory && planetHasRichness) break;
  }
  return { colonyHasTerritory, planetHasRichness };
}

function evaluateFallbackFootprint(
  world: PlacementWorld,
  occupied: ReadonlySet<number>,
  spec: SiteBuildingSpec,
  colonyIndex: number,
  q: number,
  r: number,
): { ok: boolean; preparedCount: number; unpreparedCount: number; ownedCount: number } {
  const hx = hexIndex(world.radius);
  const coords = getBuildingFootprintTiles(q, r, spec.footprint);
  let preparedCount = 0;
  let ownedCount = 0;
  let hasRequiredDeposit = spec.requiresDeposit === undefined;
  let minH = Infinity;
  let maxH = -Infinity;

  for (const pt of coords) {
    const idx = hx.indexOf(pt.q, pt.r);
    if (idx < 0 || idx >= world.tileCount) return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };
    const own = world.owner[idx]!;
    if (own >= 0 && own !== colonyIndex) return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };
    if (own === colonyIndex) ownedCount++;
    if (occupied.has(idx)) return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };

    const terrain = world.terrain[idx]!;
    const prep = world.prep[idx]!;
    const dep = world.deposit ? world.deposit[idx]! : 0;
    const isDepleted = dep !== 0 && world.richness != null && Number(world.richness[idx] ?? 0) <= 0;
    const effectiveDep = isDepleted ? 0 : dep;

    if (geoBuildBlock(terrain, prep, effectiveDep, spec.depositRule)) {
      return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };
    }
    if (isTileUneven(world.radius, idx, world.terrain, world.height)) {
      return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };
    }
    if (spec.requiresDeposit !== undefined && effectiveDep === spec.requiresDeposit) {
      hasRequiredDeposit = true;
    }
    if (isPreparedGround(prep)) preparedCount++;
    if (world.height) {
      const h = world.height[idx]!;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  if (!hasRequiredDeposit || (world.height && maxH - minH > MAX_FOOTPRINT_SPREAD_M)) {
    return { ok: false, preparedCount: 0, unpreparedCount: 0, ownedCount: 0 };
  }
  return { ok: true, preparedCount, unpreparedCount: coords.length - preparedCount, ownedCount };
}

function readCandidateRichnessBp(
  world: PlacementWorld,
  tileIndex: number,
  footprintIndices: readonly number[],
  requiredDeposit: number | undefined,
): { richnessBp: number; directDepositMatch: boolean } {
  if (requiredDeposit === undefined || !world.deposit) {
    return { richnessBp: 0, directDepositMatch: false };
  }
  const tileRichness = (idx: number): number => {
    if (world.deposit![idx] !== requiredDeposit) return -1;
    if (world.richness == null) return DEPOSIT_MAX_RICHNESS_BP;
    const r = Math.round(Number(world.richness[idx] ?? 0));
    return r > 0 ? r : -1;
  };
  const direct = tileRichness(tileIndex);
  if (direct > 0) return { richnessBp: direct, directDepositMatch: true };

  let best = 0;
  for (const idx of footprintIndices) {
    const r = tileRichness(idx);
    if (r > best) best = r;
  }
  return { richnessBp: best, directDepositMatch: false };
}

function scoreCandidateSite(
  spec: SiteBuildingSpec,
  distToHub: number,
  minSupportDist: number,
  minPowerSourceDist: number,
  richnessBp: number,
  directDepositMatch: boolean,
  ownedCount: number,
  preparedCount: number,
  gap: number,
  targetDist: number,
  passability: FootprintPassability,
): number {
  const bonus = ownedCount * 100 + preparedCount * 25;
  const passPenalty = passability.impassableCount * 300;
  if (spec.requiresDeposit !== undefined) {
    const anchorBonus = directDepositMatch ? 20000 : 5000;
    // Deposit buildings must sit on ore; among equal deposits prefer one that keeps a walkable lane and open passage.
    const tierBonus = gap >= LANE_GAP ? 2000 : -4000;
    const pinchPenalty = passability.pinchesCorridor ? 3000 : 0;
    return anchorBonus + richnessBp - minSupportDist * 250 - distToHub * 100 + bonus + tierBonus - pinchPenalty - passPenalty;
  }
  if (spec.isHub) {
    return 15000 + (laneTier(gap) === 0 ? 2000 : 0) - distToHub * 300 + bonus - passPenalty;
  }
  if (spec.isBeacon) {
    return (
      12000 +
      (laneTier(gap) === 0 ? 2000 : 0) -
      Math.abs(distToHub - 8) * 300 +
      bonus -
      passability.impassableCount * 400 -
      passability.roughCount * 150
    );
  }
  if (spec.isPylon) {
    return (
      12000 +
      (laneTier(gap) === 0 ? 2500 : 800) -
      Math.abs(minPowerSourceDist - 5) * 450 +
      Math.min(distToHub, 12) * 100 +
      bonus -
      passability.impassableCount * 400 -
      passability.roughCount * 150
    );
  }
  // Ordinary buildings: require at least a walkable lane (reject gap < LANE_GAP and pinched corridors),
  // strongly prefer a wide 2+ tile boulevard (laneTier === 0), and spread toward this building's organic target.
  const tierScore = laneTier(gap) === 0 ? 4500 + Math.min(gap, 6) * 200 : 1500;
  return 10000 + tierScore - targetDist * 250 + bonus - passability.impassableCount * 500 - passability.roughCount * 200;
}

interface SiteSearchContext {
  grid: Grid;
  spec: SiteBuildingSpec;
  world: PlacementWorld;
  occupied: ReadonlySet<number>;
  reserved: ReadonlySet<number>;
  colonyIndex: number;
  hubAnchor: { q: number; r: number };
  supportNodes: ReadonlyArray<{ q: number; r: number }>;
  powerSources: ReadonlyArray<{ q: number; r: number }>;
  maxRadius: number;
  mustOwnAnchor: boolean;
  jitterCap: number;
  gaps: Uint8Array;
  target: { q: number; r: number };
  drawRng: () => number;
  data?: CompiledDataLike;
}

function evaluateCandidateTile(
  ctx: SiteSearchContext,
  tileIndex: number,
  q: number,
  r: number,
  own: number,
): BuildSiteSelection | null {
  const { spec, world, occupied, reserved, colonyIndex, hubAnchor, supportNodes, powerSources, maxRadius, mustOwnAnchor } = ctx;
  if (mustOwnAnchor ? own !== colonyIndex : own >= 0 && own !== colonyIndex) return null;
  const distToHub = hexDistance(hubAnchor.q, hubAnchor.r, q, r);
  if (distToHub > maxRadius) return null;

  const hx = hexIndex(world.radius);
  let preparedCount: number;
  let unpreparedCount: number;
  let ownedCount: number;
  let fpIndices: number[];

  if (spec.hasNativeRule) {
    const res = evaluatePlacement(world, {
      colonyId: colonyIndex, q, r, building: spec.canonicalBuilding, requireBuilder: false, data: ctx.data,
    });
    if (!res.ok) return null;
    preparedCount = res.preparedCount;
    unpreparedCount = res.unpreparedCount;
    fpIndices = res.tiles.map((t) => t.tileIdx);
    ownedCount = res.tiles.filter((t) => t.owner === colonyIndex).length;
  } else {
    const fb = evaluateFallbackFootprint(world, occupied, spec, colonyIndex, q, r);
    if (!fb.ok) return null;
    preparedCount = fb.preparedCount;
    unpreparedCount = fb.unpreparedCount;
    ownedCount = fb.ownedCount;
    fpIndices = getBuildingFootprintTiles(q, r, spec.footprint).map((pt) => hx.indexOf(pt.q, pt.r)).filter((i) => i >= 0);
  }

  if (fpIndices.some((i) => reserved.has(i))) return null;

  const { richnessBp, directDepositMatch } = readCandidateRichnessBp(world, tileIndex, fpIndices, spec.requiresDeposit);
  if (spec.requiresDeposit !== undefined && richnessBp <= 0) return null;

  const gap = footprintGap(ctx.gaps, fpIndices);
  const passability = evaluateFootprintPassability(ctx.grid, reserved, fpIndices);
  if (spec.requiresDeposit === undefined && !spec.isHub) {
    if (gap < LANE_GAP || passability.pinchesCorridor) return null;
  } else if (spec.isHub) {
    if (passability.pinchesCorridor) return null;
  }

  let minSupportDist = distToHub;
  for (const node of supportNodes) {
    const d = hexDistance(node.q, node.r, q, r);
    if (d < minSupportDist) minSupportDist = d;
  }

  let minPowerSourceDist = distToHub;
  if (powerSources.length > 0) {
    minPowerSourceDist = Infinity;
    for (const src of powerSources) {
      const d = hexDistance(src.q, src.r, q, r);
      if (d < minPowerSourceDist) minPowerSourceDist = d;
    }
  }

  const jitter = ctx.jitterCap > 0 ? Math.floor(ctx.drawRng() * (ctx.jitterCap + 1)) : 0;
  const score =
    scoreCandidateSite(
      spec,
      distToHub,
      minSupportDist,
      minPowerSourceDist,
      richnessBp,
      directDepositMatch,
      ownedCount,
      preparedCount,
      gap,
      hexDistance(ctx.target.q, ctx.target.r, q, r),
      passability,
    ) + jitter;

  return {
    q, r, tileIndex, score,
    distanceToHub: distToHub,
    distanceToSupport: minSupportDist,
    depositRichnessBp: richnessBp,
    preparedCount,
    unpreparedCount,
  };
}

/**
 * Deterministically selects the best build site for `buildingKind` within `colonyIndex`'s territory (`SIM-R-05`).
 * Ties in integer score are broken deterministically by lowest `tileIndex` (or via the `ai` RNG stream if requested).
 */
export function selectDeterministicBuildSite(
  state: PlanetState,
  colonyIndex: number,
  buildingKind: string,
  opts?: SelectBuildSiteOptions,
): BuildSiteSelection | null {
  const spec = resolveSiteBuildingSpec(buildingKind, opts?.data);
  const { hubAnchor, supportNodes, powerSources } = findColonySupportNodes(state, colonyIndex);
  const { colonyHasTerritory, planetHasRichness } = detectGridFlags(state, colonyIndex);
  const rawWorld = placementWorldFromState(state);
  const reserved = collectReservedTiles(state, colonyIndex, opts?.data);
  const ctx: SiteSearchContext = {
    grid: state.grid,
    spec,
    world: planetHasRichness ? rawWorld : { ...rawWorld, richness: null },
    occupied: occupiedGroundTiles(state, opts?.data),
    reserved,
    colonyIndex,
    hubAnchor,
    supportNodes,
    powerSources,
    maxRadius: opts?.maxRadius ?? DEFAULT_SITE_MAX_RADIUS,
    mustOwnAnchor: opts?.requireOwned ?? (colonyHasTerritory && !spec.isHub),
    jitterCap: opts?.jitterBp && opts.jitterBp > 0 ? Math.trunc(opts.jitterBp) : 0,
    gaps: buildGapField(state.grid.radius, reserved),
    target: organicTarget(hubAnchor, colonyIndex, colonyBuildingOrdinal(state, colonyIndex, opts?.data)),
    drawRng: opts?.rng ?? (() => nextFloat(state.rng.ai)),
    data: opts?.data,
  };

  const hx = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int16Array;
  let best: BuildSiteSelection | null = null;
  let tieCount = 0;

  for (let tileIndex = 0; tileIndex < state.grid.count; tileIndex++) {
    const candidate = evaluateCandidateTile(ctx, tileIndex, hx.q[tileIndex]!, hx.r[tileIndex]!, ownerLayer[tileIndex]!);
    if (!candidate) continue;

    if (!best || candidate.score > best.score) {
      best = candidate;
      tieCount = 1;
    } else if (candidate.score === best.score) {
      tieCount++;
      if (opts?.randomTieBreak) {
        if (Math.floor(ctx.drawRng() * tieCount) === 0) best = candidate;
      } else if (candidate.tileIndex < best.tileIndex) {
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Checks whether `colonyIndex` should expand its power zone with a `pylon` to keep building spacing wide
 * (`gap >= LANE_GAP`) or reach nearby deposits and outer territory.
 */
export function shouldExpandPowerZoneWithPylon(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  flags?: { has(w: string): boolean },
): { needed: boolean; site: BuildSiteSelection | null } {
  const noSpaciousSite = selectDeterministicBuildSite(state, colonyIndex, 'solar', { data }) === null;
  if (!needsPowerZoneExpansion(state, colonyIndex, data, flags, { noSpaciousSite })) {
    return { needed: false, site: null };
  }
  const site = selectDeterministicBuildSite(state, colonyIndex, 'pylon', { data });
  return { needed: Boolean(site), site };
}
