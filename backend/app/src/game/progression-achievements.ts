/** The Landfall progression event kinds (W01-31) and the achievement each one counts towards (content, not code). */
export const PROGRESSION_ACHIEVEMENTS = {
  tilePrepared: 'Groundbreaker',
  obstacleRemoved: 'Stone Mason',
  colonyFounded: 'Landfall',
} as const;

export type ProgressionKind = keyof typeof PROGRESSION_ACHIEVEMENTS;

/** Checks whether `kind` is one of the Landfall progression event kinds. */
export function isProgressionEventKind(kind: string): kind is ProgressionKind {
  return Object.hasOwn(PROGRESSION_ACHIEVEMENTS, kind);
}
