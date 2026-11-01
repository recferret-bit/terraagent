import type { PlanetState } from '../kernel/state';
import { isGroundMoveBlocked } from './geo';

/**
 * Named movement profiles for path requests. A request in the path queue is plain data (it lives in a blob), so it
 * names its obstacle rule instead of carrying a function. `none` = terrain passability only (Deep, Ridge, Moat block).
 */
export type PathProfileId = 'none' | 'ground';

const PROFILES: Record<PathProfileId, ((state: PlanetState) => (tileIdx: number) => boolean) | null> = {
  none: null,
  /** Ground units: untouched forest and rock (until Clear / Break) and resource deposits also block. */
  ground: (state) => {
    const { terrain, deposit } = state.grid.layers;
    return (i) => isGroundMoveBlocked(terrain[i], deposit[i]);
  },
};

/** The extra-obstacle predicate of `profile` on `state` (undefined for `none`). */
export function pathBlockedFor(state: PlanetState, profile: PathProfileId | undefined): ((tileIdx: number) => boolean) | undefined {
  const make = PROFILES[profile ?? 'none'];
  return make ? make(state) : undefined;
}
