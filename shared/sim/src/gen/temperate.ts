import terrainTable from '../data/terrain';
import { hexDistance, hexIndex } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { nextInt, nextU32, seedStream } from '../kernel/rng';
import { createState, type PlanetState, type PlanetType } from '../kernel/state';
import { registerGenerator, type PlanetParams } from './generators';

const SQRT3_HALF = 0.8660254;
const DEPOSIT_CYCLE = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

function readShareBp(id: string, fallback: number): number {
  const row = terrainTable.rows.find((r) => r.id === id) as Record<string, unknown> | undefined;
  return typeof row?.temperateShareBp === 'number' ? row.temperateShareBp : fallback;
}

function readTemperateNum(field: string, fallback: number): number {
  const row = terrainTable.rows.find((r) => r.id === 'temperate') as Record<string, unknown> | undefined;
  return typeof row?.[field] === 'number' ? (row[field] as number) : fallback;
}

const SHARE_BP = {
  flat: readShareBp('flat', 4500),
  forest: readShareBp('forest', 2500),
  rock: readShareBp('rock', 800),
  slope: readShareBp('slope', 1000),
  hole: readShareBp('hole', 200),
  shallow: readShareBp('shallow', 600),
  deep: readShareBp('deep', 400),
} as const;

const RICHNESS_CFG = {
  minBp: readTemperateNum('richnessMinBp', 9000),
  maxBp: readTemperateNum('richnessMaxBp', 12000),
  metalsModBp: readTemperateNum('metalsRichnessModBp', 10000),
  mineralsModBp: readTemperateNum('mineralsRichnessModBp', 11500),
  oilModBp: readTemperateNum('oilRichnessModBp', 10000),
} as const;

function richnessModBp(kind: number, planetType: PlanetType): number {
  if (planetType === 'desert') {
    return kind === DEPOSIT.metals || kind === DEPOSIT.minerals ? 11500 : 10000;
  }
  if (planetType === 'ocean') {
    if (kind === DEPOSIT.oil) return 12000;
    if (kind === DEPOSIT.metals) return 8500;
    return 10000;
  }
  if (kind === DEPOSIT.minerals) return RICHNESS_CFG.mineralsModBp;
  if (kind === DEPOSIT.metals) return RICHNESS_CFG.metalsModBp;
  return RICHNESS_CFG.oilModBp;
}

/**
 * Deterministic deposit richness in basis points for `(seed, tileIdx, kind, planetType)`.
 * Base richness is drawn in `[9000, 12000]` bp and scaled by the planet's per-resource modifier
 * (`temperate` Minerals +15% -> `10350..13800` bp, D-33).
 */
export function getDepositRichnessBp(
  seed: string,
  tileIdx: number,
  kind: number,
  planetType: PlanetType = 'temperate',
): number {
  if (kind === DEPOSIT.none) return 0;
  const rng = seedStream(seed, `gen:richness:${tileIdx}`);
  const baseBp = nextInt(rng, RICHNESS_CFG.minBp, RICHNESS_CFG.maxBp);
  const modBp = richnessModBp(kind, planetType);
  return Math.round((baseBp * modBp) / 10000);
}

/** Pure 32-bit integer lattice hash in [0, 1). */
function hash2d(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep 2D value noise in [0, 1). */
function valueNoise2d(x: number, y: number, scale: number, seed: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = hash2d(x0, y0, seed);
  const v10 = hash2d(x0 + 1, y0, seed);
  const v01 = hash2d(x0, y0 + 1, seed);
  const v11 = hash2d(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return Math.fround(a + (b - a) * uy);
}

/** 3-octave fractal value noise in [0, 1). */
function fbm2d(x: number, y: number, baseScale: number, seed: number): number {
  const o1 = valueNoise2d(x, y, baseScale, seed);
  const o2 = valueNoise2d(x + 17.3, y - 9.1, baseScale * 2, (seed + 0x9e3779b9) >>> 0);
  const o3 = valueNoise2d(x - 31.7, y + 23.5, baseScale * 4, (seed + 0x3c6ef372) >>> 0);
  return Math.fround(o1 * 0.57 + o2 * 0.29 + o3 * 0.14);
}

function assignTemperateTerrain(s: PlanetState): void {
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

function assignTemperateDeposits(s: PlanetState): void {
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
    if (t !== TERRAIN.flat && t !== TERRAIN.rock && t !== TERRAIN.slope && t !== TERRAIN.forest) continue;
    const q = hex.q[i];
    const r = hex.r[i];
    const x = Math.fround(q + 0.5 * r);
    const y = Math.fround(r * SQRT3_HALF);
    const bonus = t === TERRAIN.rock || t === TERRAIN.flat ? 0.15 : t === TERRAIN.slope ? 0.08 : 0;
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

export function generateTemperate({ seed, planetId, planetType, radius }: Required<Omit<PlanetParams, 'type' | 'id'>>): PlanetState {
  const s = createState({ planetId, planetType, seed, radius });
  assignTemperateTerrain(s);
  assignTemperateDeposits(s);
  return s;
}

registerGenerator('temperate', generateTemperate);
