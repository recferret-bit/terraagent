import { restore, snapshot } from '../codec/snapshot';
import type { PlanetState } from '../kernel/state';

/** Deep copy via the snapshot codec (typed arrays copied, capacity and change stamps preserved). */
export const clone = (state: PlanetState): PlanetState => restore(snapshot(state));
