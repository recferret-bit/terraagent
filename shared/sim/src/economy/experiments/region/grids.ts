/** A named point of a comparison grid: the axis values the runner expands into one scenario/profile variant each. */
export interface GridPoint { readonly id: string; readonly values: Readonly<Record<string, number | string>> }

/**
 * Cartesian expansion of a grid (`axes` in the order given, last axis varies fastest). Deterministic ids `a=1,b=2`.
 * The required §9 grids are provided as constants below; fixtures may define their own.
 */
export function expandGrid(axes: Readonly<Record<string, readonly (number | string)[]>>): GridPoint[] {
  let points: GridPoint[] = [{ id: '', values: {} }];
  for (const [axis, vals] of Object.entries(axes)) {
    points = points.flatMap((p) => vals.map((v) => ({ id: p.id ? `${p.id},${axis}=${v}` : `${axis}=${v}`, values: { ...p.values, [axis]: v } })));
  }
  return points;
}

/** ECONOMY §9 required comparison grids. Weights and alphas are bp (10000 = 1.0). */
export const REGION_GRIDS = {
  desertCrystalWeightBp: { crystalWeightBp: [1500, 3000, 6000] },
  armyLoadByDepots: { load: [100, 150, 200, 300], depots: ['fixed', 'expanded'] },
  routeTiles: { routeTiles: [0, 30, 60, 90] },
  alphaBp: { alphaBp: [0, 1000, 2500, 5000] },
} as const;

export const regionGrid = (name: keyof typeof REGION_GRIDS): GridPoint[] => expandGrid(REGION_GRIDS[name]);
