import {
  W11_DEFAULT_SECTOR_RADIUS,
  type PlanetType,
  type ResourceKey,
  type SectorId,
} from '@terra/contracts';
import { hash2d, seedOf } from '../gen/world/noise';
import { hexIndex } from '../grid/hex';
import { DEPOSIT } from '../grid/layers';
import type { PlanetState } from '../kernel/state';
import { globalTileToSector } from './partition';
import { CANONICAL_RESOURCE_KEYS } from './regionalResourcePresets';
import {
  resolveAtlasRegionalResources,
  resolveSectorResourceProfile,
} from './regionalResources';
import type {
  DepositTileAttribution,
  FootprintDepositAttributionReport,
  FootprintSectorAttributionSummary,
  ResolvedAtlasResourceProfile,
  ResolvedSectorResourceProfile,
} from './regionalResourceTypes';
import type { AtlasBlobValue, GeneratedSmallAtlas } from './types';

function readAtlasBlobFromState(state: PlanetState): AtlasBlobValue | null {
  const raw = state.blobs.atlas as { value?: unknown } | AtlasBlobValue | undefined;
  if (!raw) return null;
  if ('value' in raw && raw.value && typeof raw.value === 'object') {
    return raw.value as AtlasBlobValue;
  }
  return raw as AtlasBlobValue;
}

export function depositKindAndTierToResourceKey(
  depositKind: number,
  depositTier = 0,
): ResourceKey | null {
  const tier = Math.max(0, Math.min(2, Math.trunc(depositTier)));
  if (depositKind === DEPOSIT.metals) {
    return tier === 0 ? 'metals.t1' : tier === 1 ? 'metals.t2' : 'metals.t3';
  }
  if (depositKind === DEPOSIT.minerals) {
    return tier === 0 ? 'minerals.t1' : tier === 1 ? 'minerals.t2' : 'minerals.t3';
  }
  if (depositKind === DEPOSIT.oil) {
    return tier >= 2 ? 'bio.t3' : 'bio.t2';
  }
  return null;
}

export function resourceKeyTierNumber(key: ResourceKey): 1 | 2 | 3 {
  if (key.endsWith('.t3')) return 3;
  if (key.endsWith('.t2')) return 2;
  return 1;
}

/**
 * Selects an optional (non-starter) deposit kind and tier from a sector's resolved regional profile (`ECON-GEO-01`).
 * All-zero eligible weights produce `DEPOSIT.none` rather than a uniform fallback.
 */
export function selectOptionalDepositFromSectorProfile(params: {
  readonly q: number;
  readonly r: number;
  readonly seedDepositKind: number;
  readonly baseRichnessBp: (kind: number) => number;
  readonly sectorProfile: ResolvedSectorResourceProfile;
}): { readonly deposit: number; readonly depositTier: number; readonly richness: number } {
  const res = params.sectorProfile.resources;
  const metalsW =
    res['metals.t1'].occurrenceWeightBp +
    res['metals.t2'].occurrenceWeightBp +
    res['metals.t3'].occurrenceWeightBp;
  const mineralsW =
    res['minerals.t1'].occurrenceWeightBp +
    res['minerals.t2'].occurrenceWeightBp +
    res['minerals.t3'].occurrenceWeightBp;
  const oilW = res['bio.t2'].occurrenceWeightBp + res['bio.t3'].occurrenceWeightBp;
  const totalFamilyW = metalsW + mineralsW + oilW;
  if (totalFamilyW <= 0) return { deposit: DEPOSIT.none, depositTier: 0, richness: 0 };

  const uFamily = hash2d(params.q, params.r, params.seedDepositKind) * totalFamilyW;
  let deposit: number;
  let tierWeights: readonly [number, number, number];
  let tierKeys: readonly [ResourceKey, ResourceKey, ResourceKey];

  if (uFamily < metalsW) {
    deposit = DEPOSIT.metals;
    tierWeights = [
      res['metals.t1'].occurrenceWeightBp,
      res['metals.t2'].occurrenceWeightBp,
      res['metals.t3'].occurrenceWeightBp,
    ];
    tierKeys = ['metals.t1', 'metals.t2', 'metals.t3'];
  } else if (uFamily < metalsW + mineralsW) {
    deposit = DEPOSIT.minerals;
    tierWeights = [
      res['minerals.t1'].occurrenceWeightBp,
      res['minerals.t2'].occurrenceWeightBp,
      res['minerals.t3'].occurrenceWeightBp,
    ];
    tierKeys = ['minerals.t1', 'minerals.t2', 'minerals.t3'];
  } else {
    deposit = DEPOSIT.oil;
    tierWeights = [res['bio.t2'].occurrenceWeightBp, 0, res['bio.t3'].occurrenceWeightBp];
    tierKeys = ['bio.t2', 'bio.t2', 'bio.t3'];
  }

  const tierSum = tierWeights[0] + tierWeights[1] + tierWeights[2];
  if (tierSum <= 0) return { deposit: DEPOSIT.none, depositTier: 0, richness: 0 };

  const uTier = hash2d(params.q, params.r, (params.seedDepositKind ^ 0x5bd1e995) >>> 0) * tierSum;
  const depositTier = uTier < tierWeights[0] ? 0 : uTier < tierWeights[0] + tierWeights[1] ? 1 : 2;
  const selectedKey = tierKeys[depositTier]!;
  const yieldBp = res[selectedKey].extractionYieldBp;
  const richness = Math.max(1, Math.round((params.baseRichnessBp(deposit) * yieldBp) / 10000));
  return { deposit, depositTier, richness };
}

function footprintCoordsFromAnchor(
  anchorQ: number,
  anchorR: number,
  w = 2,
  d = 2,
  rot = 0,
): Array<{ q: number; r: number; depositKind?: number; depositTier?: number; richness?: number }> {
  const width = Math.max(1, Math.trunc(w));
  const depth = Math.max(1, Math.trunc(d));
  if (width === 1 && depth === 1) return [{ q: anchorQ, r: anchorR }];
  const swap = rot % 2 !== 0;
  const fw = swap ? depth : width;
  const fd = swap ? width : depth;
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  const coords: Array<{ q: number; r: number }> = [];
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      coords.push({ q: anchorQ + minQ + dq, r: anchorR + minR + dr });
    }
  }
  return coords;
}

export interface ResolveDepositTileAttributionOptions {
  readonly q: number;
  readonly r: number;
  readonly atlas?: GeneratedSmallAtlas;
  readonly state?: PlanetState;
  readonly regionalResources?: ResolvedAtlasResourceProfile;
  readonly sectorProfile?: ResolvedSectorResourceProfile;
  readonly planetType?: PlanetType;
  readonly sectorRadius?: number;
  readonly depositKind?: number;
  readonly depositTier?: number;
  readonly richness?: number;
}

function readTileDepositFromSource(opts: ResolveDepositTileAttributionOptions): {
  sectorRadius: number;
  planetType: PlanetType;
  depositKind: number;
  depositTier: number;
  richness: number;
} {
  if (opts.atlas) {
    const t = opts.atlas.getTile(opts.q, opts.r) ?? opts.atlas.sampleGlobalTile(opts.q, opts.r);
    return {
      sectorRadius: opts.sectorRadius ?? opts.atlas.sectorRadius,
      planetType: opts.planetType ?? opts.atlas.planetType,
      depositKind: opts.depositKind ?? t.deposit,
      depositTier: opts.depositTier ?? t.depositTier,
      richness: opts.richness ?? t.richness,
    };
  }
  if (opts.state) {
    const blob = readAtlasBlobFromState(opts.state);
    const sectorRadius = opts.sectorRadius ?? blob?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
    const idx = hexIndex(opts.state.grid.radius).indexOf(opts.q, opts.r);
    const L = opts.state.grid.layers;
    return {
      sectorRadius,
      planetType: opts.planetType ?? opts.state.meta.planetType,
      depositKind: opts.depositKind ?? (idx >= 0 ? (L.deposit[idx] ?? DEPOSIT.none) : DEPOSIT.none),
      depositTier: opts.depositTier ?? (idx >= 0 ? (L.depositTier?.[idx] ?? 0) : 0),
      richness: opts.richness ?? (idx >= 0 ? (L.richness[idx] ?? 0) : 0),
    };
  }
  return {
    sectorRadius: opts.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS,
    planetType: opts.planetType ?? opts.sectorProfile?.planetType ?? 'temperate',
    depositKind: opts.depositKind ?? DEPOSIT.none,
    depositTier: opts.depositTier ?? 0,
    richness: opts.richness ?? 0,
  };
}

/**
 * Resolves a tile's deposit attribution strictly by the deposit tile's canonical `sectorId`
 * (`globalTileToSector(q, r, sectorRadius).sectorId`), never by a building centroid or colony owner (`ECON-GEO-02`).
 */
export function resolveDepositTileAttribution(
  opts: ResolveDepositTileAttributionOptions,
): DepositTileAttribution {
  const { sectorRadius, planetType, depositKind, depositTier, richness } = readTileDepositFromSource(opts);
  const sectorId = globalTileToSector(opts.q, opts.r, sectorRadius).sectorId;
  const atlasRegional = opts.regionalResources ?? opts.atlas?.regionalResources;
  const secProfile =
    opts.sectorProfile ??
    atlasRegional?.sectorById.get(sectorId) ??
    resolveSectorResourceProfile({ planetType, sectorId, kind: 'land' });
  const resourceKey = depositKindAndTierToResourceKey(depositKind, depositTier);
  const entry = resourceKey ? secProfile.resources[resourceKey] : null;

  return {
    q: opts.q,
    r: opts.r,
    sectorId,
    depositKind,
    depositTier,
    richness,
    resourceKey,
    sectorProfileId: secProfile.profileId,
    sectorResourceHash: secProfile.sectorResourceHash,
    extractionYieldBp: entry?.extractionYieldBp ?? 10000,
    reserveUnitsMin: entry?.reserveUnitsMin ?? 0,
    reserveUnitsMax: entry?.reserveUnitsMax ?? 0,
    sourceLayer: entry?.sourceLayer ?? secProfile.sourceLayer,
    contractSourceLayer: entry?.contractSourceLayer ?? secProfile.contractSourceLayer,
  };
}

export interface ResolveFootprintDepositAttributionOptions {
  readonly anchorQ: number;
  readonly anchorR: number;
  readonly footprintW?: number;
  readonly footprintD?: number;
  readonly rot?: number;
  readonly tiles?: ReadonlyArray<{
    readonly q: number;
    readonly r: number;
    readonly depositKind?: number;
    readonly depositTier?: number;
    readonly richness?: number;
  }>;
  readonly atlas?: GeneratedSmallAtlas;
  readonly state?: PlanetState;
  readonly regionalResources?: ResolvedAtlasResourceProfile;
  readonly planetType?: PlanetType;
  readonly sectorRadius?: number;
  readonly ownerColonyIndex?: number;
  readonly ownerFoundingSectorId?: SectorId;
  readonly depotSectorId?: SectorId;
}

function summarizeFootprintSectors(depositTiles: readonly DepositTileAttribution[]): {
  attributedSectorIds: SectorId[];
  primaryAttributedSectorId: SectorId | null;
  productionBySector: Record<SectorId, FootprintSectorAttributionSummary>;
} {
  const summaryMap = new Map<
    SectorId,
    {
      sectorResourceHash: string;
      depositTileCount: number;
      resourceKeySet: Set<ResourceKey>;
      totalWeightedRichnessBp: number;
    }
  >();

  for (const attr of depositTiles) {
    if (!attr.resourceKey) continue;
    const weightedRichness = Math.round(
      ((attr.richness > 0 ? attr.richness : 10000) * attr.extractionYieldBp) / 10000,
    );
    let cur = summaryMap.get(attr.sectorId);
    if (!cur) {
      cur = {
        sectorResourceHash: attr.sectorResourceHash,
        depositTileCount: 0,
        resourceKeySet: new Set<ResourceKey>(),
        totalWeightedRichnessBp: 0,
      };
      summaryMap.set(attr.sectorId, cur);
    }
    cur.depositTileCount += 1;
    cur.resourceKeySet.add(attr.resourceKey);
    cur.totalWeightedRichnessBp += weightedRichness;
  }

  const attributedSectorIds = [...summaryMap.keys()].sort();
  const productionBySector: Record<SectorId, FootprintSectorAttributionSummary> = {};
  let primaryAttributedSectorId: SectorId | null = null;
  let bestRichness = -1;
  for (const secId of attributedSectorIds) {
    const s = summaryMap.get(secId)!;
    productionBySector[secId] = {
      sectorId: secId,
      sectorResourceHash: s.sectorResourceHash,
      depositTileCount: s.depositTileCount,
      resourceKeys: [...s.resourceKeySet].sort(
        (a, b) => CANONICAL_RESOURCE_KEYS.indexOf(a) - CANONICAL_RESOURCE_KEYS.indexOf(b),
      ),
      totalWeightedRichnessBp: s.totalWeightedRichnessBp,
    };
    if (s.totalWeightedRichnessBp > bestRichness) {
      bestRichness = s.totalWeightedRichnessBp;
      primaryAttributedSectorId = secId;
    }
  }
  return { attributedSectorIds, primaryAttributedSectorId, productionBySector };
}

/**
 * Resolves cross-border building/extractor footprint resource attribution per actual deposit tile (`ECON-GEO-02`).
 * Output is attributed to each deposit tile's canonical `sectorId`, never to the building centroid,
 * anchor tile, colony founding sector, or supply depot sector.
 */
export function resolveFootprintDepositAttribution(
  opts: ResolveFootprintDepositAttributionOptions,
): FootprintDepositAttributionReport {
  const sectorRadius =
    opts.sectorRadius ??
    opts.atlas?.sectorRadius ??
    (opts.state ? readAtlasBlobFromState(opts.state)?.sectorRadius : undefined) ??
    W11_DEFAULT_SECTOR_RADIUS;
  const planetType = opts.planetType ?? opts.atlas?.planetType ?? opts.state?.meta.planetType ?? 'temperate';
  const regionalResources =
    opts.regionalResources ?? opts.atlas?.regionalResources ?? resolveAtlasRegionalResources({ planetType });

  const rawTiles =
    opts.tiles ??
    footprintCoordsFromAnchor(opts.anchorQ, opts.anchorR, opts.footprintW ?? 2, opts.footprintD ?? 2, opts.rot ?? 0);
  const sortedTiles = [...rawTiles].sort((a, b) => a.q - b.q || a.r - b.r);

  const anchorSectorId = globalTileToSector(opts.anchorQ, opts.anchorR, sectorRadius).sectorId;
  const meanQ =
    sortedTiles.length > 0 ? Math.round(sortedTiles.reduce((s, t) => s + t.q, 0) / sortedTiles.length) : opts.anchorQ;
  const meanR =
    sortedTiles.length > 0 ? Math.round(sortedTiles.reduce((s, t) => s + t.r, 0) / sortedTiles.length) : opts.anchorR;
  const centroidSectorId = globalTileToSector(meanQ, meanR, sectorRadius).sectorId;

  const footprintSectorSet = new Set<SectorId>();
  const depositTiles: DepositTileAttribution[] = [];
  for (const tile of sortedTiles) {
    const attr = resolveDepositTileAttribution({
      q: tile.q,
      r: tile.r,
      atlas: opts.atlas,
      state: opts.state,
      regionalResources,
      planetType,
      sectorRadius,
      depositKind: tile.depositKind,
      depositTier: tile.depositTier,
      richness: tile.richness,
    });
    footprintSectorSet.add(attr.sectorId);
    if (attr.depositKind !== DEPOSIT.none && attr.resourceKey !== null) {
      depositTiles.push(attr);
    }
  }

  const footprintSectorIds = [...footprintSectorSet].sort();
  const { attributedSectorIds, primaryAttributedSectorId, productionBySector } =
    summarizeFootprintSectors(depositTiles);

  return {
    anchorQ: opts.anchorQ,
    anchorR: opts.anchorR,
    anchorSectorId,
    centroidSectorId,
    ...(opts.ownerColonyIndex !== undefined ? { ownerColonyIndex: opts.ownerColonyIndex } : {}),
    ...(opts.ownerFoundingSectorId ? { ownerFoundingSectorId: opts.ownerFoundingSectorId } : {}),
    ...(opts.depotSectorId ? { depotSectorId: opts.depotSectorId } : {}),
    footprintSectorIds,
    straddlesSectorBoundary: footprintSectorIds.length > 1,
    depositTiles,
    attributedSectorIds,
    primaryAttributedSectorId,
    productionBySector,
  };
}

/**
 * Resolves a deterministic terraforming discovery resource for `(q, r)` (`ECON-GEO-01`, `ECON-GEO-02`).
 * Seeded once by stable `(seed, q, r, eventKind)` identity so repeated terraform/cancel/reload cannot reroll,
 * and weighted strictly by the sector's `terraformFindWeightBp` within `maxTier <= unlockTier`.
 */
export function resolveTerraformDiscoveryResource(params: {
  readonly seed: string;
  readonly q: number;
  readonly r: number;
  readonly eventKind?: string;
  readonly unlockTier?: 1 | 2 | 3;
  readonly sectorProfile: ResolvedSectorResourceProfile;
}): {
  readonly sectorId: SectorId;
  readonly resourceKey: ResourceKey | null;
  readonly sourceLayer: ResolvedSectorResourceProfile['sourceLayer'];
  readonly weightBp: number;
  readonly shareBp: number;
} {
  const maxTier = params.unlockTier ?? 3;
  const eligible = CANONICAL_RESOURCE_KEYS.filter(
    (k) => resourceKeyTierNumber(k) <= maxTier && params.sectorProfile.resources[k].terraformFindWeightBp > 0,
  );
  const totalWeight = eligible.reduce((sum, k) => sum + params.sectorProfile.resources[k].terraformFindWeightBp, 0);
  if (totalWeight <= 0 || eligible.length === 0) {
    return {
      sectorId: params.sectorProfile.sectorId,
      resourceKey: null,
      sourceLayer: params.sectorProfile.sourceLayer,
      weightBp: 0,
      shareBp: 0,
    };
  }

  const eventSeed = seedOf(`${params.seed}|${params.sectorProfile.sectorId}|${params.eventKind ?? 'terraform_find'}`);
  const u = hash2d(params.q, params.r, eventSeed) * totalWeight;
  let acc = 0;
  let chosen: ResourceKey = eligible[eligible.length - 1]!;
  for (const key of eligible) {
    acc += params.sectorProfile.resources[key].terraformFindWeightBp;
    if (u < acc) {
      chosen = key;
      break;
    }
  }
  const entry = params.sectorProfile.resources[chosen];
  return {
    sectorId: params.sectorProfile.sectorId,
    resourceKey: chosen,
    sourceLayer: entry.sourceLayer,
    weightBp: entry.terraformFindWeightBp,
    shareBp: Math.round((entry.terraformFindWeightBp * 10000) / totalWeight),
  };
}
