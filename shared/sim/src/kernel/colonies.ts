import type { ColonyState, PlanetState } from './state';

/** Colors given to colony records created without one, by colony index. */
export const DEFAULT_COLONY_COLORS = [0xff6a2a, 0x2ec4b6, 0xe71d36, 0xff9f1c, 0x8338ec, 0x3a86ff] as const;

/**
 * The colony record at `index`, creating it (and any missing lower indices) as a `founding` colony stamped at `tick`.
 * An existing record is returned untouched; callers stamp `changedAt` when they change it.
 */
export function ensureColonyRecord(state: PlanetState, index: number, tick: number): ColonyState {
  while (state.colonies.length <= index) {
    const i = state.colonies.length;
    state.colonies.push({
      index: i,
      id: `col_${i}`,
      name: `Colony ${i + 1}`,
      color: DEFAULT_COLONY_COLORS[i % DEFAULT_COLONY_COLORS.length],
      status: 'founding',
      changedAt: tick,
    });
  }
  return state.colonies[index];
}
