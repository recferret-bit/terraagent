import { hexDistance } from '../../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../../grid/layers';
import { generateSpawnSlots, type SpawnSlot } from '../../spawnSlots';
import { ensureStarterHubSpace } from '../../starterSpace';
import { TILE_M, type WorldGenContext, type WorldStage } from '../context';
import { smoothstep } from '../noise';

const isWater = (t: number) => t === TERRAIN.shallow || t === TERRAIN.deep;

/** The `p` quantile (0..1) of `values`: the zone is cut down to the low ground, never raised onto a peak. */
function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0.2;
  const v = values.slice().sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

interface ZoneOpts { radius: number; falloff: number; clearZone: boolean; keep: ReadonlySet<number> }

/**
 * Levels one landing zone (D-38): a terraformed-looking flat disc of `radius` tiles at one height (the zone's median
 * ground level), easing back into the natural relief over `falloff` tiles so there is no cliff at its edge. On relief
 * planets (`clearZone`) every land tile of the disc becomes Flat (deposits kept); quota planets only level heights.
 * Tiles in `keep` (the spawn guarantee's metals footprints) never change class in the falloff ring.
 */
function levelZone(ctx: WorldGenContext, slot: SpawnSlot, zone: ZoneOpts): void {
  const { radius, falloff, clearZone, keep } = zone;
  const L = ctx.state.grid.layers;
  const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, height = L.height as Float32Array;
  const deposit = L.deposit as Uint8Array;
  const outer = radius + falloff;
  const tiles: Array<{ i: number; d: number }> = [];
  const c0 = ctx.hex.indexOf(slot.q, slot.r);
  const cx = ctx.mx[c0], cy = ctx.my[c0];
  // A Euclidean disc of `outer` tiles reaches up to outer·2/√3 in hex distance: bound the sector walk by that.
  const hexBound = Math.ceil((outer * 2) / Math.sqrt(3)) + 1;
  for (const sid of ctx.sectors.near(slot.q, slot.r, hexBound)) {
    for (const i of ctx.sectors.sectors[sid].tiles) {
      // Round disc (metres / tile spacing), not a hexagon.
      if (hexDistance(slot.q, slot.r, ctx.hex.q[i], ctx.hex.r[i]) > hexBound) continue;
      const dx = ctx.mx[i] - cx, dy = ctx.my[i] - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / TILE_M; // sqrt is correctly rounded on every engine; hypot is not
      if (d <= outer) tiles.push({ i, d });
    }
  }
  const rawLevel = quantile(tiles.filter((t) => t.d <= radius && !isWater(terrain[t.i])).map((t) => height[t.i]), clearZone ? 0.2 : 0.5);
  const level = Math.fround(clearZone ? Math.min(1.2, Math.max(0.15, rawLevel)) : Math.max(0.1, rawLevel));
  for (const { i, d } of tiles) {
    if (isWater(terrain[i])) continue;
    if (d <= radius) {
      if (clearZone || terrain[i] === TERRAIN.flat) height[i] = level;
      if (clearZone && terrain[i] !== TERRAIN.flat) {
        terrain[i] = TERRAIN.flat;
        prep[i] = PREP.flat;
      }
      continue;
    }
    if (clearZone && keep.has(i)) {
      height[i] = level;
      terrain[i] = TERRAIN.flat;
      prep[i] = PREP.flat;
      continue;
    }
    const t = smoothstep(radius, outer, d);
    height[i] = Math.fround(level + (height[i] - level) * t);
    if (clearZone && t < 0.65 && terrain[i] === TERRAIN.rock && deposit[i] === DEPOSIT.none) terrain[i] = TERRAIN.slope;
  }
  // Outside the levelled pod-drop disc, wild desert stays `slope` (dunes) except for `keep` and a narrow gentle rim (`slopeGradientM`).
  if (clearZone) reclassifyRing(ctx, slot, radius, tiles.filter((t) => t.d > radius && !keep.has(t.i)));
}

/**
 * Reclassifies the falloff ring around a pod-drop zone: the inner rim (`d <= radius + 1.85`, hexDistance <= 8)
 * whose per-step gradient is under `slopeGradientM` stays `flat` (so a 3×3 straddling the rim is rejected as `uneven`
 * by `MAX_FOOTPRINT_SPREAD_M`), while steeper and outer falloff tiles stay wild dunes (`slope`).
 */
function reclassifyRing(ctx: WorldGenContext, slot: SpawnSlot, radius: number, ring: Array<{ i: number; d: number }>): void {
  const L = ctx.state.grid.layers;
  const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, height = L.height as Float32Array;
  const slopeG = ctx.num('slopeGradientM', 0.8);
  const { q, r } = ctx.hex;
  for (const { i, d } of ring) {
    if (terrain[i] !== TERRAIN.flat && terrain[i] !== TERRAIN.slope) continue;
    const qi = q[i], ri = r[i];
    const inInnerRim = d <= radius + 1.85 && hexDistance(slot.q, slot.r, qi, ri) <= 8;
    if (!inInnerRim) {
      terrain[i] = TERRAIN.slope;
      prep[i] = PREP.wild;
      continue;
    }
    const h0 = height[i];
    let grad = 0;
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const) {
      const j = ctx.hex.indexOf(qi + dq, ri + dr);
      if (j >= 0) grad = Math.max(grad, Math.abs(h0 - height[j]));
    }
    const flat = grad <= slopeG;
    terrain[i] = flat ? TERRAIN.flat : TERRAIN.slope;
    prep[i] = flat ? PREP.flat : PREP.wild;
  }
}

/**
 * Spawn slots (`UO-TF-09` guarantees, `spawnSlots.ts`) + a levelled starter landing zone around each slot. Relief
 * planets keep their natural heights outside the zones (the slot guarantees only change classes there).
 */
export const landing: WorldStage = {
  id: 'landing',
  run(ctx) {
    const clearZone = ctx.profile.clearLandingZone === true;
    const height = ctx.state.grid.layers.height as Float32Array;
    const natural = clearZone ? height.slice() : null;
    const keep = new Set<number>();
    const slots = generateSpawnSlots(ctx.state, ctx.capacity, { rebalance: !clearZone, footprintsOut: keep });
    if (natural) height.set(natural);
    const zone: ZoneOpts = { radius: ctx.num('landingRadius', 4), falloff: ctx.num('landingFalloff', 3), clearZone, keep };
    for (const slot of slots) {
      levelZone(ctx, slot, zone);
      // The Hub guarantee (same geo + spread rule as placement): a buildable 3×3 within reach of every slot.
      ensureStarterHubSpace(ctx.state, slot.q, slot.r, slot.index);
    }
  },
};
