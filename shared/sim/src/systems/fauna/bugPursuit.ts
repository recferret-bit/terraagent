import { combatApproachBand, footprintAttackRange } from '../combat/approachBand';
import { ENTITY_STATE } from '../../ecs/columns';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { isGroundPassable } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getUnitCommand, UnitBook } from '../../units/book';
import { isUnitKind } from '../../units/mobility';
import { faceTowards } from '../../units/movement/locomotion';
import { getMotion } from '../../units/movement/orchestrator';
import { isHexStationaryOccupied } from '../../units/movement/unitOccupancy';
import { issueUnitCommand } from '../units/registry';

export function pursueAggressiveBugTarget(
  state: PlanetState,
  bugRow: number,
  bugEntityId: number,
  targetRow: number,
  bugRange: number,
  claimedGoals: ReadonlySet<number>,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const dist = hexDistance(cols.x[bugRow]!, cols.y[bugRow]!, cols.x[targetRow]!, cols.y[targetRow]!);
  const tq = cols.q[targetRow]!;
  const tr = cols.r[targetRow]!;
  const attackRange = footprintAttackRange(bugRange, cols.footprintW[targetRow]);
  const minBand = isUnitKind(cols.kind[targetRow]!) ? 1 : 0;
  const band = combatApproachBand(
    attackRange,
    minBand,
    hexDistance(cols.q[bugRow]!, cols.r[bugRow]!, tq, tr),
    hexDistance(cols.x[targetRow]!, cols.y[targetRow]!, tq, tr),
  );
  const hx = hexIndex(state.grid.radius);
  const curIdx = hx.indexOf(cols.q[bugRow]!, cols.r[bugRow]!);
  const prevMotion = getMotion(state, bugEntityId);
  const wasStationary = !prevMotion || prevMotion.status !== 'following';
  const sharedStand = isHexStationaryOccupied(state, curIdx, bugEntityId, ctx.data, wasStationary);
  const ring1Open =
    attackRange > 1.5 ||
    HEX_DIRS.some(([dq, dr]) => {
      const ti = hx.indexOf(tq + dq, tr + dr);
      return ti >= 0 && !claimedGoals.has(ti) && isGroundPassable(state.grid, ti, ctx.data);
    });
  const waitingInSecondRank = !sharedStand && !ring1Open && dist <= attackRange + 1.25;

  if ((dist > attackRange + 1e-4 && !waitingInSecondRank) || sharedStand) {
    const uRec = new UnitBook(state).peek(bugEntityId);
    if (!sharedStand && uRec?.lastFailure?.kind === 'move' && ctx.tick - uRec.lastFailure.tick < 12) {
      return;
    }
    const curCmd = uRec?.current ?? null;
    const driftAllowance = dist > 3 ? 2 : 1;
    if (
      curCmd?.kind !== 'move' ||
      cols.state[bugRow] !== ENTITY_STATE.moving ||
      hexDistance(curCmd.q, curCmd.r, tq, tr) > driftAllowance ||
      (curCmd.minDist ?? 0) !== band.minDist ||
      (curCmd.maxDist ?? 0) !== band.maxDist
    ) {
      issueUnitCommand(
        state,
        bugRow,
        { kind: 'move', source: 'auto', q: tq, r: tr, minDist: band.minDist, maxDist: band.maxDist },
        ctx,
      );
    }
    return;
  }

  const curCmd = getUnitCommand(state, bugEntityId);
  if (curCmd?.kind === 'move') {
    issueUnitCommand(state, bugRow, { kind: 'stop', source: 'auto' }, ctx);
  }
  faceTowards(state, bugRow, tq, tr, ctx.tick);
}
