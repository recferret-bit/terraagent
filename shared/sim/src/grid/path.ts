import type { GridLike } from './tileModel';
import { continueAStarSearch, createAStarSearch, type AxialCoord, type FindHexPathOptions, type HexPathResult } from './pathSearch';

export {
  FAR_HEURISTIC_WEIGHT_BP,
  HEURISTIC_WEIGHT_BP,
  tileStepCostBp,
  type AxialCoord,
  type FindHexPathOptions,
  type HexPathResult,
  type PathGoalBand,
} from './pathSearch';
export * from './pathProfiles';
export * from './pathQueue';

/**
 * Deterministic A* hex pathfinder over passable ground tiles with terrain multipliers (`SIM-T-02`), in one call.
 * `path` is inclusive of both `from` (`path[0]`) and the goal tile (`path[path.length - 1]`).
 *
 * Game code does not call this to move a unit: units move through the movement orchestrator
 * (`units/movement/orchestrator.ts`), which queues requests and spends the per-step budget. This one-shot form is for
 * tools, tests and tile-query helpers.
 */
export function findHexPath(grid: GridLike, from: AxialCoord, to: AxialCoord, opts?: FindHexPathOptions): HexPathResult {
  const maxExp = opts?.maxExpansions !== undefined ? Math.max(0, Math.floor(opts.maxExpansions)) : Infinity;
  const search = createAStarSearch(grid, from, to, opts);
  // One call, never resumed: run the sealed-pocket check without deferring it (WE-13), so a small `maxExpansions`
  // still spends its whole budget. The check may push `expansions` up to `MAX_POCKET_NODES` past `maxExpansions`
  // when it proves the goal sealed off.
  continueAStarSearch(search, maxExp, true);
  if (search.done && search.result) return search.result;
  return { ok: false, path: [], expansions: search.expansions, totalCostBp: 0 };
}
