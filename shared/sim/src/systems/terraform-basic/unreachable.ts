import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { cancelMove, getMotion, sameGoal, type MoveGoal } from '../../units/movement/orchestrator';
import { syncHarvesterView } from '../harvest';
import { syncHqView } from '../hq/view';

/**
 * A work job whose worker has no walkable way to within reach (e.g. a tree inside a forest, which a ground worker
 * cannot cross) ends instead of re-planning forever. With `report` the player hears it once as a unit failure
 * (`no_path`): the tile the player ordered. A terraform chain's automatic follow-up is skipped silently (owner
 * decision W02). Returns whether the job was abandoned (the caller drops it).
 */
export function abandonUnreachableJob(state: PlanetState, workerId: number, wRow: number, goal: MoveGoal, ctx: StepContext, report = true): boolean {
  const motion = getMotion(state, workerId);
  if (motion?.status !== 'failed' || !sameGoal(motion.goal, goal)) return false;
  cancelMove(state, workerId, ctx.tick);
  setField(state.entities, wRow, 'state', ENTITY_STATE.idle, ctx.tick);
  if (report) {
    const book = new UnitBook(state);
    book.get(workerId).lastFailure = { code: 'no_path', tick: ctx.tick, kind: 'move', source: 'player' };
    book.touch(); // an in-place edit: stamp the blob so the delta carries the failure
    book.flush(ctx.tick);
  }
  const kind = state.entities.cols.kind[wRow];
  if (kind === ENTITY_KIND.hq) syncHqView(state, wRow, ctx.tick, ctx.data);
  else if (kind === ENTITY_KIND.harvester) syncHarvesterView(state, wRow, ctx.tick, ctx.data);
  return true;
}
