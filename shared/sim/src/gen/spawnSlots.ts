import { hexDistance, hexIndex, type HexIndex } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { nextInt } from '../kernel/rng';
import { setBlob, type Blob, type SimState } from '../kernel/state';
import { DEV_PLANET_CAPACITY } from './flat';
import { ALL_DEPOSITS, collectDiskTiles, footprint2x2Valid, spawnCfg } from './spawnDisk';
import { getDepositRichnessBp } from './temperate';

/** Spawn slots of a planet generated without a `capacity`: the seats of a dev planet. */
export const DEFAULT_SPAWN_CAPACITY = DEV_PLANET_CAPACITY;

export interface SpawnSlot {
  index: number;
  q: number;
  r: number;
  claimedBy?: number;
}


const RING_STEP_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/**
 * Builds the `6 * radius` perimeter hexes of the axial ring of radius `radius`
 * in clockwise order using pure integer math (no trig).
 */
export function buildHexRing(radius: number): Array<{ q: number; r: number }> {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const ring: Array<{ q: number; r: number }> = [];
  let q = 0;
  let r = -radius;
  for (const [dq, dr] of RING_STEP_DIRS) {
    for (let step = 0; step < radius; step++) {
      ring.push({ q, r });
      q += dq;
      r += dr;
    }
  }
  return ring;
}

function buildJitterOffsets(maxJitter: number): Array<{ dq: number; dr: number }> {
  const offsets: Array<{ dq: number; dr: number }> = [];
  for (let dr = -maxJitter; dr <= maxJitter; dr++) {
    for (let dq = -maxJitter; dq <= maxJitter; dq++) {
      if (hexDistance(0, 0, dq, dr) <= maxJitter) {
        offsets.push({ dq, dr });
      }
    }
  }
  return offsets;
}

function pickRingSlots(state: SimState, capacity: number): SpawnSlot[] {
  const cfg = spawnCfg(state);
  const ringRadius = state.grid.radius >= 40
    ? cfg.ringRadius
    : Math.max(0, Math.min(cfg.ringRadius, state.grid.radius - 5));
  const ring = buildHexRing(ringRadius);
  const jitterOffsets = buildJitterOffsets(cfg.ringJitter);
  const rng = state.rng.gen;
  const offset = nextInt(rng, 0, ring.length - 1);
  const slots: SpawnSlot[] = [];

  for (let index = 0; index < capacity; index++) {
    const ringIdx = (Math.floor((index * ring.length) / capacity) + offset) % ring.length;
    const base = ring[ringIdx];
    const jitter = jitterOffsets[nextInt(rng, 0, jitterOffsets.length - 1)];
    slots.push({
      index,
      q: base.q + jitter.dq,
      r: base.r + jitter.dr,
    });
  }
  return slots;
}

function makeTileFlat(state: SimState, idx: number, convertedCounts: Map<number, number>): void {
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const height = state.grid.layers.height as Float32Array;
  const prev = terrain[idx];
  if (prev !== TERRAIN.flat) {
    convertedCounts.set(prev, (convertedCounts.get(prev) ?? 0) + 1);
    terrain[idx] = TERRAIN.flat;
  }
  prep[idx] = PREP.flat;
  if (height[idx] < 0.05 || height[idx] > 0.18) {
    height[idx] = Math.fround(0.08 + ((idx * 17) % 9) * 0.01);
  }
}

function enforceR4WindowCap(
  state: SimState,
  hex: HexIndex,
  r4Tiles: number[],
  convertedCounts: Map<number, number>,
): void {
  const cfg = spawnCfg(state);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;

  for (const cIdx of r4Tiles) {
    const cq = hex.q[cIdx];
    const cr = hex.r[cIdx];
    const nonFlat: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const wIdx = hex.indexOf(cq + dq, cr + dr);
        if (wIdx >= 0 && terrain[wIdx] !== TERRAIN.flat) {
          nonFlat.push(wIdx);
        }
      }
    }
    if (nonFlat.length <= cfg.maxNonFlatPer3x3) continue;
    nonFlat.sort((a, b) => (deposit[a] === DEPOSIT.none ? 0 : 1) - (deposit[b] === DEPOSIT.none ? 0 : 1) || a - b);
    const excess = nonFlat.length - cfg.maxNonFlatPer3x3;
    for (let k = 0; k < excess; k++) {
      makeTileFlat(state, nonFlat[k], convertedCounts);
    }
  }
}

function enforceR4Guarantee(
  state: SimState,
  hex: HexIndex,
  slot: SpawnSlot,
  convertedCounts: Map<number, number>,
): void {
  const cfg = spawnCfg(state);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const r4Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.guaranteeRadius);

  for (const idx of r4Tiles) {
    const t = terrain[idx];
    if (t !== TERRAIN.flat && t !== TERRAIN.forest && t !== TERRAIN.rock) {
      makeTileFlat(state, idx, convertedCounts);
    }
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dq = -1; dq <= 1; dq++) {
      const idx = hex.indexOf(slot.q + dq, slot.r + dr);
      if (idx >= 0) makeTileFlat(state, idx, convertedCounts);
    }
  }

  enforceR4WindowCap(state, hex, r4Tiles, convertedCounts);

  const minFlat = Math.ceil((r4Tiles.length * cfg.minFlatShareBp) / 10000);
  let flatCount = 0;
  const nonFlat: number[] = [];
  for (const idx of r4Tiles) {
    if (terrain[idx] === TERRAIN.flat) flatCount++;
    else nonFlat.push(idx);
  }
  if (flatCount >= minFlat) return;

  nonFlat.sort((a, b) => {
    const depDiff = (deposit[a] === DEPOSIT.none ? 0 : 1) - (deposit[b] === DEPOSIT.none ? 0 : 1);
    if (depDiff !== 0) return depDiff;
    const da = hexDistance(slot.q, slot.r, hex.q[a], hex.r[a]);
    const db = hexDistance(slot.q, slot.r, hex.q[b], hex.r[b]);
    return da - db || a - b;
  });

  for (let k = 0; k < nonFlat.length && flatCount < minFlat; k++) {
    makeTileFlat(state, nonFlat[k], convertedCounts);
    flatCount++;
  }
}

function enforceR8MetalsAnd2x2(
  state: SimState,
  hex: HexIndex,
  slot: SpawnSlot,
  convertedCounts: Map<number, number>,
  protectedTiles: Set<number>,
  footprints?: Set<number>,
): void {
  const cfg = spawnCfg(state);
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r8Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.metalsRadius, 1);

  for (const mIdx of r8Tiles) {
    if (deposit[mIdx] !== DEPOSIT.metals) continue;
    const fp = footprint2x2Valid(hex, slot, hex.q[mIdx], hex.r[mIdx], cfg.metalsRadius);
    if (!fp) continue;
    for (const fIdx of fp) {
      makeTileFlat(state, fIdx, convertedCounts);
      protectedTiles.add(fIdx);
      footprints?.add(fIdx);
    }
    richness[mIdx] = getDepositRichnessBp(state.meta.seed, mIdx, DEPOSIT.metals, state.meta.planetType);
    return;
  }

  const candidates = collectDiskTiles(hex, slot.q, slot.r, 6, 2);
  for (const mIdx of candidates) {
    if (deposit[mIdx] !== DEPOSIT.none) continue;
    const fp = footprint2x2Valid(hex, slot, hex.q[mIdx], hex.r[mIdx], cfg.metalsRadius);
    if (!fp || fp.some((fIdx) => deposit[fIdx] !== DEPOSIT.none)) continue;
    for (const fIdx of fp) {
      makeTileFlat(state, fIdx, convertedCounts);
      protectedTiles.add(fIdx);
      footprints?.add(fIdx);
    }
    deposit[mIdx] = DEPOSIT.metals;
    richness[mIdx] = getDepositRichnessBp(state.meta.seed, mIdx, DEPOSIT.metals, state.meta.planetType);
    return;
  }
}

function enforceR12AllDeposits(
  state: SimState,
  hex: HexIndex,
  slot: SpawnSlot,
  convertedCounts: Map<number, number>,
  protectedTiles: Set<number>,
): void {
  const cfg = spawnCfg(state);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r12Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.allDepositsRadius, 1);

  for (const kind of ALL_DEPOSITS) {
    const existing = r12Tiles.find((idx) => deposit[idx] === kind);
    if (existing !== undefined) {
      protectedTiles.add(existing);
      if (richness[existing] <= 0) {
        richness[existing] = getDepositRichnessBp(state.meta.seed, existing, kind, state.meta.planetType);
      }
      continue;
    }

    const ring6to11 = collectDiskTiles(hex, slot.q, slot.r, 11, 6);
    ring6to11.sort((a, b) => (terrain[a] === TERRAIN.flat ? 0 : 1) - (terrain[b] === TERRAIN.flat ? 0 : 1) || a - b);
    const chosen = ring6to11.find((idx) => deposit[idx] === DEPOSIT.none && !protectedTiles.has(idx));
    if (chosen !== undefined) {
      makeTileFlat(state, chosen, convertedCounts);
      deposit[chosen] = kind;
      richness[chosen] = getDepositRichnessBp(state.meta.seed, chosen, kind, state.meta.planetType);
      protectedTiles.add(chosen);
    }
  }
}

function defaultHeightForTerrain(code: number): number {
  if (code === TERRAIN.deep) return Math.fround(-0.45);
  if (code === TERRAIN.shallow) return Math.fround(-0.15);
  if (code === TERRAIN.hole) return Math.fround(-0.3);
  if (code === TERRAIN.slope) return Math.fround(0.4);
  if (code === TERRAIN.rock) return Math.fround(0.7);
  if (code === TERRAIN.forest) return Math.fround(0.18);
  return Math.fround(0.1);
}

function rebalanceGlobalTerrainMix(
  state: SimState,
  convertedCounts: Map<number, number>,
  protectedTiles: Set<number>,
): void {
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const height = state.grid.layers.height as Float32Array;
  const count = state.grid.count;

  const swapPool: number[] = [];
  for (let i = 0; i < count; i++) {
    if (terrain[i] === TERRAIN.flat && deposit[i] === DEPOSIT.none && !protectedTiles.has(i)) {
      swapPool.push(i);
    }
  }

  let cursor = 0;
  for (const [code, needed] of convertedCounts.entries()) {
    for (let k = 0; k < needed && cursor < swapPool.length; k++) {
      const idx = swapPool[cursor++];
      terrain[idx] = code;
      prep[idx] = PREP.wild;
      height[idx] = defaultHeightForTerrain(code);
    }
  }
}

/**
 * Generates `capacity` spawn slots on the radius-32 ring (±3 jitter), enforces all `UO-TF-09`
 * terrain and deposit guarantees around every slot, and stores the slots in `state.blobs.spawnSlots`.
 * `footprintsOut` receives the metals 2×2 Flat footprint tiles: later stages must keep them Flat (WE-18).
 */
export function generateSpawnSlots(
  state: SimState,
  capacity = DEFAULT_SPAWN_CAPACITY,
  opts: { rebalance?: boolean; footprintsOut?: Set<number> } = {},
): SpawnSlot[] {
  const cfg = spawnCfg(state);
  const hex = hexIndex(state.grid.radius);
  const slots = pickRingSlots(state, capacity);
  const convertedCounts = new Map<number, number>();
  const reservedTiles = new Set<number>();
  const slotZoneTiles = new Set<number>();

  for (const slot of slots) {
    for (const idx of collectDiskTiles(hex, slot.q, slot.r, cfg.allDepositsRadius)) {
      slotZoneTiles.add(idx);
    }
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const idx = hex.indexOf(slot.q + dq, slot.r + dr);
        if (idx >= 0) reservedTiles.add(idx);
      }
    }
  }

  for (const slot of slots) {
    enforceR4Guarantee(state, hex, slot, convertedCounts);
    enforceR8MetalsAnd2x2(state, hex, slot, convertedCounts, reservedTiles, opts.footprintsOut);
    enforceR12AllDeposits(state, hex, slot, convertedCounts, reservedTiles);
  }

  // Quota planets (temperate / ocean) give back converted tiles elsewhere; relief planets keep their natural mix.
  if (opts.rebalance !== false) rebalanceGlobalTerrainMix(state, convertedCounts, slotZoneTiles);
  setBlob(state, 'spawnSlots', slots, state.meta.tick);
  return slots;
}

/** Reads the planet's spawn slots from `state.blobs.spawnSlots`. */
export function getSpawnSlots(state: SimState): SpawnSlot[] {
  const raw = state.blobs.spawnSlots as Blob | SpawnSlot[] | undefined;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.value) ? (raw.value as SpawnSlot[]) : [];
}

export { ensureStarterHubSpace, STARTER_HUB_SEARCH_RADIUS, starterHubSiteBlocked } from './starterSpace';
