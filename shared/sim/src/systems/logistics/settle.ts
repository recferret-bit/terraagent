import { ENTITY_STATE } from '../../ecs/columns';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { isActiveCapacityProvider } from '../economy/ledger';
import { rowOf } from '../../ecs/store';
import { addMicro, cleanMap, releaseToColony } from './micro';
import type { ColonyLogistics, MicroMap } from './state';

const alive = (state: PlanetState, id: string): number => {
  const r = rowOf(state.entities, Number(id));
  return r >= 0 && state.entities.cols.hp[r] > 0 ? r : -1;
};

/**
 * Settles the pinned window at `tick`: only the delivered share `(tick - startTick) / (endTick - startTick)` of the planned
 * consumption stays consumed; the unconsumed held supply returns to the colony (`logistics.release`) and the unused part of
 * a local-reserve draw goes back into the entity's reserve. Idempotent: the record is cleared.
 */
export function settleWindow(state: PlanetState, col: ColonyState, cs: ColonyLogistics, tick: number): void {
  const w = cs.window;
  if (!w) return;
  const len = w.endTick - w.startTick;
  const dt = Math.max(0, Math.min(len, tick - w.startTick));
  const release: MicroMap = {};
  for (const [id, e] of Object.entries(w.entities)) {
    const local = cs.entities[id];
    for (const [k, held] of Object.entries(e.held)) addMicro(release, k, held - (len > 0 ? Math.floor(((e.fromSupply[k] ?? 0) * dt) / len) : 0));
    if (!local) continue;
    for (const [k, v] of Object.entries(e.fromReserve)) addMicro(local.reserve, k, v - Math.floor((v * dt) / len));
    local.reserve = cleanMap(local.reserve);
  }
  releaseToColony(col, release, tick);
  cs.settledKey = w.key;
  cs.window = null;
}

/** Whether a pinned window is still valid: every used node still powered and every planned entity still alive. */
export function windowStillValid(state: PlanetState, cs: ColonyLogistics): boolean {
  const w = cs.window;
  if (!w) return true;
  const cols = state.entities.cols;
  for (const id of Object.keys(w.entities)) if (alive(state, id) < 0) return false;
  for (const id of w.nodeIds) {
    const nr = alive(state, id);
    if (nr < 0 || cols.state[nr] === ENTITY_STATE.constructing || !isActiveCapacityProvider(state, nr)) return false;
  }
  return true;
}

/** Returns the reserve of entities that no longer exist to the colony and forgets them. */
export function releaseGone(state: PlanetState, col: ColonyState, cs: ColonyLogistics, live: ReadonlySet<string>, tick: number): void {
  const back: MicroMap = {};
  for (const [id, l] of Object.entries(cs.entities)) {
    if (live.has(id)) continue;
    for (const [k, v] of Object.entries(l.reserve)) addMicro(back, k, v);
    delete cs.entities[id];
  }
  releaseToColony(col, back, tick);
}
