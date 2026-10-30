import type { PlanetState } from '../kernel/state';
import type { PlanetType } from '../kernel/state';

/**
 * W00 view: a minimal read-only projection for render/HUD. Tile arrays are shared with the state (no copy; do not
 * mutate); entities and colonies are fresh plain objects. Features extend it by adding fields here.
 */
export interface ViewEntity { id: number; kind: number; owner: number; q: number; r: number; x: number; y: number; rot: number; hp: number; hpMax: number; state: number; progress: number }
export interface ViewColony { index: number; id: string; name: string; color: number; status: string }
export interface SimView {
  tick: number;
  planet: { id: string; type: PlanetType; radius: number };
  tiles: { count: number; terrain: Uint8Array; prep: Uint8Array; height: Float32Array; owner: Int8Array };
  entities: ViewEntity[];
  colonies: ViewColony[];
}

export function view(state: PlanetState): SimView {
  const e = state.entities, c = e.cols, L = state.grid.layers;
  const entities: ViewEntity[] = [];
  for (let i = 0; i < e.count; i++) {
    entities.push({ id: c.id[i], kind: c.kind[i], owner: c.owner[i], q: c.q[i], r: c.r[i], x: c.x[i], y: c.y[i], rot: c.rot[i], hp: c.hp[i], hpMax: c.hpMax[i], state: c.state[i], progress: c.progress[i] });
  }
  return {
    tick: state.meta.tick,
    planet: { id: state.meta.planetId, type: state.meta.planetType, radius: state.grid.radius },
    tiles: { count: state.grid.count, terrain: L.terrain as Uint8Array, prep: L.prep as Uint8Array, height: L.height as Float32Array, owner: L.owner as Int8Array },
    entities,
    colonies: state.colonies.map((k) => ({ index: k.index, id: k.id, name: k.name, color: k.color, status: k.status })),
  };
}
