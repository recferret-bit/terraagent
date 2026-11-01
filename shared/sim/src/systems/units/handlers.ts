import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { pathBlockedFor } from '../../grid/pathProfiles';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { mobileStats } from '../../units/mobility';
import { issueUnitCommand } from './registry';

/**
 * Player input for units. Each handler checks the game rules it can check right away (ownership, bounds, the target
 * tile itself) and then issues a unit command; reachability is decided by the movement orchestrator, so a target that
 * turns out to be walled in ends the command (`lastFailure: 'no_path'`) without moving the unit.
 */

interface UnitArgs {
  entityId?: number;
  unitId?: number;
}

/** Resolves the commanded unit's row, or a reject code. */
function ownUnitRow(state: PlanetState, cmd: SimCommand, rawId: unknown): number | string {
  if (typeof rawId !== 'number') return 'invalid_args';
  if (!Number.isInteger(rawId) || rawId <= 0) return 'invalid_args';
  const row = rowOf(state.entities, rawId);
  if (row < 0) return 'unknown_entity';
  const cols = state.entities.cols;
  if (cmd.colonyIndex !== null && cmd.colonyIndex !== undefined && cols.owner[row] !== cmd.colonyIndex) return 'not_own_colony';
  return row;
}

interface MoveUnitArgs extends UnitArgs {
  q?: number;
  r?: number;
  to?: { q: number; r: number };
}

export const moveUnit = defineCommandHandler({
  kind: 'moveUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as MoveUnitArgs;
    const q = args.to ? args.to.q : args.q;
    const r = args.to ? args.to.r : args.r;
    if (typeof q !== 'number' || typeof r !== 'number' || !Number.isInteger(q) || !Number.isInteger(r)) return 'invalid_args';
    const row = ownUnitRow(state, cmd, args.entityId ?? args.unitId);
    if (typeof row === 'string') return row;
    const stats = mobileStats(state.entities.cols.kind[row], ctx.data);
    if (!stats || state.entities.cols.hp[row] <= 0) return 'invalid_args';

    const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
    if (tileIdx < 0) return 'invalid_args';
    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) return 'site_blocked';
    if (pathBlockedFor(state, stats.profile)?.(tileIdx)) return 'site_blocked'; // uncleared forest / rock: terraform it first
    return issueUnitCommand(state, row, { kind: 'move', source: 'player', q, r }, ctx);
  },
});

export const stopUnit = defineCommandHandler({
  kind: 'stopUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as UnitArgs;
    const row = ownUnitRow(state, cmd, args.entityId ?? args.unitId);
    if (typeof row === 'string') return row;
    return issueUnitCommand(state, row, { kind: 'stop', source: 'player' }, ctx);
  },
});
