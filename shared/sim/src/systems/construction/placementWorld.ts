import type { SimState } from '../../kernel/state';
import type { PlacementEntity, PlacementWorld } from './placement';

/** Adapts authoritative `SimState` (server / browser-local host) into the read-only `PlacementWorld`. */
export function placementWorldFromState(state: SimState): PlacementWorld {
  const L = state.grid.layers;
  const e = state.entities;
  const c = e.cols;
  const entities: PlacementEntity[] = [];
  for (let i = 0; i < e.count; i++) {
    entities.push({ id: c.id[i], kind: c.kind[i], owner: c.owner[i], q: c.q[i], r: c.r[i], hp: c.hp[i], hpMax: c.hpMax[i], state: c.state[i] });
  }
  return {
    radius: state.grid.radius,
    tileCount: state.grid.count,
    terrain: L.terrain as ArrayLike<number>,
    prep: L.prep as ArrayLike<number>,
    deposit: (L.deposit as ArrayLike<number> | undefined) ?? null,
    owner: L.owner as ArrayLike<number>,
    height: (L.height as ArrayLike<number> | undefined) ?? null,
    valid: (L as { valid?: ArrayLike<number> }).valid ?? null,
    entities,
  };
}
