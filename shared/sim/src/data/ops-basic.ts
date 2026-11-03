import { defineTable } from './_define';

export interface TerraformTimeSpec {
  readonly durationTicks: number;
  readonly durationSec: number;
  readonly energyCost: number;
  readonly refundRate?: number;
  readonly costRate?: number;
}

/**
 * Authoritative table mapping every terrain/object kind to its terraforming/work duration
 * (in ticks and seconds at 20 Hz) and energy cost.
 */
export const TERRAFORM_TIME_TABLE = {
  flat: { durationTicks: 40, durationSec: 2.0, energyCost: 6 },
  slope: { durationTicks: 80, durationSec: 4.0, energyCost: 12 },
  hole: { durationTicks: 80, durationSec: 4.0, energyCost: 12 },
  forest: { durationTicks: 60, durationSec: 3.0, energyCost: 8 },
  rock: { durationTicks: 100, durationSec: 5.0, energyCost: 15 },
  dismantle: { durationTicks: 60, durationSec: 3.0, energyCost: 5, refundRate: 0.5 },
  repair: { durationTicks: 80, durationSec: 4.0, energyCost: 0, costRate: 0.4 },
} as const satisfies Readonly<Record<string, TerraformTimeSpec>>;

export type TerraformTimeKey = keyof typeof TERRAFORM_TIME_TABLE;
export const DISMANTLE_REFUND_RATE = TERRAFORM_TIME_TABLE.dismantle.refundRate;
export const REPAIR_COST_RATE = TERRAFORM_TIME_TABLE.repair.costRate;

export { TERRAFORM_RESOURCE_SPAWN } from './terraform-finds';

/**
 * Basic S0 terraform operations: Grade, Clear, Break (`UO-TF` §4.5 table).
 * `timeS` converts to ticks in `compileData` (readers convert back to seconds for UI prep bills). `fromTerrain` /
 * `toTerrain` / `toPrep` are the tile rule the sim applies (terrain / prep keys of `grid/layers`).
 * `yields` is THE terraform yield table (owner decision W02): what clearing a tree (Clear) or breaking a rock (Break)
 * pays, a lump sum per tile (never scaled by `ECONOMY_RATE_SCALE`, UO-TF-05). Every path reads it through
 * `terraformYields` / `groundWorkYields` (`systems/terraform-basic/ops.ts`): the order path, a Hub's linked prep,
 * the `work` jobs (TERRAFORM dock) and the UI. Tunable: `tune opsBasic.break.yields {"metals.t1":8,"minerals.t1":4}`.
 */
export default defineTable({
  name: 'opsBasic',
  summary: 'S0 ground preparation operations Grade, Clear, and Break (UO-TF §4.5); `yields` = the terraform yield per tile.',
  units: { timeS: 'seconds' },
  amounts: ['yields'],
  rows: [
    {
      id: 'grade',
      wave: 'W01',
      timeS: 3,
      energyCostE: 20,
      fromTerrain: 'flat',
      toTerrain: 'flat',
      toPrep: 'prepared',
      yields: {},
      unlockStage: 0,
    },
    {
      id: 'clear',
      wave: 'W01',
      timeS: 5,
      energyCostE: 30,
      fromTerrain: 'forest',
      toTerrain: 'flat',
      toPrep: 'flat',
      yields: { 'bio.biomass': 15 },
      unlockStage: 0,
    },
    {
      id: 'break',
      wave: 'W01',
      timeS: 6,
      energyCostE: 60,
      fromTerrain: 'rock',
      toTerrain: 'flat',
      toPrep: 'flat',
      yields: { 'metals.t1': 8, 'minerals.t1': 4 },
      unlockStage: 0,
    },
  ],
});
