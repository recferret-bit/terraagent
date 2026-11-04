import type { ResourceKey } from '@terra/contracts';
import { isPreparedGround } from '../../grid/geo';
import { hexIndex } from '../../grid/hex';
import { isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolveHqT1Row, rowNum } from '../rows';
import {
  SITE_PREP_TERRAFORM_OPS,
  getTerraformJobCost,
  getTerraformOpSpec,
  opForTerrain,
  type SitePrepTerraformOp,
} from '../terraform-basic/ops';
import type { TerraformJob } from '../terraform-basic/orders';

export interface SitePrepOpCounts {
  grade: number;
  clear: number;
  break: number;
  level?: number;
  fill?: number;
  reclaim?: number;
  deepReclaim?: number;
}

export interface SitePrepBill {
  baseSeconds: number;
  hqSeconds: number;
  totalEnergyE: number;
  yields: {
    'bio.biomass': number;
    'metals.t1': number;
    'minerals.t1': number;
  };
  cost?: Partial<Record<ResourceKey, number>>;
  countsByOp: SitePrepOpCounts;
}

/**
 * Plans the missing S0 terraform sub-jobs (`clear`, `break`, `level`, `fill`, `reclaim`, `deepReclaim`, `grade`)
 * needed to make every tile in `footprintTiles` buildable (`PREP.prepared` / `PREP.irrigated` / `PREP.living`)
 * (`UO-TF-03`, `W01-15`, `W05-09`).
 *
 * For each unprepared tile `(q, r)`: forest -> `clear` then `grade`, rock -> `break` then `grade`,
 * slope -> `level` then `grade`, hole -> `fill` then `grade`, shallow -> `reclaim` then `grade`,
 * deep -> `deepReclaim` then `grade`, flat -> `grade` (times, energy and costs from `opsBasic`).
 */
export function buildLinkedPrepJobs(
  state: PlanetState,
  footprintTiles: ReadonlyArray<{ q: number; r: number }>,
  data?: CompiledDataLike,
): TerraformJob[] {
  const hex = hexIndex(state.grid.radius);
  const tiles: PrepTileInput[] = [];
  for (const tile of footprintTiles) {
    const tileIdx = hex.indexOf(tile.q, tile.r);
    if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) continue;
    tiles.push({ q: tile.q, r: tile.r, terrain: state.grid.layers.terrain[tileIdx], prep: state.grid.layers.prep[tileIdx] });
  }
  return planPrepJobs(tiles, data);
}

/** One footprint tile as the prep planner sees it (shared by the sim and the client ghost). */
export interface PrepTileInput {
  q: number;
  r: number;
  terrain: number;
  prep: number;
}

/** Pure planner behind `buildLinkedPrepJobs`: the ordered S0 ops that turn each tile into Prepared ground. */
export function planPrepJobs(tiles: ReadonlyArray<PrepTileInput>, data?: CompiledDataLike): TerraformJob[] {
  const job = (q: number, r: number, op: SitePrepTerraformOp): TerraformJob => {
    const spec = getTerraformOpSpec(op, data);
    const totalCost = getTerraformJobCost(op, data);
    return {
      q,
      r,
      op,
      progress: 0,
      baseTimeS: spec.baseTimeS,
      totalEnergyE: spec.energyCostE,
      energyDrawnE: 0,
      ...(Object.keys(totalCost).length > 0 ? { totalCost, spentCost: {} } : {}),
    };
  };
  const jobs: TerraformJob[] = [];
  for (const t of tiles) {
    if (isPreparedGround(t.prep)) continue;
    // The ops the data rows chain from this terrain to flat ground, ending with the terrain-keeping op (Grade).
    let terrain = t.terrain;
    for (let n = 0; n < SITE_PREP_TERRAFORM_OPS.length; n++) {
      const op = opForTerrain(terrain, data);
      if (!op) break;
      jobs.push(job(t.q, t.r, op));
      const spec = getTerraformOpSpec(op, data);
      if (spec.toTerrain === spec.fromTerrain) break;
      terrain = spec.toTerrain;
    }
  }
  return jobs;
}

/** Sums a prep job list into time / energy / lump yields / costs (`hqWorkRate` divides the time for the HQ worker). */
export function summarizePrepJobs(
  jobs: ReadonlyArray<TerraformJob>,
  data?: CompiledDataLike,
): SitePrepBill {
  const hqWorkRate = rowNum(resolveHqT1Row(data), 'workRate');
  let baseSeconds = 0;
  let totalEnergyE = 0;
  const yields = { 'bio.biomass': 0, 'metals.t1': 0, 'minerals.t1': 0 };
  const cost: Partial<Record<ResourceKey, number>> = {};
  const countsByOp: SitePrepOpCounts = { grade: 0, clear: 0, break: 0 };
  for (const job of jobs) {
    baseSeconds += job.baseTimeS;
    totalEnergyE += job.totalEnergyE;
    if (job.op === 'grade' || job.op === 'clear' || job.op === 'break') {
      countsByOp[job.op]++;
    } else if (job.op === 'level' || job.op === 'fill' || job.op === 'reclaim' || job.op === 'deepReclaim') {
      countsByOp[job.op] = (countsByOp[job.op] ?? 0) + 1;
    }
    const spec = getTerraformOpSpec(job.op, data);
    for (const [k, v] of Object.entries(spec.yields)) if (k in yields && v) yields[k as keyof typeof yields] += v;
    for (const [k, v] of Object.entries(spec.cost) as [ResourceKey, number][]) {
      if (v > 0) cost[k] = (cost[k] ?? 0) + v;
    }
  }
  return {
    baseSeconds,
    hqSeconds: hqWorkRate > 0 ? baseSeconds / hqWorkRate : baseSeconds,
    totalEnergyE,
    yields,
    ...(Object.keys(cost).length > 0 ? { cost } : {}),
    countsByOp,
  };
}
