import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { isBuildablePrepared, isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolveHqT1Row } from '../hq';
import { getTerraformOpSpec, type TerraformJob } from '../terraform-basic/queue';
import { getBuildingFootprintTiles } from './validate';

export interface SitePrepBill {
  unpreparedTiles: number;
  totalTiles: number;
  subJobs: TerraformJob[];
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
 * For each unprepared tile `(q, r)`:
 * - `TERRAIN.forest` -> `clear` (`5 s`, `30 E`) followed by `grade` (`3 s`, `20 E`)
 * - `TERRAIN.rock` -> `break` (`6 s`, `60 E`) followed by `grade` (`3 s`, `20 E`)
 * - `TERRAIN.flat` -> `grade` (`3 s`, `20 E`)
 */
export function buildLinkedPrepJobs(
  state: PlanetState,
  footprintTiles: ReadonlyArray<{ q: number; r: number }>,
  data?: CompiledDataLike,
): TerraformJob[] {
  const hex = hexIndex(state.grid.radius);
  const gradeSpec = getTerraformOpSpec('grade', data);
  const clearSpec = getTerraformOpSpec('clear', data);
  const breakSpec = getTerraformOpSpec('break', data);
  const jobs: TerraformJob[] = [];

  for (const tile of footprintTiles) {
    const tileIdx = hex.indexOf(tile.q, tile.r);
    if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) continue;
    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    if (prep === PREP.prepared || prep === PREP.living) continue;

    if (terrain === TERRAIN.forest) {
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: 'clear',
        progress: 0,
        baseTimeS: clearSpec.baseTimeS,
        totalEnergyE: clearSpec.energyCostE,
        energyDrawnE: 0,
      });
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: 'grade',
        progress: 0,
        baseTimeS: gradeSpec.baseTimeS,
        totalEnergyE: gradeSpec.energyCostE,
        energyDrawnE: 0,
      });
    } else if (terrain === TERRAIN.rock) {
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: 'break',
        progress: 0,
        baseTimeS: breakSpec.baseTimeS,
        totalEnergyE: breakSpec.energyCostE,
        energyDrawnE: 0,
      });
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: 'grade',
        progress: 0,
        baseTimeS: gradeSpec.baseTimeS,
        totalEnergyE: gradeSpec.energyCostE,
        energyDrawnE: 0,
      });
    } else if (terrain === TERRAIN.flat) {
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: 'grade',
        progress: 0,
        baseTimeS: gradeSpec.baseTimeS,
        totalEnergyE: gradeSpec.energyCostE,
        energyDrawnE: 0,
      });
    }
  }

  return jobs;
}

/**
 * Computes the full site preparation bill (`unpreparedTiles`, `subJobs`, `baseSeconds`, `hqSeconds`,
 * `totalEnergyE`, and lump `yields`) for an `N × N` footprint centered at `(q, r)` (`UO-TF-03`, `W01-15`, `W01-28`).
 */
export function computeSitePrepBill(
  state: PlanetState,
  q: number,
  r: number,
  footprint = 3,
  data?: CompiledDataLike,
): SitePrepBill {
  const coords = getBuildingFootprintTiles(q, r, footprint);
  const hex = hexIndex(state.grid.radius);
  let unpreparedTiles = 0;
  for (const pos of coords) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx < 0 || !isBuildablePrepared(state.grid, tileIdx)) {
      unpreparedTiles++;
    }
  }

  const subJobs = buildLinkedPrepJobs(state, coords, data);
  const clearSpec = getTerraformOpSpec('clear', data);
  const breakSpec = getTerraformOpSpec('break', data);
  const hqWorkRate = Number(resolveHqT1Row(data).workRate || 1.5);

  let baseSeconds = 0;
  let totalEnergyE = 0;
  const yields = { 'bio.biomass': 0, 'metals.t1': 0 };
  const countsByOp = { grade: 0, clear: 0, break: 0 };

  for (const job of subJobs) {
    baseSeconds += job.baseTimeS;
    totalEnergyE += job.totalEnergyE;
    countsByOp[job.op]++;
    if (job.op === 'clear' && clearSpec.yieldResource === 'bio.biomass') {
      yields['bio.biomass'] += clearSpec.yieldAmount;
    } else if (job.op === 'break' && breakSpec.yieldResource === 'metals.t1') {
      yields['metals.t1'] += breakSpec.yieldAmount;
    }
  }

  return {
    unpreparedTiles,
    totalTiles: coords.length,
    subJobs,
    baseSeconds,
    hqSeconds: hqWorkRate > 0 ? baseSeconds / hqWorkRate : baseSeconds,
    totalEnergyE,
    yields,
    countsByOp,
  };
}
