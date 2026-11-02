import { assignTemperateDeposits, assignTemperateTerrain, profileShares } from '../../temperate';
import type { WorldStage } from '../context';

/** Quota relief + classes (temperate / ocean): elevation, basin and moisture ranks fill the profile's share targets. */
export const temperateTerrain: WorldStage = { id: 'temperateTerrain', run: (ctx) => assignTemperateTerrain(ctx.state, profileShares(ctx.profile)) };

/** Visible deposits on land (consumes the planet `gen` rng, like the W01 generator always did). */
export const deposits: WorldStage = { id: 'deposits', run: (ctx) => assignTemperateDeposits(ctx.state) };
