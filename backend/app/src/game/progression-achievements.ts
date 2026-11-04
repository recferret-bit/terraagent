/** The Landfall progression event kinds (W01-31) and the achievement each one counts towards (content, not code). */
export const PROGRESSION_ACHIEVEMENTS = {
  tilePrepared: 'Groundbreaker',
  obstacleRemoved: 'Stone Mason',
  colonyFounded: 'Landfall',
} as const;

export type ProgressionKind = keyof typeof PROGRESSION_ACHIEVEMENTS;

export const OBSTACLE_REMOVED_OPS = ['clear', 'break', 'level', 'fill', 'reclaim', 'deepReclaim', 'seed'] as const;
export type ObstacleRemovedOp = (typeof OBSTACLE_REMOVED_OPS)[number];

const VALID_OBSTACLE_OPS: ReadonlySet<string> = new Set(OBSTACLE_REMOVED_OPS);

export function isObstacleRemovedOp(op: unknown): op is ObstacleRemovedOp {
  return typeof op === 'string' && VALID_OBSTACLE_OPS.has(op);
}

/**
 * Maps an `obstacleRemoved` op to its achievement family name (W05-29):
 *  - `'clear' | 'break' | 'level' | 'fill'` -> `'Stone Mason'`
 *  - `'reclaim' | 'deepReclaim'` -> `'Hydro Engineer'`
 *  - `'seed'` -> `'Green Thumb'`
 */
export function resolveObstacleRemovedAchievement(op: unknown): string {
  if (op === 'reclaim' || op === 'deepReclaim') return 'Hydro Engineer';
  if (op === 'seed') return 'Green Thumb';
  return 'Stone Mason';
}

/** Checks whether `kind` is one of the Landfall progression event kinds. */
export function isProgressionEventKind(kind: string): kind is ProgressionKind {
  return Object.hasOwn(PROGRESSION_ACHIEVEMENTS, kind);
}

