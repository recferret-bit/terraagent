import { W01_TERRAFORM_OPS } from '@terra/contracts';
import { hexIndex } from '../../grid/hex';
import { PREP } from '../../grid/layers';
import { isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolveHqT1Row, rowNum } from '../rows';
import { getTerraformOpSpec, opForTerrain } from '../terraform-basic/ops';
import type { TerraformJob } from '../terraform-basic/orders';

export interface SitePrepBill {
  baseSeconds: number;
  hqSeconds: number;
  totalEnergyE: number;
  yields: {
    'bio.biomass': number;
    'metals.t1': number;
  };
  countsByOp: {
    grade: number;
    clear: number;
    break: number;
  };
}

/**
 * Plans the missing S0 terraform sub-jobs (`clear`, `break`, `grade`) needed to make every tile in
 * `footprintTiles` buildable (`PREP.prepared` / `PREP.living`) (`UO-TF-03`, `W01-15`).
 *
 * For each unprepared tile `(q, r)`: forest -> `clear` then `grade`, rock -> `break` then `grade`, flat -> `grade`
 * (times and energy from `opsBasic`). Placement (D-37) only accepts flat footprints, so a Hub's prep is Grade only.
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
  const job = (q: number, r: number, op: 'grade' | 'clear' | 'break'): TerraformJob => {
    const spec = getTerraformOpSpec(op, data);
    return { q, r, op, progress: 0, baseTimeS: spec.baseTimeS, totalEnergyE: spec.energyCostE, energyDrawnE: 0 };
  };
  const jobs: TerraformJob[] = [];
  for (const t of tiles) {
    if (t.prep === PREP.prepared || t.prep === PREP.living) continue;
    // The ops the data rows chain from this terrain to flat ground, ending with the terrain-keeping op (Grade).
    let terrain = t.terrain;
    for (let n = 0; n < W01_TERRAFORM_OPS.length; n++) {
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

/** Sums a prep job list into time / energy / lump yields (`hqWorkRate` divides the time for the HQ worker). */
export function summarizePrepJobs(
  jobs: ReadonlyArray<TerraformJob>,
  data?: CompiledDataLike,
): SitePrepBill {
  const hqWorkRate = rowNum(resolveHqT1Row(data), 'workRate');
  let baseSeconds = 0;
  let totalEnergyE = 0;
  const yields = { 'bio.biomass': 0, 'metals.t1': 0 };
  const countsByOp = { grade: 0, clear: 0, break: 0 };
  for (const job of jobs) {
    baseSeconds += job.baseTimeS;
    totalEnergyE += job.totalEnergyE;
    countsByOp[job.op]++;
    const spec = getTerraformOpSpec(job.op, data);
    if (spec.yieldResource && spec.yieldResource in yields) yields[spec.yieldResource as keyof typeof yields] += spec.yieldAmount;
  }
  return { baseSeconds, hqSeconds: hqWorkRate > 0 ? baseSeconds / hqWorkRate : baseSeconds, totalEnergyE, yields, countsByOp };
}
