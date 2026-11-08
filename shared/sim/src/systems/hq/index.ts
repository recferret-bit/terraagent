import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { isTileExplored, markTileExplored } from '../../grid/tileModel';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { stepHqCombatSurvival } from '../combat/damage';
import { resolveHqT1Row, rowNum } from '../rows';
import { stepHq } from './cell';
import { syncHqView } from './view';

export type { SimState };
export { defaultW01Data, resolveHqT1Row } from '../rows';
export * from './cell';
export * from './view';

export interface SpawnHqOpts {
  owner: number;
  q: number;
  r: number;
  tick?: number;
  data?: CompiledDataLike;
}

/**
 * Marks every tile within `viewRadius` of `(centerQ, centerR)` as explored for `owner` (`markTileExplored`; only tiles
 * not explored yet are written and stamped). Supports all non-negative colony indices (`W11-39`).
 */
export function revealVision(state: PlanetState, owner: number, centerQ: number, centerR: number, viewRadius: number, tick: number): void {
  if (!Number.isInteger(owner) || owner < 0) return;
  const idx = hexIndex(state.grid.radius);
  for (let dr = -viewRadius; dr <= viewRadius; dr++) {
    const dqMin = Math.max(-viewRadius, -dr - viewRadius);
    const dqMax = Math.min(viewRadius, -dr + viewRadius);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const tileIdx = idx.indexOf(centerQ + dq, centerR + dr);
      if (tileIdx >= 0 && !isTileExplored(state.grid, tileIdx, owner)) markTileExplored(state.grid, tileIdx, owner, tick);
    }
  }
}

/** The HQ's vision radius (`hq.t1.viewRadius`). */
export const hqViewRadius = (data?: CompiledDataLike): number => rowNum(resolveHqT1Row(data), 'viewRadius');

/**
 * Spawns an HQ T1 Commander Drone at `(opts.q, opts.r)` for `opts.owner`, initializes its stats from `hq.t1`,
 * reveals the fog within `viewRadius` and returns the new `entityId`.
 */
export function spawnHqUnit(state: PlanetState, opts: SpawnHqOpts, ctx?: StepContext): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const hqRow = resolveHqT1Row(data);
  ensureColonyRecord(state, opts.owner, tick); // an HQ always belongs to a colony record (the treasury needs one, GP-24)
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.hq;
  cols.owner[row] = opts.owner;
  cols.tier[row] = rowNum(hqRow, 'tier');
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = Math.fround(rowNum(hqRow, 'hp'));
  cols.hpMax[row] = Math.fround(rowNum(hqRow, 'hp'));
  cols.state[row] = ENTITY_STATE.idle;
  cols.progress[row] = 0;
  cols.cell[row] = Math.fround(rowNum(hqRow, 'cellCapacity'));
  cols.cellMax[row] = Math.fround(rowNum(hqRow, 'cellCapacity'));
  cols.workRate[row] = Math.fround(rowNum(hqRow, 'workRate'));
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, opts.owner, opts.q, opts.r, rowNum(hqRow, 'viewRadius'), tick);
  syncHqView(state, row, tick, data);
  return id;
}

/** Power slot (7): HQ cell recharge, after the construction slot's work drew from the cell this step. */
export const hq = defineSystem({
  id: 'hq',
  slot: 7,
  wave: 'W01',
  run(state, ctx) {
    stepHq(state, ctx);
    if (ctx.flags.has('W07')) {
      stepHqCombatSurvival(state, ctx);
    }
  },
});

export default defineSimModule({ id: 'hq', wave: 'W01', systems: [hq] });
