import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { mobileStats } from '../../units/mobility';
import { commandColony, parseArgs } from '../command';
import { occupiedGroundTiles } from '../construction/occupancy';
import { assignWorkerDepositTarget, hasAnyPassableNeighbor, isWorker } from '../harvest';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import { issueUnitCommand } from './registry';

/**
 * Player input for units. Each handler checks the game rules it can check right away (ownership, bounds, the target
 * tile itself) and then issues a unit command; reachability is decided by the movement orchestrator, so a target that
 * turns out to be walled in ends the command (`lastFailure: 'no_path'`) without moving the unit.
 */

/** Resolves the commanded unit's row (the caller's own unit), or a reject code. */
function ownUnitRow(state: PlanetState, cmd: SimCommand, id: number): number | string {
  const row = rowOf(state.entities, id);
  if (cmd.colonyIndex === undefined) {
    return row < 0 ? 'unknown_entity' : row;
  }
  const colony = commandColony(cmd);
  if (typeof colony === 'string') return colony;
  if (row < 0) return 'unknown_entity';
  if (state.entities.cols.owner[row] !== colony) return 'not_own_colony';
  return row;
}

export const moveUnit = defineCommandHandler({
  kind: 'moveUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const raw = cmd.args && typeof cmd.args === 'object' && 'to' in cmd.args && cmd.args.to && typeof cmd.args.to === 'object'
      ? { entityId: (cmd.args as { entityId?: unknown }).entityId, ...(cmd.args.to as Record<string, unknown>) }
      : cmd.args;
    const args = parseArgs('moveUnit', raw);
    if (!args) return 'invalid_args';
    const { q, r } = args;
    const row = ownUnitRow(state, cmd, args.entityId);
    if (typeof row === 'string') return row;
    const stats = mobileStats(state.entities.cols.kind[row], ctx.data);
    if (!stats || state.entities.cols.hp[row] <= 0) return 'invalid_args';

    const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
    if (tileIdx < 0) return 'invalid_args';
    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    const deposit = state.grid.layers.deposit[tileIdx];
    if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) return 'site_blocked';
    const occupied = deposit !== DEPOSIT.none ? occupiedGroundTiles(state, ctx.data) : null; // footprints, not `anchors` (territory)
    if (occupied && !occupied.has(tileIdx)) {
      const kind = state.entities.cols.kind[row];
      if (!hasAnyPassableNeighbor(state, q, r, occupied)) return 'site_blocked';
      cancelWorkerJobs(state, args.entityId, ctx.tick); // a player order ends the unit's work jobs (and terraform chain)
      if (isWorker(kind)) {
        const res = assignWorkerDepositTarget(state, args.entityId, q, r, ctx.tick, ctx);
        return res.ok ? undefined : res.code;
      }
      if (kind === ENTITY_KIND.hq && ctx.flags.has('W02')) {
        return issueUnitCommand(state, row, { kind: 'move', source: 'player', q, r, minDist: 1, maxDist: 1 }, ctx);
      }
    }
    const blockers = pathBlockersFor(state, stats.profile, -1, ctx.data);
    if (blockers?.goalBlocked(tileIdx)) return 'site_blocked'; // uncleared forest / rock / building footprint
    cancelWorkerJobs(state, args.entityId, ctx.tick);
    return issueUnitCommand(state, row, { kind: 'move', source: 'player', q, r }, ctx);
  },
});

export const stopUnit = defineCommandHandler({
  kind: 'stopUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = parseArgs('stopUnit', cmd.args);
    if (!args) return 'invalid_args';
    const row = ownUnitRow(state, cmd, args.entityId);
    if (typeof row === 'string') return row;
    cancelWorkerJobs(state, args.entityId, ctx.tick);
    return issueUnitCommand(state, row, { kind: 'stop', source: 'player' }, ctx);
  },
});
