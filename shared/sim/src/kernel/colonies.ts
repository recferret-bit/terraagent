import { DEFAULT_COLONY_COLORS } from '@terra/contracts/tiles/codes';
import type { ColonyState, PlanetState } from './state';

/** Colors given to colony records created without one, by colony index: the one palette in `@terra/contracts` (GP-28). */
export { DEFAULT_COLONY_COLORS };

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
