import terrainTable from '../data/terrain';
import { hexDistance, hexIndex, type HexIndex } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { nextInt } from '../kernel/rng';
import { setBlob, type Blob, type SimState } from '../kernel/state';
import { getDepositRichnessBp } from './temperate';

export const DEFAULT_SPAWN_CAPACITY = 5;

export interface SpawnSlot {
  index: number;
  q: number;
  r: number;
  claimedBy?: number;
}

export interface SpawnGuaranteeResult {
  ok: boolean;
  reasons: string[];
}

function readTemperateNum(field: string, fallback: number): number {
  const row = terrainTable.rows.find((r) => r.id === 'temperate') as Record<string, unknown> | undefined;
  return typeof row?.[field] === 'number' ? (row[field] as number) : fallback;
}

const SPAWN_CFG = {
  ringRadius: readTemperateNum('spawnRingRadius', 32),
  ringJitter: readTemperateNum('spawnRingJitter', 3),
  guaranteeRadius: readTemperateNum('spawnGuaranteeRadius', 4),
  minFlatShareBp: readTemperateNum('spawnMinFlatShareBp', 6000),
  maxNonFlatPer3x3: readTemperateNum('spawnMaxNonFlatPer3x3', 3),
  metalsRadius: readTemperateNum('spawnMetalsRadius', 8),
  allDepositsRadius: readTemperateNum('spawnAllDepositsRadius', 12),
} as const;

const RING_STEP_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

const ALL_DEPOSITS = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

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

const JITTER_OFFSETS = buildJitterOffsets(SPAWN_CFG.ringJitter);

function pickRingSlots(state: SimState, capacity: number): SpawnSlot[] {
  const ringRadius = state.grid.radius >= 40
    ? SPAWN_CFG.ringRadius
    : Math.max(0, Math.min(SPAWN_CFG.ringRadius, state.grid.radius - 5));
  const ring = buildHexRing(ringRadius);
  const rng = state.rng.gen;
  const offset = nextInt(rng, 0, ring.length - 1);
  const slots: SpawnSlot[] = [];

  for (let index = 0; index < capacity; index++) {
    const ringIdx = (Math.floor((index * ring.length) / capacity) + offset) % ring.length;
    const base = ring[ringIdx];
    const jitter = JITTER_OFFSETS[nextInt(rng, 0, JITTER_OFFSETS.length - 1)];
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

function collectDiskTiles(hex: HexIndex, cq: number, cr: number, maxDist: number, minDist = 0): number[] {
  const out: number[] = [];
  for (let dr = -maxDist; dr <= maxDist; dr++) {
    for (let dq = -maxDist; dq <= maxDist; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d < minDist || d > maxDist) continue;
      const idx = hex.indexOf(cq + dq, cr + dr);
      if (idx >= 0) out.push(idx);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

function enforceR4WindowCap(
  state: SimState,
  hex: HexIndex,
  r4Tiles: number[],
  convertedCounts: Map<number, number>,
): void {
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
    if (nonFlat.length <= SPAWN_CFG.maxNonFlatPer3x3) continue;
    nonFlat.sort((a, b) => (deposit[a] === DEPOSIT.none ? 0 : 1) - (deposit[b] === DEPOSIT.none ? 0 : 1) || a - b);
    const excess = nonFlat.length - SPAWN_CFG.maxNonFlatPer3x3;
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
  const terrain = state.grid.layers.terrain as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const r4Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.guaranteeRadius);

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

  const minFlat = Math.ceil((r4Tiles.length * SPAWN_CFG.minFlatShareBp) / 10000);
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

function footprint2x2Valid(hex: HexIndex, slot: SpawnSlot, mq: number, mr: number): number[] | null {
  const tiles: number[] = [];
  for (let dr = 0; dr <= 1; dr++) {
    for (let dq = 0; dq <= 1; dq++) {
      const fq = mq + dq;
      const fr = mr + dr;
      const fIdx = hex.indexOf(fq, fr);
      const dist = hexDistance(slot.q, slot.r, fq, fr);
      if (fIdx < 0 || dist < 1 || dist > SPAWN_CFG.metalsRadius) return null;
      tiles.push(fIdx);
    }
  }
  return tiles;
}

function enforceR8MetalsAnd2x2(
  state: SimState,
  hex: HexIndex,
  slot: SpawnSlot,
  convertedCounts: Map<number, number>,
  protectedTiles: Set<number>,
): void {
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r8Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.metalsRadius, 1);

  for (const mIdx of r8Tiles) {
    if (deposit[mIdx] !== DEPOSIT.metals) continue;
    const fp = footprint2x2Valid(hex, slot, hex.q[mIdx], hex.r[mIdx]);
    if (!fp) continue;
    for (const fIdx of fp) {
      makeTileFlat(state, fIdx, convertedCounts);
      protectedTiles.add(fIdx);
    }
    richness[mIdx] = getDepositRichnessBp(state.meta.seed, mIdx, DEPOSIT.metals, state.meta.planetType);
    return;
  }

  const candidates = collectDiskTiles(hex, slot.q, slot.r, 6, 2);
  for (const mIdx of candidates) {
    if (deposit[mIdx] !== DEPOSIT.none) continue;
    const fp = footprint2x2Valid(hex, slot, hex.q[mIdx], hex.r[mIdx]);
    if (!fp || fp.some((fIdx) => deposit[fIdx] !== DEPOSIT.none)) continue;
    for (const fIdx of fp) {
      makeTileFlat(state, fIdx, convertedCounts);
      protectedTiles.add(fIdx);
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
  const terrain = state.grid.layers.terrain as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r12Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.allDepositsRadius, 1);

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
 */
export function generateSpawnSlots(state: SimState, capacity = DEFAULT_SPAWN_CAPACITY): SpawnSlot[] {
  const hex = hexIndex(state.grid.radius);
  const slots = pickRingSlots(state, capacity);
  const convertedCounts = new Map<number, number>();
  const reservedTiles = new Set<number>();
  const slotZoneTiles = new Set<number>();

  for (const slot of slots) {
    for (const idx of collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.allDepositsRadius)) {
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
    enforceR8MetalsAnd2x2(state, hex, slot, convertedCounts, reservedTiles);
    enforceR12AllDeposits(state, hex, slot, convertedCounts, reservedTiles);
  }

  rebalanceGlobalTerrainMix(state, convertedCounts, slotZoneTiles);
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

function checkR4Guarantee(state: SimState, hex: HexIndex, slot: { q: number; r: number }, reasons: string[]): void {
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const r4Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.guaranteeRadius);
  let flatCount = 0;

  for (const idx of r4Tiles) {
    const t = terrain[idx];
    if (t === TERRAIN.flat) {
      flatCount++;
      if (prep[idx] !== PREP.flat) reasons.push(`tile ${idx} in r<=4 is flat terrain but prep=${prep[idx]}`);
    } else if (t !== TERRAIN.forest && t !== TERRAIN.rock) {
      reasons.push(`forbidden terrain ${t} at tile ${idx} within r<=4`);
    }
  }

  const minFlat = Math.ceil((r4Tiles.length * SPAWN_CFG.minFlatShareBp) / 10000);
  if (flatCount < minFlat) {
    reasons.push(`r<=4 flat count ${flatCount}/${r4Tiles.length} below required ${minFlat}`);
  }

  for (const cIdx of r4Tiles) {
    const cq = hex.q[cIdx];
    const cr = hex.r[cIdx];
    let nonFlat = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const wIdx = hex.indexOf(cq + dq, cr + dr);
        if (wIdx >= 0 && terrain[wIdx] !== TERRAIN.flat) nonFlat++;
      }
    }
    if (nonFlat > SPAWN_CFG.maxNonFlatPer3x3) {
      reasons.push(`3x3 at (${cq},${cr}) has ${nonFlat} non-Flat tiles (> ${SPAWN_CFG.maxNonFlatPer3x3})`);
      break;
    }
  }
}

function checkDepositsGuarantee(state: SimState, hex: HexIndex, slot: { q: number; r: number }, reasons: string[]): void {
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r8Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.metalsRadius, 1);

  let hasMetalsWith2x2 = false;
  for (const mIdx of r8Tiles) {
    if (deposit[mIdx] !== DEPOSIT.metals) continue;
    const fp = footprint2x2Valid(hex, { index: 0, q: slot.q, r: slot.r }, hex.q[mIdx], hex.r[mIdx]);
    if (fp && fp.every((fIdx) => terrain[fIdx] === TERRAIN.flat && prep[fIdx] === PREP.flat)) {
      hasMetalsWith2x2 = true;
      break;
    }
  }
  if (!hasMetalsWith2x2) {
    reasons.push('missing metals deposit with free 2x2 flat footprint within r<=8');
  }

  const r12Tiles = collectDiskTiles(hex, slot.q, slot.r, SPAWN_CFG.allDepositsRadius, 1);
  for (const kind of ALL_DEPOSITS) {
    const hit = r12Tiles.some((idx) => deposit[idx] === kind && richness[idx] > 0);
    if (!hit) {
      reasons.push(`missing deposit kind ${kind} within r<=12`);
    }
  }
}

/**
 * Validates all `UO-TF-09` spawn guarantee predicates for a given `slot` on `state`.
 */
export function validateSpawnSlotGuarantee(
  state: SimState,
  slot: { q: number; r: number },
): SpawnGuaranteeResult {
  const reasons: string[] = [];
  const hex = hexIndex(state.grid.radius);
  const slotIdx = hex.indexOf(slot.q, slot.r);

  if (slotIdx < 0) {
    return { ok: false, reasons: [`slot (${slot.q},${slot.r}) is outside grid`] };
  }

  if (state.grid.radius >= 40) {
    const ringDist = hexDistance(0, 0, slot.q, slot.r);
    const minDist = SPAWN_CFG.ringRadius - SPAWN_CFG.ringJitter;
    const maxDist = SPAWN_CFG.ringRadius + SPAWN_CFG.ringJitter;
    if (ringDist < minDist || ringDist > maxDist) {
      reasons.push(`slot ring distance ${ringDist} outside [${minDist}, ${maxDist}]`);
    }
  }

  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  if (terrain[slotIdx] !== TERRAIN.flat || prep[slotIdx] !== PREP.flat) {
    reasons.push(`slot center (${slot.q},${slot.r}) is not flat`);
  }

  checkR4Guarantee(state, hex, slot, reasons);
  checkDepositsGuarantee(state, hex, slot, reasons);

  return { ok: reasons.length === 0, reasons };
}
export { ensureStarterHubSpace, STARTER_HUB_SEARCH_RADIUS } from './starterSpace';
