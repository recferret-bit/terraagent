import { ENTITY_KIND, ENTITY_STATE } from '../ecs/columns';
import type { PlanetState } from '../kernel/state';

/**
 * The first alive entity of `kind` owned by `colony` (row index, or -1): the one "find the colony's HQ / Hub / pod"
 * scan (GP-28). Alive = no HP pool or HP above 0. `landed` also skips a descending entity.
 */
export function findColonyEntityRow(state: PlanetState, colony: number, kind: number, opts: { landed?: boolean } = {}): number {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== kind || cols.owner[row] !== colony) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    if (opts.landed && cols.state[row] === ENTITY_STATE.descending) continue;
    return row;
  }
  return -1;
}

/** The row of `colony`'s alive HQ, or -1. */
export const findColonyHqRow = (state: PlanetState, colony: number): number => findColonyEntityRow(state, colony, ENTITY_KIND.hq);

/**
 * Who an event is about: the colony's string id (`colonyIds[0]` and `data.colonyId`, `col_<index>` before it has one)
 * and its `playerId` when set. One shape for every player-facing event (`buildingCompleted`, terraform events).
 */
export const colonyWho = (state: PlanetState, colonyId: number) => {
  const col = state.colonies[colonyId];
  const colonyIdStr = col?.id ?? `col_${colonyId}`;
  const playerId = typeof col?.playerId === 'string' ? col.playerId : undefined;
  return { colonyIdStr, who: { colonyId: colonyIdStr, ...(playerId ? { playerId } : {}) } };
};
