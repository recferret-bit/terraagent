import { noteTileStamp } from '../grid/sectors';
import type { Grid, PlanetState } from '../kernel/state';
import { defineTable } from './_define';

export const DEPOSIT_MAX_UNITS = 500;
export const DEPOSIT_MAX_RICHNESS_BP = 10000;
export const DEPOSIT_BP_PER_UNIT = DEPOSIT_MAX_RICHNESS_BP / DEPOSIT_MAX_UNITS; // 20 bp per resource unit

export type DepositStage = 'full' | 'half' | 'depleted';

/**
 * Converts a tile's deposit richness in basis points (`10000` bp = `500` units) to remaining whole resource units.
 */
export function depositRemainingUnits(richnessBp: number): number {
  if (!Number.isFinite(richnessBp) || richnessBp <= 0) return 0;
  return Math.max(0, Math.ceil((richnessBp / DEPOSIT_MAX_RICHNESS_BP) * DEPOSIT_MAX_UNITS));
}

/**
 * Maps deposit richness in basis points (`10000` bp full, `5000` bp half, `<= 0` depleted) to its 3-stage visual state.
 */
export function depositStageFromRichness(richnessBp: number): DepositStage {
  if (!Number.isFinite(richnessBp) || richnessBp <= 0) return 'depleted';
  return richnessBp <= 5000 ? 'half' : 'full';
}

/**
 * Consumes `unitsExtracted` resource units (`20` bp per `1` unit) from `layers.richness[tileIdx]`,
 * clamped to `0`. Preserves `layers.deposit[tileIdx]` so depleted deposits still occupy 1 hex.
 * Stamps `changedAt` whenever the stage crosses `5000` or `0` (or every 10 ticks) and returns actual units extracted.
 */
export function consumeDepositRichness(
  stateOrGrid: PlanetState | Grid,
  tileIdx: number,
  unitsExtracted: number,
  tick: number,
): number {
  const grid = 'grid' in stateOrGrid ? stateOrGrid.grid : stateOrGrid;
  const richness = grid.layers.richness as Float32Array | undefined;
  if (!richness || tileIdx < 0 || tileIdx >= grid.count || unitsExtracted <= 0) return 0;
  const prevBp = Number(richness[tileIdx] ?? 0);
  if (prevBp <= 0) return 0;
  const prevStage = depositStageFromRichness(prevBp);
  const requestedBp = unitsExtracted * DEPOSIT_BP_PER_UNIT;
  const consumedBp = Math.min(prevBp, requestedBp);
  const nextBp = Math.max(0, prevBp - consumedBp);
  richness[tileIdx] = nextBp;
  const nextStage = depositStageFromRichness(nextBp);
  if (prevStage !== nextStage || tick % 10 === 0) {
    grid.layers.changedAt[tileIdx] = tick;
    noteTileStamp(grid.layers.changedAt, tileIdx, tick);
  }
  return consumedBp / DEPOSIT_BP_PER_UNIT;
}

/**
 * Terrain classes and ground passability multipliers (§4.8 table), read by the running sim through compiled data
 * (`grid/tileModel.ts`). `code` mirrors the `TERRAIN` layer code (fixed). Generation numbers (class shares, deposit
 * richness, spawn slot guarantees) live in `data/worldgen.ts` (WE-19).
 */
export default defineTable({
  name: 'terrain',
  summary: 'Terrain classes and ground passability multipliers (W01).',
  fixed: { fields: ['code'], why: 'the code is the TERRAIN layer value stored in every planet' },
  rows: [
    { id: 'flat', wave: 'W01', code: 0, moveMult: 1.0, passable: true },
    { id: 'forest', wave: 'W01', code: 1, moveMult: 0.6, passable: true },
    { id: 'rock', wave: 'W01', code: 2, moveMult: 0.5, passable: true },
    { id: 'slope', wave: 'W01', code: 3, moveMult: 0.7, passable: true },
    { id: 'hole', wave: 'W01', code: 4, moveMult: 0.5, passable: true },
    { id: 'shallow', wave: 'W01', code: 5, moveMult: 0.5, passable: true },
    { id: 'deep', wave: 'W01', code: 6, moveMult: 0.0, passable: false },
    { id: 'temperate', wave: 'W01', livingMoveMult: 1.1 }, // UO-TF-07: Living tiles give +10 % move speed (every planet type)
  ],
});
