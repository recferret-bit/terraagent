import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { pathBlockedFor } from '../../grid/pathProfiles';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { mobileStats } from '../../units/mobility';
import { commandColony, parseArgs } from '../command';
import { issueUnitCommand } from './registry';

/**
 * Player input for units. Each handler checks the game rules it can check right away (ownership, bounds, the target
 * tile itself) and then issues a unit command; reachability is decided by the movement orchestrator, so a target that
 * turns out to be walled in ends the command (`lastFailure: 'no_path'`) without moving the unit.
 */

/** Resolves the commanded unit's row (the caller's own unit), or a reject code. */
function ownUnitRow(state: PlanetState, cmd: SimCommand, id: number): number | string {
  const colony = commandColony(cmd);
  if (typeof colony === 'string') return colony;
  const row = rowOf(state.entities, id);
  if (row < 0) return 'unknown_entity';
  if (state.entities.cols.owner[row] !== colony) return 'not_own_colony';
  return row;
}

export const moveUnit = defineCommandHandler({
  kind: 'moveUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = parseArgs('moveUnit', cmd.args);
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
    if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) return 'site_blocked';
    if (pathBlockedFor(state, stats.profile, -1, ctx.data)?.(tileIdx)) return 'site_blocked'; // uncleared forest / rock: terraform it first
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
    return issueUnitCommand(state, row, { kind: 'stop', source: 'player' }, ctx);
  },
});
