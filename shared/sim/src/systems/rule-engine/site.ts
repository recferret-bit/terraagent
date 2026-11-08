import { DEPOSIT_MAX_RICHNESS_BP } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { geoBuildBlock, isPreparedGround, isTileUneven, MAX_FOOTPRINT_SPREAD_M, type DepositRule } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import { nextFloat } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { buildingFootprints, occupiedGroundTiles } from '../construction/occupancy';
import { buildGapField, footprintGap, laneTier, organicTarget } from '../construction/siteSpacing';
import { collectReservedTiles } from '../goals/sites';
import {
  evaluatePlacement,
  getBuildingFootprintTiles,
  resolvePlacementRule,
  type PlacementWorld,
} from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';

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

interface SiteBuildingSpec {
  canonicalBuilding: string;
  hasNativeRule: boolean;
  isHub: boolean;
  isBeacon: boolean;
  isPylon: boolean;
  footprint: number;
  depositRule: DepositRule;
  requiresDeposit?: number;
}

const EXTRACTOR_DEPOSIT_MAP: Readonly<Record<string, number>> = {
  metalsExtractor: DEPOSIT.metals,
  extractor: DEPOSIT.metals,
  mineralsExtractor: DEPOSIT.minerals,
  mineralsQuarry: DEPOSIT.minerals,
  quarry: DEPOSIT.minerals,
  petroleumWell: DEPOSIT.oil,
  biomassExtractor: DEPOSIT.oil,
  oilExtractor: DEPOSIT.oil,
};

const FOOTPRINT_ONE_BUILDINGS: ReadonlySet<string> = new Set([
  'pylon',
  'turret',
  'autocannon',
  'pulseTurret',
  'laserTower',
  'outpostBeacon',
  'claimBeacon',
  'beacon',
  'droneControlArray',
  'dca',
  'radar',
  'wall',
  'road',
]);

const FOOTPRINT_THREE_BUILDINGS: ReadonlySet<string> = new Set([
  'commandHub',
  'hub',
  'roboticsFactory',
  'robotics_factory',
  'factory',
]);

function resolveSiteBuildingSpec(buildingKind: string, data?: CompiledDataLike): SiteBuildingSpec {
  const nativeRule = resolvePlacementRule(buildingKind, data);
  const reqDeposit = nativeRule?.requiresDeposit ?? EXTRACTOR_DEPOSIT_MAP[buildingKind];
  if (nativeRule) {
    return {
      canonicalBuilding: buildingKind,
      hasNativeRule: true,
      isHub: nativeRule.isHub,
      isBeacon: false,
      isPylon: false,
      footprint: nativeRule.footprint,
      depositRule: nativeRule.deposit,
      requiresDeposit: reqDeposit,
    };
  }
  const footprint = FOOTPRINT_THREE_BUILDINGS.has(buildingKind)
    ? 3
    : FOOTPRINT_ONE_BUILDINGS.has(buildingKind)
      ? 1
      : 2;
  return {
    canonicalBuilding: buildingKind,
    hasNativeRule: false,
    isHub: buildingKind === 'commandHub' || buildingKind === 'hub',
    isBeacon: buildingKind === 'outpostBeacon' || buildingKind === 'claimBeacon' || buildingKind === 'beacon',
    isPylon: buildingKind === 'pylon',
    footprint,
    depositRule: reqDeposit !== undefined ? 'any' : 'forbid',
    ...(reqDeposit !== undefined ? { requiresDeposit: reqDeposit } : {}),
  };
}

function findColonySupportNodes(
  state: PlanetState,
  colonyIndex: number,
): { hubAnchor: { q: number; r: number }; supportNodes: Array<{ q: number; r: number }> } {
  const cols = state.entities.cols;
  let hubAnchor: { q: number; r: number } | null = null;
  let hqAnchor: { q: number; r: number } | null = null;
  let podAnchor: { q: number; r: number } | null = null;
  const supportNodes: Array<{ q: number; r: number }> = [];

  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    const pos = { q: cols.q[row]!, r: cols.r[row]! };
    const kind = cols.kind[row];
    if (kind === ENTITY_KIND.commandHub) {
      if (!hubAnchor) hubAnchor = pos;
      supportNodes.push(pos);
    } else if (kind === ENTITY_KIND.hq) {
      if (!hqAnchor) hqAnchor = pos;
    } else if (kind === ENTITY_KIND.pod) {
      if (!podAnchor) podAnchor = pos;
    } else if (kind !== ENTITY_KIND.worker && kind !== ENTITY_KIND.devProbe) {
      supportNodes.push(pos);
    }
  }

  let fallbackAnchor = hubAnchor ?? hqAnchor ?? podAnchor;
  if (!fallbackAnchor) {
    const ownerLayer = state.grid.layers.owner as Int8Array;
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      if (ownerLayer[i] === colonyIndex) {
        fallbackAnchor = { q: hx.q[i]!, r: hx.r[i]! };
        break;
      }
    }
  }
  const resolvedHub = fallbackAnchor ?? { q: 0, r: 0 };
  if (supportNodes.length === 0) supportNodes.push(resolvedHub);
  return { hubAnchor: resolvedHub, supportNodes };
}

function detectGridFlags(state: PlanetState, colonyIndex: number): {
  colonyHasTerritory: boolean;
  planetHasRichness: boolean;
} {
  const ownerLayer = state.grid.layers.owner as Int8Array;
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
  richnessBp: number,
  directDepositMatch: boolean,
  ownedCount: number,
  preparedCount: number,
  gap: number,
  targetDist: number,
): number {
  const bonus = ownedCount * 100 + preparedCount * 25;
  if (spec.requiresDeposit !== undefined) {
    const anchorBonus = directDepositMatch ? 20000 : 5000;
    // Deposit buildings must sit on ore; among equal deposits prefer one that leaves a walkable lane.
    return anchorBonus + richnessBp - minSupportDist * 250 - distToHub * 100 + bonus + (laneTier(gap) === 0 ? 400 : 0);
  }
  if (spec.isHub) {
    return 15000 - distToHub * 300 + bonus;
  }
  if (spec.isBeacon) {
    return 12000 - Math.abs(distToHub - 8) * 300 + bonus;
  }
  if (spec.isPylon) {
    return 12000 - Math.abs(minSupportDist - 5) * 300 - distToHub * 50 + bonus;
  }
  // Ordinary buildings: keep a walkable lane (one free tile) and head for this building's organic target point around
  // the hub, so the base spreads out loosely instead of piling up beside the hub (`siteSpacing.ts`).
  return 10000 + (laneTier(gap) === 0 ? 3000 : 0) - targetDist * 250 + bonus;
}

interface SiteSearchContext {
  spec: SiteBuildingSpec;
  world: PlacementWorld;
  occupied: ReadonlySet<number>;
  colonyIndex: number;
  hubAnchor: { q: number; r: number };
  supportNodes: ReadonlyArray<{ q: number; r: number }>;
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
  const { spec, world, occupied, colonyIndex, hubAnchor, supportNodes, maxRadius, mustOwnAnchor } = ctx;
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

  const { richnessBp, directDepositMatch } = readCandidateRichnessBp(world, tileIndex, fpIndices, spec.requiresDeposit);
  if (spec.requiresDeposit !== undefined && richnessBp <= 0) return null;

  let minSupportDist = distToHub;
  for (const node of supportNodes) {
    const d = hexDistance(node.q, node.r, q, r);
    if (d < minSupportDist) minSupportDist = d;
  }

  const jitter = ctx.jitterCap > 0 ? Math.floor(ctx.drawRng() * (ctx.jitterCap + 1)) : 0;
  const score =
    scoreCandidateSite(
      spec, distToHub, minSupportDist, richnessBp, directDepositMatch, ownedCount, preparedCount,
      footprintGap(ctx.gaps, fpIndices), hexDistance(ctx.target.q, ctx.target.r, q, r),
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
  const { hubAnchor, supportNodes } = findColonySupportNodes(state, colonyIndex);
  const { colonyHasTerritory, planetHasRichness } = detectGridFlags(state, colonyIndex);
  const rawWorld = placementWorldFromState(state);
  const ctx: SiteSearchContext = {
    spec,
    world: planetHasRichness ? rawWorld : { ...rawWorld, richness: null },
    occupied: occupiedGroundTiles(state, opts?.data),
    colonyIndex,
    hubAnchor,
    supportNodes,
    maxRadius: opts?.maxRadius ?? DEFAULT_SITE_MAX_RADIUS,
    mustOwnAnchor: opts?.requireOwned ?? (colonyHasTerritory && !spec.isHub),
    jitterCap: opts?.jitterBp && opts.jitterBp > 0 ? Math.trunc(opts.jitterBp) : 0,
    gaps: buildGapField(state.grid.radius, collectReservedTiles(state, colonyIndex, opts?.data)),
    target: organicTarget(hubAnchor, colonyIndex, buildingFootprints(state, opts?.data).length),
    drawRng: opts?.rng ?? (() => nextFloat(state.rng.ai)),
    data: opts?.data,
  };

  const hx = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int8Array;
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
