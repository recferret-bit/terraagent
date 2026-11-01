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

/**
 * Levels one landing zone (D-38): a terraformed-looking flat disc of `radius` tiles at one height (the zone's median
 * ground level), easing back into the natural relief over `falloff` tiles so there is no cliff at its edge. On relief
 * planets (`clearZone`) every land tile of the disc becomes Flat (deposits kept); quota planets only level heights.
 */
function levelZone(ctx: WorldGenContext, slot: SpawnSlot, radius: number, falloff: number, clearZone: boolean): void {
  const L = ctx.state.grid.layers;
  const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, height = L.height as Float32Array;
  const deposit = L.deposit as Uint8Array;
  const outer = radius + falloff;
  const tiles: Array<{ i: number; d: number }> = [];
  const c0 = ctx.hex.indexOf(slot.q, slot.r);
  const cx = ctx.mx[c0], cy = ctx.my[c0];
  for (const sid of ctx.sectors.near(slot.q, slot.r, outer)) {
    for (const i of ctx.sectors.sectors[sid].tiles) {
      // Round disc (metres / tile spacing), not a hexagon; the hex distance bounds the sector walk.
      if (hexDistance(slot.q, slot.r, ctx.hex.q[i], ctx.hex.r[i]) > outer + 1) continue;
      const d = Math.hypot(ctx.mx[i] - cx, ctx.my[i] - cy) / TILE_M;
      if (d <= outer) tiles.push({ i, d });
    }
  }
  const level = Math.fround(Math.max(0.1, quantile(tiles.filter((t) => t.d <= radius && !isWater(terrain[t.i])).map((t) => height[t.i]), clearZone ? 0.2 : 0.5)));
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
    const t = smoothstep(radius, outer, d);
    height[i] = Math.fround(level + (height[i] - level) * t);
    if (clearZone && t < 0.45 && terrain[i] === TERRAIN.rock && deposit[i] === DEPOSIT.none) terrain[i] = TERRAIN.slope;
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
    const slots = generateSpawnSlots(ctx.state, ctx.capacity, { rebalance: !clearZone });
    if (natural) height.set(natural);
    const radius = ctx.num('landingRadius', 4), falloff = ctx.num('landingFalloff', 3);
    for (const slot of slots) {
      levelZone(ctx, slot, radius, falloff, clearZone);
      // The Hub guarantee (same geo + spread rule as placement): a buildable 3×3 within reach of every slot.
      ensureStarterHubSpace(ctx.state, slot.q, slot.r, slot.index);
    }
  },
};
