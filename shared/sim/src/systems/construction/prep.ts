import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { isBuildablePrepared, isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolveHqT1Row } from '../hq';
import { getTerraformOpSpec, type TerraformJob } from '../terraform-basic/queue';
import { getBuildingFootprintTiles } from './placement';

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
    if (t.terrain === TERRAIN.forest) jobs.push(job(t.q, t.r, 'clear'), job(t.q, t.r, 'grade'));
    else if (t.terrain === TERRAIN.rock) jobs.push(job(t.q, t.r, 'break'), job(t.q, t.r, 'grade'));
    else if (t.terrain === TERRAIN.flat) jobs.push(job(t.q, t.r, 'grade'));
  }
  return jobs;
}

/** Sums a prep job list into time / energy / lump yields (`hqWorkRate` divides the time for the HQ worker). */
export function summarizePrepJobs(
  jobs: ReadonlyArray<TerraformJob>,
  data?: CompiledDataLike,
): Pick<SitePrepBill, 'baseSeconds' | 'hqSeconds' | 'totalEnergyE' | 'yields' | 'countsByOp'> {
  const clearSpec = getTerraformOpSpec('clear', data);
  const breakSpec = getTerraformOpSpec('break', data);
  const hqWorkRate = Number(resolveHqT1Row(data).workRate || 1.5);
  let baseSeconds = 0;
  let totalEnergyE = 0;
  const yields = { 'bio.biomass': 0, 'metals.t1': 0 };
  const countsByOp = { grade: 0, clear: 0, break: 0 };
  for (const job of jobs) {
    baseSeconds += job.baseTimeS;
    totalEnergyE += job.totalEnergyE;
    countsByOp[job.op as keyof typeof countsByOp]++;
    if (job.op === 'clear' && clearSpec.yieldResource === 'bio.biomass') yields['bio.biomass'] += clearSpec.yieldAmount;
    else if (job.op === 'break' && breakSpec.yieldResource === 'metals.t1') yields['metals.t1'] += breakSpec.yieldAmount;
  }
  return { baseSeconds, hqSeconds: hqWorkRate > 0 ? baseSeconds / hqWorkRate : baseSeconds, totalEnergyE, yields, countsByOp };
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
  const sum = summarizePrepJobs(subJobs, data);

  return {
    unpreparedTiles,
    totalTiles: coords.length,
    subJobs,
    ...sum,
  };
}
