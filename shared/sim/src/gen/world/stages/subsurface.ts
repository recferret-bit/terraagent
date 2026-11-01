import { DEPOSIT, TERRAIN } from '../../../grid/layers';
import { getDepositRichnessBp } from '../../temperate';
import type { WorldStage } from '../context';
import { fbm2d, hash2d } from '../noise';

/**
 * Hidden subsurface (D-38): what Clear / Break uncovers. Buried deposits cluster in veins (noise above a per-terrain
 * threshold): metal and mineral veins under rock, minerals / oil under dunes, metals under forest roots, oil pockets
 * under plains. Written to the server-only layers `subDeposit` / `subRichness`; per-sector seeds, no planet rng.
 */
export const subsurface: WorldStage = {
  id: 'subsurface',
  run(ctx) {
    const L = ctx.state.grid.layers;
    const terrain = L.terrain as Uint8Array, deposit = L.deposit as Uint8Array;
    const sub = L.subDeposit as Uint8Array, subRich = L.subRichness as Float32Array;
    const chance: Record<number, number> = {
      [TERRAIN.rock]: ctx.num('subRock', 0.3),
      [TERRAIN.slope]: ctx.num('subSlope', 0.1),
      [TERRAIN.forest]: ctx.num('subForest', 0.12),
      [TERRAIN.flat]: ctx.num('subFlat', 0.03),
    };
    const kinds: Record<number, readonly number[]> = {
      [TERRAIN.rock]: [DEPOSIT.metals, DEPOSIT.minerals],
      [TERRAIN.slope]: [DEPOSIT.minerals, DEPOSIT.oil],
      [TERRAIN.forest]: [DEPOSIT.metals, DEPOSIT.minerals],
      [TERRAIN.flat]: [DEPOSIT.oil],
    };
    const boost = ctx.num('subRichnessBoostBp', 12500);
    const veinSeed = ctx.secretSeed('vein');
    const { seed, planetType } = ctx.state.meta;
    for (const s of ctx.sectors.sectors) {
      const sSeed = ctx.secretSeed('subsurface', s.id);
      for (const i of s.tiles) {
        const p = chance[terrain[i]];
        if (!p || deposit[i] !== DEPOSIT.none) continue;
        // Vein field in [0,1): the top `p` share of it is ore. fbm is ~bell-shaped, so map p to a threshold.
        const v = fbm2d(ctx.mx[i], ctx.my[i], 0.045, veinSeed);
        if (v < 0.5 + (0.5 - p) * 0.55) continue;
        const ks = kinds[terrain[i]];
        const kind = ks[Math.floor(hash2d(ctx.hex.q[i], ctx.hex.r[i], sSeed) * ks.length)];
        sub[i] = kind;
        subRich[i] = Math.round((getDepositRichnessBp(`${seed}|${ctx.state.meta.worldSalt ?? ''}`, i, kind, planetType) * boost) / 10000);
      }
    }
  },
};
