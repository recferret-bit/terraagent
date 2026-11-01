import { hexRound } from '../grid/hex';
import { setField, type EntityStore } from './store';

/**
 * Entity position writes outside locomotion. Live entities move only along routes (`units/movement/locomotion.ts`);
 * the sim lint (`eslint.rules.js`, "position writes") rejects writes to `x`, `y`, `q`, `r` anywhere else. The two
 * exceptions are here and nowhere else:
 *  - `placeSpawnedEntity`: the initial position of a row inserted in this same step (spawning is not moving);
 *  - `adminRelocateEntity`: dev/admin commands (`dev.teleport`, `dev.nudge`, `dev.land`); the lint allows calls to it
 *    only from `systems/dev/`.
 */

/** Sets the starting tile of a row inserted at `tick` (throws if the row already existed: move it with a command). */
export function placeSpawnedEntity(s: EntityStore, row: number, q: number, r: number, tick: number): void {
  const cols = s.cols;
  if (cols.createdAt[row] !== tick) {
    throw new Error(`placeSpawnedEntity: row ${row} (entity ${cols.id[row]}) was not spawned this step; units move only through unit commands`);
  }
  cols.q[row] = q;
  cols.r[row] = r;
  cols.x[row] = Math.fround(q);
  cols.y[row] = Math.fround(r);
  cols.targetQ[row] = q;
  cols.targetR[row] = r;
}

/** Admin teleport: sets an existing entity's position directly. Only `systems/dev/` may call this (lint-enforced). */
export function adminRelocateEntity(s: EntityStore, row: number, x: number, y: number, tick: number): void {
  const [q, r] = hexRound(x, y);
  setField(s, row, 'q', q, tick);
  setField(s, row, 'r', r, tick);
  setField(s, row, 'x', x, tick);
  setField(s, row, 'y', y, tick);
  setField(s, row, 'targetQ', q, tick);
  setField(s, row, 'targetR', r, tick);
}
