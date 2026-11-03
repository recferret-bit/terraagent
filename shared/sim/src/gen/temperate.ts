import { hexDistance, hexIndex } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { nextInt, nextU32, seedStream } from '../kernel/rng';
import type { PlanetState, PlanetType } from '../kernel/state';
import { profileNum, profileNumber, worldProfile, type ProfileRow } from './profile';
import { fbm2d, hash2d } from './world/noise';

const SQRT3_HALF = 0.8660254;
const DEPOSIT_CYCLE = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

/** Terrain class shares in basis points (the temperate classifier fills exactly these quotas). */
export interface TerrainShares { flat: number; forest: number; rock: number; slope: number; hole: number; shallow: number; deep: number }

/** The class shares of a quota profile (`share<Class>` fields of its `data/worldgen.ts` row, else temperate's). */
export function profileShares(profile: ProfileRow): TerrainShares {
  const temperate = worldProfile('temperate');
  const n = (field: string) => profileNumber(profile, field, profileNumber(temperate, field, 0));
  return {
    flat: n('shareFlat'), forest: n('shareForest'), rock: n('shareRock'), slope: n('shareSlope'),
    hole: n('shareHole'), shallow: n('shareShallow'), deep: n('shareDeep'),
  };
}

const RICHNESS_MOD_FIELD: Readonly<Record<number, string>> = {
  [DEPOSIT.metals]: 'metalsRichnessModBp',
  [DEPOSIT.minerals]: 'mineralsRichnessModBp',
  [DEPOSIT.oil]: 'oilRichnessModBp',
};

/**
 * Deterministic deposit richness in basis points for `(seed, tileIdx, kind, planetType)`.
 * Base richness is drawn in `[richnessMinBp, richnessMaxBp]` (9000..12000) and scaled by the planet's per-resource
 * modifier from its `data/worldgen.ts` row (`temperate` Minerals +15% -> `10350..13800` bp, D-33).
 */
export function getDepositRichnessBp(
  seed: string,
  tileIdx: number,
  kind: number,
  planetType: PlanetType = 'temperate',
): number {
  if (kind === DEPOSIT.none) return 0;
  const rng = seedStream(seed, `gen:richness:${tileIdx}`);
  const baseBp = nextInt(rng, profileNum(planetType, 'richnessMinBp', 9000), profileNum(planetType, 'richnessMaxBp', 12000));
  const modBp = profileNum(planetType, RICHNESS_MOD_FIELD[kind] ?? '', 10000);
  return Math.round((baseBp * modBp) / 10000);
}

/** Temperate relief + classification by quota (rank of elevation / basin / moisture fields), heights in metres. */
export function assignTemperateTerrain(s: PlanetState, SHARE_BP: TerrainShares = profileShares(worldProfile(s.meta.planetType))): void {
  const { radius, count, layers } = s.grid;
  const terrain = layers.terrain as Uint8Array;
  const prep = layers.prep as Uint8Array;
  const height = layers.height as Float32Array;
  const hex = hexIndex(radius);
  const rng = s.rng.gen;

  const elevSeed = nextU32(rng);
  const moistSeed = nextU32(rng);
  const basinSeed = nextU32(rng);
  const jitterBp = nextInt(rng, -40, 40);

  const elev = new Float32Array(count);
  const moist = new Float32Array(count);
  const basin = new Float32Array(count);
  const order: number[] = [];

  for (let i = 0; i < count; i++) {
    const q = hex.q[i];
    const r = hex.r[i];
    const x = Math.fround(q + 0.5 * r);
    const y = Math.fround(r * SQRT3_HALF);
    elev[i] = fbm2d(x, y, 0.065, elevSeed);
    moist[i] = fbm2d(x, y, 0.075, moistSeed);
    basin[i] = fbm2d(x, y, 0.12, basinSeed);
    order.push(i);
  }

  order.sort((a, b) => elev[a] - elev[b] || a - b);

  const deepCount = Math.round((count * SHARE_BP.deep) / 10000);
  const shallowCount = Math.round((count * SHARE_BP.shallow) / 10000);
  const rockCount = Math.round((count * SHARE_BP.rock) / 10000);
  const slopeCount = Math.round((count * SHARE_BP.slope) / 10000);
  const holeCount = Math.round((count * SHARE_BP.hole) / 10000);
  const forestCount = Math.round((count * (SHARE_BP.forest + jitterBp)) / 10000);

  const waterEnd = deepCount + shallowCount;
  const highStart = count - rockCount - slopeCount;
  const rockStart = count - rockCount;

  for (let rank = 0; rank < deepCount; rank++) {
    const i = order[rank];
    terrain[i] = TERRAIN.deep;
    height[i] = Math.fround(-0.6 + (0.3 * rank) / Math.max(1, deepCount));
  }
  for (let rank = deepCount; rank < waterEnd; rank++) {
    const i = order[rank];
    terrain[i] = TERRAIN.shallow;
    height[i] = Math.fround(-0.25 + (0.2 * (rank - deepCount)) / Math.max(1, shallowCount));
  }
  for (let rank = highStart; rank < rockStart; rank++) {
    const i = order[rank];
    terrain[i] = TERRAIN.slope;
    height[i] = Math.fround(0.3 + (0.25 * (rank - highStart)) / Math.max(1, slopeCount));
  }
  for (let rank = rockStart; rank < count; rank++) {
    const i = order[rank];
    terrain[i] = TERRAIN.rock;
    height[i] = Math.fround(0.55 + (0.4 * (rank - rockStart)) / Math.max(1, rockCount));
  }

  const mid = order.slice(waterEnd, highStart);
  mid.sort((a, b) => basin[a] - basin[b] || a - b);

  for (let k = 0; k < holeCount && k < mid.length; k++) {
    const i = mid[k];
    terrain[i] = TERRAIN.hole;
    height[i] = Math.fround(-0.35 + 0.08 * basin[i]);
  }

  const land = mid.slice(holeCount);
  land.sort((a, b) => moist[b] - moist[a] || a - b);

  for (let k = 0; k < land.length; k++) {
    const i = land[k];
    if (k < forestCount) {
      terrain[i] = TERRAIN.forest;
      height[i] = Math.fround(0.08 + 0.2 * moist[i]);
    } else {
      terrain[i] = TERRAIN.flat;
      height[i] = Math.fround(0.02 + 0.14 * elev[i]);
    }
  }

  for (let i = 0; i < count; i++) {
    prep[i] = terrain[i] === TERRAIN.flat ? PREP.flat : PREP.wild;
  }
}

/** Visible deposits: ~4 % of land tiles, spaced ≥ 2 apart, cycling metals / minerals / oil. */
export function assignTemperateDeposits(s: PlanetState): void {
  const { radius, count, layers } = s.grid;
  const terrain = layers.terrain as Uint8Array;
  const deposit = layers.deposit as Uint8Array;
  const richness = layers.richness as Float32Array;
  const hex = hexIndex(radius);
  const rng = s.rng.gen;

  const depSeed = nextU32(rng);
  const kindOffset = nextInt(rng, 0, 2);
  const scores = new Float32Array(count);
  const candidates: number[] = [];

  for (let i = 0; i < count; i++) {
    const t = terrain[i];
    if (t !== TERRAIN.flat && t !== TERRAIN.slope) continue;
    const q = hex.q[i];
    const r = hex.r[i];
    const x = Math.fround(q + 0.5 * r);
    const y = Math.fround(r * SQRT3_HALF);
    const bonus = t === TERRAIN.flat ? 0.15 : 0.08;
    scores[i] = Math.fround(fbm2d(x, y, 0.18, depSeed) + bonus + hash2d(q, r, depSeed) * 0.2);
    candidates.push(i);
  }

  candidates.sort((a, b) => scores[b] - scores[a] || a - b);

  const targetCount = Math.min(candidates.length, Math.max(3, Math.round(count * 0.04)));
  const chosen: number[] = [];

  for (let c = 0; c < candidates.length && chosen.length < targetCount; c++) {
    const idx = candidates[c];
    const q = hex.q[idx];
    const r = hex.r[idx];
    let tooClose = false;
    for (let j = 0; j < chosen.length; j++) {
      const other = chosen[j];
      if (hexDistance(q, r, hex.q[other], hex.r[other]) < 2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) chosen.push(idx);
  }

  for (let c = 0; c < candidates.length && chosen.length < targetCount; c++) {
    const idx = candidates[c];
    if (!chosen.includes(idx)) chosen.push(idx);
  }

  const { seed, planetType } = s.meta;
  for (let k = 0; k < chosen.length; k++) {
    const i = chosen[k];
    const kind = DEPOSIT_CYCLE[(k + kindOffset) % DEPOSIT_CYCLE.length];
    deposit[i] = kind;
    richness[i] = getDepositRichnessBp(seed, i, kind, planetType);
  }
}
