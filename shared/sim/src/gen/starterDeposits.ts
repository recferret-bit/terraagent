import { hexIndex, type HexIndex } from '../grid/hex';
import { isHexTile, hexTileRing } from '../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import type { SimState } from '../kernel/state';
import { depositGroundMask } from './depositGround';
import { ALL_DEPOSITS, collectDiskTiles, collectPodBlastTiles, footprint2x2Valid, spawnCfg } from './spawnDisk';
import type { SpawnSlot } from './spawnSlots';
import { getDepositRichnessBp } from './temperate';

/**
 * The `UO-TF-09` deposit guarantees of every spawn slot, placed after the landing zones are levelled so they can
 * follow rule G1 of `depositGround.ts` (a visible deposit only on a hex tile):
 *
 *   S1  metals on a hex tile within r<=8 whose 2×2 extractor footprint is Flat open ground (an existing one counts,
 *       else the first free hex tile at r 3..8, ascending tile index);
 *   S2  every deposit kind within r<=12 on a hex tile (an existing one counts, else the first free hex tile at r 6..11,
 *       then at r 1..12);
 *   S3  when no free hex tile qualifies, one is made (`makeGround`), like the old rule levelled a metals footprint.
 *
 * "Free" = a hex tile with no deposit, outside every pod blast zone, every starter Hub site (`blocked`) and every
 * footprint or deposit an earlier guarantee took. Apart from S3, writers only choose ground, never change it.
 * Returns the guarantees it could not meet (none on 2 250 slots checked; `validateSpawnSlotGuarantee` reports the same).
 */
export function placeStarterDeposits(state: SimState, slots: readonly SpawnSlot[], blocked: ReadonlySet<number>): string[] {
  const hex = hexIndex(state.grid.radius);
  const job: Job = { state, hex, ground: depositGroundMask(state), hubTiles: blocked, taken: new Set(blocked) };
  for (const slot of slots) for (const i of collectPodBlastTiles(hex, slot.q, slot.r)) job.taken.add(i);
  const missing: string[] = [];
  for (const slot of slots) {
    if (!guaranteeMetals(job, slot)) missing.push(`slot ${slot.index}: metals on a hex tile with a 2x2 flat footprint within r<=8`);
    for (const kind of ALL_DEPOSITS) if (!guaranteeKind(job, slot, kind)) missing.push(`slot ${slot.index}: deposit kind ${kind} within r<=12`);
  }
  return missing;
}

interface Job {
  state: SimState;
  hex: HexIndex;
  ground: Uint8Array;
  /** Starter Hub sites: no deposit and no extractor footprint there. */
  hubTiles: ReadonlySet<number>;
  /** Tiles no new deposit may use (blast zones, Hub sites, earlier guarantees). */
  taken: Set<number>;
}

const isFree = (job: Job, i: number) => job.ground[i] === 1 && !job.taken.has(i) && job.state.grid.layers.deposit[i] === DEPOSIT.none;

function writeDeposit(job: Job, i: number, kind: number): void {
  const L = job.state.grid.layers, { seed, planetType } = job.state.meta;
  (L.deposit as Uint8Array)[i] = kind;
  (L.richness as Float32Array)[i] = getDepositRichnessBp(seed, i, kind, planetType);
  job.taken.add(i);
}

const isFlatGround = (state: SimState, i: number) => state.grid.layers.terrain[i] === TERRAIN.flat && state.grid.layers.prep[i] === PREP.flat;

/** S1. The footprint of metals at `m`: Flat open ground within `1..metalsRadius`, off the Hub sites, else null. */
function metalsFootprint(job: Job, slot: SpawnSlot, m: number): number[] | null {
  const fp = footprint2x2Valid(job.hex, slot, job.hex.q[m], job.hex.r[m], spawnCfg(job.state).metalsRadius);
  return fp && fp.every((f) => isFlatGround(job.state, f) && !job.hubTiles.has(f)) ? fp : null;
}

function guaranteeMetals(job: Job, slot: SpawnSlot): boolean {
  const { hex, state } = job;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const radius = spawnCfg(state).metalsRadius;
  for (const m of collectDiskTiles(hex, slot.q, slot.r, radius, 1)) {
    const fp = deposit[m] === DEPOSIT.metals && job.ground[m] === 1 ? metalsFootprint(job, slot, m) : null;
    if (!fp) continue;
    for (const f of fp) job.taken.add(f);
    (state.grid.layers.richness as Float32Array)[m] = getDepositRichnessBp(state.meta.seed, m, DEPOSIT.metals, state.meta.planetType);
    return true;
  }
  for (const m of collectDiskTiles(hex, slot.q, slot.r, radius, 3)) {
    if (!isFree(job, m)) continue;
    const fp = metalsFootprint(job, slot, m);
    if (!fp || fp.some((f) => deposit[f] !== DEPOSIT.none)) continue;
    writeDeposit(job, m, DEPOSIT.metals);
    for (const f of fp) job.taken.add(f);
    return true;
  }
  return makeGround(job, slot, DEPOSIT.metals, 3, radius, true);
}

/**
 * Fallback of S1 / S2 when no free hex tile qualifies (a quota planet whose landing zone keeps its trees and rock):
 * the tile at `minR..maxR` whose one-ring (+ 2×2 footprint for metals) needs the fewest conversions (water and holes
 * count 4, other obstacles 1; ties by tile index) is MADE a hex tile: those tiles turn Flat at one height. It never
 * touches a guarantee's tiles, a blast zone, a Hub site, or the one-ring of any visible deposit (which would leave that
 * deposit on wild ground).
 */
function makeGround(job: Job, slot: SpawnSlot, kind: number, minR: number, maxR: number, footprint: boolean): boolean {
  const { hex, state } = job;
  const L = state.grid.layers, R = state.grid.radius;
  const nearDeposit = (t: number) => hexTileRing(R, t).some((j) => L.deposit[j] !== DEPOSIT.none);
  let best: { m: number; tiles: number[]; cost: number } | null = null;
  for (const m of collectDiskTiles(hex, slot.q, slot.r, maxR, minR)) {
    const fp = footprint ? footprint2x2Valid(hex, slot, hex.q[m], hex.r[m], maxR) : [];
    const ring = hexTileRing(R, m);
    if (!fp || ring.length < 7) continue;
    const tiles = [...new Set([...ring, ...fp])];
    if (tiles.some((t) => job.taken.has(t) || nearDeposit(t))) continue;
    const cost = tiles.reduce((c, t) => c + conversionCost(L.terrain[t], L.prep[t]), 0);
    if (!best || cost < best.cost) best = { m, tiles, cost };
  }
  if (!best) return false;
  const h = L.terrain[best.m] === TERRAIN.flat ? L.height[best.m] : Math.fround(0.1);
  for (const t of best.tiles) {
    (L.terrain as Uint8Array)[t] = TERRAIN.flat;
    (L.prep as Uint8Array)[t] = PREP.flat;
    (L.height as Float32Array)[t] = h;
  }
  for (const t of best.tiles) for (const j of hexTileRing(R, t)) job.ground[j] = isHexTile(R, j, { terrain: L.terrain, prep: L.prep, height: L.height }) ? 1 : 0;
  writeDeposit(job, best.m, kind);
  for (const t of best.tiles) job.taken.add(t);
  return true;
}

function conversionCost(terrain: number, prep: number): number {
  if (terrain === TERRAIN.flat && prep === PREP.flat) return 0;
  return terrain === TERRAIN.shallow || terrain === TERRAIN.deep || terrain === TERRAIN.hole ? 4 : 1;
}

/** S2. */
function guaranteeKind(job: Job, slot: SpawnSlot, kind: number): boolean {
  const { hex, state } = job;
  const L = state.grid.layers;
  const r12 = spawnCfg(state).allDepositsRadius;
  const existing = collectDiskTiles(hex, slot.q, slot.r, r12, 1).find((i) => L.deposit[i] === kind && job.ground[i] === 1);
  if (existing !== undefined) {
    job.taken.add(existing);
    if (L.richness[existing] <= 0) (L.richness as Float32Array)[existing] = getDepositRichnessBp(state.meta.seed, existing, kind, state.meta.planetType);
    return true;
  }
  const chosen =
    collectDiskTiles(hex, slot.q, slot.r, Math.min(11, r12), 6).find((i) => isFree(job, i)) ??
    collectDiskTiles(hex, slot.q, slot.r, r12, 1).find((i) => isFree(job, i));
  if (chosen === undefined) return makeGround(job, slot, kind, 6, Math.min(11, r12), false) || makeGround(job, slot, kind, 1, r12, false);
  writeDeposit(job, chosen, kind);
  return true;
}
