import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { cancelMove, getMotion, sameGoal, type MoveGoal } from '../../units/movement/orchestrator';
import { syncWorkerView as syncWorkerUnitView } from '../harvest';
import { syncHqView } from '../hq/view';

/**
 * A work job whose worker has no walkable way to within reach (e.g. a tree inside a forest, which a ground worker
 * cannot cross) ends instead of re-planning forever. With `report` the player hears it at once as a unit failure
 * (`no_path`, {@link reportNoPath}). A terraform chain job never reports here: the chain goes on from the edge inward
 * (`chain.ts` E2) and the work-jobs system reports only when the chain ends on the player's own tile (E3). Returns
 * whether the job was abandoned (the caller drops it).
 */
export function abandonUnreachableJob(state: PlanetState, workerId: number, wRow: number, goal: MoveGoal, ctx: StepContext, report = true): boolean {
  const motion = getMotion(state, workerId);
  if (motion?.status !== 'failed' || !sameGoal(motion.goal, goal)) return false;
  cancelMove(state, workerId, ctx.tick);
  setField(state.entities, wRow, 'state', ENTITY_STATE.idle, ctx.tick);
  if (report) reportNoPath(state, workerId, ctx.tick);
  const kind = state.entities.cols.kind[wRow];
  if (kind === ENTITY_KIND.hq) syncHqView(state, wRow, ctx.tick, ctx.data);
  else if (kind === ENTITY_KIND.worker) syncWorkerUnitView(state, wRow, ctx.tick, ctx.data);
  return true;
}

/** Records the player's order to `workerId` as failed with `no_path` (the unit's `lastFailure`, carried by the delta). */
export function reportNoPath(state: PlanetState, workerId: number, tick: number): void {
  const book = new UnitBook(state);
  book.get(workerId).lastFailure = { code: 'no_path', tick, kind: 'move', source: 'player' };
  book.touch(); // an in-place edit: stamp the blob so the delta carries the failure
  book.flush(tick);
}
