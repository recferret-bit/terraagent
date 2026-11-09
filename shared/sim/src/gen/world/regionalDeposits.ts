import type { ResolvedRegion } from '../../economy/regions/resolve';
import { rollRegionalDeposit } from '../../economy/regions/sourcePolicy';
import { DEPOSIT } from '../../grid/layers';
import { setTileDeposit } from '../../grid/tileModel';
import type { WorldGenContext } from './context';
import { hash2d } from './noise';

/**
 * W13 regional deposit composition (ECON-GEO-01, W13-51). Runs after every profile stage (so after the landing stage that
 * levels the pod zones and fills deposits), only when the host passed a resolved region. The deposit POSITIONS stay the
 * profile's; the region decides how many survive (`depositDensityPer1000Tiles`: it can thin the field, not add tiles),
 * which resource and tier each one holds (`occurrenceWeightBp`, so a crystal-poor planet has few `minerals.t3` deposits) and
 * its finite reserve (`reserveUnitsMin/Max`). An all-zero eligible set leaves no deposit, never a uniform fallback. Per-tile
 * seeds from the planet seed only: no planet rng is drawn, so later stages and W13-off worlds are unaffected.
 */
export function applyRegionalDeposits(ctx: WorldGenContext, region: ResolvedRegion): void {
  const { state, hex } = ctx;
  const layers = state.grid.layers;
  const deposit = layers.deposit as Uint8Array;
  const visible: number[] = [];
  for (let i = 0; i < state.grid.count; i++) if (deposit[i] !== DEPOSIT.none) visible.push(i);
  const keepSeed = ctx.seed('regionalKeep'), pickSeed = ctx.seed('regionalPick'), reserveSeed = ctx.seed('regionalReserve');
  const target = Math.round((state.grid.count * region.depositDensityPer1000Tiles.value) / 1000);
  const ranked = [...visible].sort((a, b) => hash2d(hex.q[a], hex.r[a], keepSeed) - hash2d(hex.q[b], hex.r[b], keepSeed) || a - b);
  const keep = new Set(ranked.slice(0, Math.max(0, target)));
  for (const i of visible) {
    const roll = keep.has(i) ? rollRegionalDeposit(region, 'surfaceDeposit', { pick: hash2d(hex.q[i], hex.r[i], pickSeed), reserve: hash2d(hex.q[i], hex.r[i], reserveSeed) }) : null;
    if (roll) setTileDeposit(state.grid, i, roll.deposit, roll.richnessBp, 0, roll.tier);
    else setTileDeposit(state.grid, i, DEPOSIT.none, 0, 0);
  }
}
