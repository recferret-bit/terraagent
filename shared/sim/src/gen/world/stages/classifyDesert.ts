import { HEX_DIRS } from '../../../grid/hex';
import { PREP, TERRAIN } from '../../../grid/layers';
import type { WorldStage } from '../context';
import { fbm2d } from '../noise';

/**
 * Desert terrain classes from the relief (D-38): exposed bedrock (mountains, mesa cliffs and tops) → `rock`; steep sand
 * (dune slip faces, scree) → `slope`; rare dry sinkholes → `hole`; everything else (reg plains, dune flanks) → `flat`.
 * No forest and no water on a desert. Flat tiles start `PREP.flat`, the rest `PREP.wild`.
 */
export const classifyDesert: WorldStage = {
  id: 'classifyDesert',
  run(ctx) {
    const L = ctx.state.grid.layers;
    const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, height = L.height as Float32Array;
    const rockiness = ctx.field('rockiness');
    const slopeG = ctx.num('slopeGradientM', 0.85), rockH = ctx.num('rockHeightM', 2.4);
    const holeT = ctx.num('holeThreshold', 0.2);
    const seedHole = ctx.seed('hole');
    for (const s of ctx.sectors.sectors) {
      for (const i of s.tiles) {
        const q = ctx.hex.q[i], r = ctx.hex.r[i];
        let grad = 0;
        for (const [dq, dr] of HEX_DIRS) {
          const j = ctx.hex.indexOf(q + dq, r + dr);
          if (j >= 0) grad = Math.max(grad, Math.abs(height[j] - height[i]));
        }
        let t: number = TERRAIN.flat;
        if (rockiness[i] > 0.5 && height[i] > rockH * 0.5) t = TERRAIN.rock;
        else if (grad > slopeG) t = TERRAIN.slope;
        else if (height[i] < 0.8 && fbm2d(ctx.mx[i], ctx.my[i], 0.05, seedHole) < holeT) t = TERRAIN.hole;
        terrain[i] = t;
        prep[i] = t === TERRAIN.flat ? PREP.flat : PREP.wild;
        if (t === TERRAIN.hole) height[i] = Math.fround(height[i] - 1.2);
      }
    }
  },
};
