import { assignTemperateDeposits, assignTemperateTerrain, TEMPERATE_SHARES, type TerrainShares } from '../../temperate';
import type { WorldGenContext, WorldStage } from '../context';

function sharesOf(ctx: WorldGenContext): TerrainShares {
  const n = (k: keyof TerrainShares) => ctx.num(`share${k[0].toUpperCase()}${k.slice(1)}`, TEMPERATE_SHARES[k]);
  return { flat: n('flat'), forest: n('forest'), rock: n('rock'), slope: n('slope'), hole: n('hole'), shallow: n('shallow'), deep: n('deep') };
}

/** Quota relief + classes (temperate / ocean): elevation, basin and moisture ranks fill the profile's share targets. */
export const temperateTerrain: WorldStage = { id: 'temperateTerrain', run: (ctx) => assignTemperateTerrain(ctx.state, sharesOf(ctx)) };

/** Visible deposits on land (consumes the planet `gen` rng, like the W01 generator always did). */
export const deposits: WorldStage = { id: 'deposits', run: (ctx) => assignTemperateDeposits(ctx.state) };
