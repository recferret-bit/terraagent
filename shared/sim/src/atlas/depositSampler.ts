import { profileNum } from '../gen/profile';
import { fbm2d, hash2d } from '../gen/world/noise';
import { HEX_DIRS, levelledFlatHeight } from '../grid/hex';
import { HEX_LEVEL_EPS_M, isOpenGround } from '../grid/hexTile';
import { DEPOSIT, TERRAIN } from '../grid/layers';
import type { PlanetType } from '../kernel/state';
import { packAtlasCoord } from './landingPlan';
import { globalTileToSector } from './partition';
import {
  W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
  selectOptionalDepositFromSectorProfile,
} from './regionalResources';
import { sampleBaseAtlasTile, type AtlasSamplerContext, type BaseSampledTile } from './sampler';
import type { SampledAtlasTileValues } from './types';

const DEPOSIT_CYCLE = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

const RICHNESS_MOD_FIELD: Readonly<Record<number, string>> = {
  [DEPOSIT.metals]: 'metalsRichnessModBp',
  [DEPOSIT.minerals]: 'mineralsRichnessModBp',
  [DEPOSIT.oil]: 'oilRichnessModBp',
};

export function isGlobalHexTile(q: number, r: number, ctx: AtlasSamplerContext): boolean {
  const center = sampleBaseAtlasTile(q, r, ctx);
  if (!center.isLandSector || center.distanceToOcean < 3) return false;
  if (!isOpenGround(center.terrain, center.prep)) return false;
  const h0 = levelledFlatHeight(center.height);
  for (const [dq, dr] of HEX_DIRS) {
    const nb = sampleBaseAtlasTile(q + dq, r + dr, ctx);
    if (!nb.isLandSector || !isOpenGround(nb.terrain, nb.prep)) return false;
    if (Math.abs(levelledFlatHeight(nb.height) - h0) > HEX_LEVEL_EPS_M) return false;
  }
  return true;
}

function depositCandidateScore(q: number, r: number, mx: number, my: number, ctx: AtlasSamplerContext): number {
  const base = fbm2d(mx, my, 0.18, ctx.seedDeposit) * 0.72 + hash2d(q, r, ctx.seedDeposit) * 0.28;
  return base + q * 1e-7 + r * 1e-9;
}

function computeGlobalRichnessBp(q: number, r: number, kind: number, seed: number, planetType: PlanetType): number {
  if (kind === DEPOSIT.none) return 0;
  const minBp = profileNum(planetType, 'richnessMinBp', 9000);
  const maxBp = profileNum(planetType, 'richnessMaxBp', 12000);
  const span = Math.max(1, maxBp - minBp + 1);
  const baseBp = minBp + Math.floor(hash2d(q, r, seed) * span);
  const modBp = profileNum(planetType, RICHNESS_MOD_FIELD[kind] ?? '', 10000);
  return Math.round((baseBp * modBp) / 10000);
}

function sampleSubsurfaceVein(
  q: number,
  r: number,
  base: BaseSampledTile,
  ctx: AtlasSamplerContext,
): { subDeposit: number; subRichness: number } {
  const chanceByTerrain: Readonly<Record<number, number>> = {
    [TERRAIN.rock]: ctx.num('subRock', 0.3),
    [TERRAIN.slope]: ctx.num('subSlope', 0.1),
    [TERRAIN.forest]: ctx.num('subForest', 0.12),
    [TERRAIN.flat]: ctx.num('subFlat', 0.03),
  };
  const kindsByTerrain: Readonly<Record<number, readonly number[]>> = {
    [TERRAIN.rock]: [DEPOSIT.metals, DEPOSIT.minerals],
    [TERRAIN.slope]: [DEPOSIT.minerals, DEPOSIT.oil],
    [TERRAIN.forest]: [DEPOSIT.metals, DEPOSIT.minerals],
    [TERRAIN.flat]: [DEPOSIT.oil],
  };
  const p = chanceByTerrain[base.terrain] ?? 0;
  if (p <= 0) return { subDeposit: DEPOSIT.none, subRichness: 0 };

  const v = fbm2d(base.mx, base.my, 0.045, ctx.seedSubVein);
  if (v < 0.5 + (0.5 - p) * 0.55) return { subDeposit: DEPOSIT.none, subRichness: 0 };

  const ks = kindsByTerrain[base.terrain]!;
  const kind = ks[Math.floor(hash2d(q, r, ctx.seedSubKind) * ks.length)]!;
  const boost = ctx.num('subRichnessBoostBp', 12500);
  const subRichness = Math.round(
    (computeGlobalRichnessBp(q, r, kind, ctx.seedSubKind ^ 0x27d4eb2d, ctx.planetType) * boost) / 10000,
  );
  return { subDeposit: kind, subRichness };
}

export function sampleAtlasTile(q: number, r: number, ctx: AtlasSamplerContext): SampledAtlasTileValues {
  const base = sampleBaseAtlasTile(q, r, ctx);
  let deposit: number = DEPOSIT.none;
  let depositTier = 0;
  let richness = 0;

  const coordKey = packAtlasCoord(q, r);
  const starterKind = base.isLandSector ? ctx.landingPlan?.starterDepositsByCoord.get(coordKey) : undefined;
  const suppressed = ctx.landingPlan?.suppressedDepositCoords.has(coordKey) ?? false;

  if (starterKind !== undefined) {
    deposit = starterKind;
    depositTier = 0;
    richness = computeGlobalRichnessBp(q, r, deposit, ctx.seedRichness, ctx.planetType);
  } else if (!suppressed && isGlobalHexTile(q, r, ctx)) {
    const myScore = depositCandidateScore(q, r, base.mx, base.my, ctx);
    const baseThreshold = ctx.planetType === 'desert' ? 0.5 : 0.56;
    const ownerSectorId = ctx.hasCustomRegionalResources
      ? globalTileToSector(q, r, ctx.sectorRadius).sectorId
      : undefined;
    const secProfile = ownerSectorId
      ? (ctx.regionalResources.sectorById.get(ownerSectorId) ?? ctx.regionalResources.planetEndowment)
      : undefined;
    const density = secProfile?.depositDensityPer1000Tiles ?? W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000;
    const densityDelta =
      secProfile && density !== W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000
        ? Math.max(-0.2, Math.min(0.2, ((W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000 - density) / 100) * 0.8))
        : 0;
    const threshold = density <= 0 ? 1e9 : baseThreshold + densityDelta;

    if (myScore >= threshold) {
      let isLocalMax = true;
      for (const [dq, dr] of HEX_DIRS) {
        const nq = q + dq;
        const nr = r + dr;
        const nb = sampleBaseAtlasTile(nq, nr, ctx);
        if (depositCandidateScore(nq, nr, nb.mx, nb.my, ctx) >= myScore) {
          isLocalMax = false;
          break;
        }
      }
      if (isLocalMax) {
        if (secProfile && ctx.hasCustomRegionalResources) {
          const picked = selectOptionalDepositFromSectorProfile({
            q,
            r,
            seedDepositKind: ctx.seedDepositKind,
            baseRichnessBp: (kind) => computeGlobalRichnessBp(q, r, kind, ctx.seedRichness, ctx.planetType),
            sectorProfile: secProfile,
          });
          deposit = picked.deposit;
          depositTier = picked.depositTier;
          richness = picked.richness;
        } else {
          const cycleIdx = Math.floor(hash2d(q, r, ctx.seedDepositKind) * DEPOSIT_CYCLE.length);
          deposit = DEPOSIT_CYCLE[cycleIdx]!;
          depositTier = 0;
          richness = computeGlobalRichnessBp(q, r, deposit, ctx.seedRichness, ctx.planetType);
        }
      }
    }
  }

  const sub =
    base.isLandSector && deposit === DEPOSIT.none
      ? sampleSubsurfaceVein(q, r, base, ctx)
      : { subDeposit: DEPOSIT.none, subRichness: 0 };

  return {
    q: base.q,
    r: base.r,
    isLandSector: base.isLandSector,
    distanceToOcean: base.distanceToOcean,
    distanceToLand: base.distanceToLand,
    terrain: base.terrain,
    prep: base.prep,
    height: base.height,
    deposit,
    depositTier,
    richness,
    subDeposit: sub.subDeposit,
    subRichness: sub.subRichness,
  };
}
