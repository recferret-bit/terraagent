import { PREP, TERRAIN } from '../../../grid/layers';
import type { WorldStage } from '../context';
import { fbm2d } from '../noise';

/**
 * Desert terrain classes from the relief (D-38): exposed bedrock (mountains, mesa cliffs and tops) → `rock`; rare dry
 * sinkholes → `hole`; all wild desert sand (dunes) → `slope` (`PREP.wild`, unbuildable until terraformed). Buildable
 * `flat` (`PREP.flat`) ground is created only around the pod drop landing zones by the `landing` stage.
 */
export const classifyDesert: WorldStage = {
  id: 'classifyDesert',
  run(ctx) {
    const L = ctx.state.grid.layers;
    const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, height = L.height as Float32Array;
    const rockiness = ctx.field('rockiness');
    const rockH = ctx.num('rockHeightM', 2.4);
    const holeT = ctx.num('holeThreshold', 0.18);
    const seedHole = ctx.seed('hole');
    for (const s of ctx.sectors.sectors) {
      for (const i of s.tiles) {
        let t: number = TERRAIN.slope;
        if (rockiness[i] > 0.5 && height[i] > rockH * 0.5) t = TERRAIN.rock;
        else if (height[i] < 0.8 && fbm2d(ctx.mx[i], ctx.my[i], 0.05, seedHole) < holeT) t = TERRAIN.hole;
        terrain[i] = t;
        prep[i] = PREP.wild;
        if (t === TERRAIN.hole) height[i] = Math.fround(height[i] - 1.2);
      }
    }
  },
};
