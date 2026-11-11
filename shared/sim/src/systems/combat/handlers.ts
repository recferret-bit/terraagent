import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { mobileStats } from '../../units/mobility';
import { commandColony, parseArgs } from '../command';
import { hasActiveTruce, recordHostilityBetween } from '../diplomacy/store';
import { orderRaidGroupFlowMarch } from '../pvp/raidFlowMarch';
import { canAttackMoveToTileSector, canRaidTargetSector } from '../pvp/sectorGuard';
import { dropColonyShield, isColonyRaidProtected } from '../pvp/shield';
import { setFactoryRallyPoint } from '../factories-hub/robotics';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import { canWeaponHitTarget } from './layers';
import { orderUnitAttackMove, orderUnitAttackTarget, setUnitStance } from './stances';
import { resolveAttackerWeaponRow } from './targeting';

function ownEntityRow(state: PlanetState, cmd: SimCommand, id: number): number | string {
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

function extractEntityIds(args: { entityId?: number; entityIds?: number[]; unitId?: number; unitIds?: number[] }): number[] {
  if (Array.isArray(args.entityIds) && args.entityIds.length > 0) {
    return args.entityIds;
  }
  if (Array.isArray(args.unitIds) && args.unitIds.length > 0) {
    return args.unitIds;
  }
  if (typeof args.entityId === 'number') {
    return [args.entityId];
  }
  if (typeof args.unitId === 'number') {
    return [args.unitId];
  }
  return [];
}

function normalizeCombatArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  let next: Record<string, unknown> = { ...obj };
  if ('to' in next && next.to && typeof next.to === 'object') {
    const { to, ...rest } = next;
    next = { ...rest, ...(to as Record<string, unknown>) };
  }
  if ('unitIds' in next) {
    const { unitIds, ...rest } = next;
    next = { ...rest, entityIds: rest.entityIds ?? unitIds };
  }
  if ('unitId' in next) {
    const { unitId, ...rest } = next;
    next = { ...rest, entityId: rest.entityId ?? unitId };
  }
  return next;
}

export const setStanceHandler = defineCommandHandler({
  kind: 'setStance',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = parseArgs('setStance', normalizeCombatArgs(cmd.args));
    if (!args) return 'invalid_args';
    const ids = extractEntityIds(args);
    if (ids.length === 0) return 'invalid_args';

    const cols = state.entities.cols;
    for (const id of ids) {
      const row = ownEntityRow(state, cmd, id);
      if (typeof row === 'string') return row;
      if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) return 'invalid_args';
    }

    for (const id of ids) {
      setUnitStance(state, id, args.stance, undefined, ctx.tick);
    }
    return undefined;
  },
});

export const setRallyHandler = defineCommandHandler({
  kind: 'setRally',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = parseArgs('setRally', normalizeCombatArgs(cmd.args));
    if (!args) return 'invalid_args';

    const tileIdx = hexIndex(state.grid.radius).indexOf(args.q, args.r);
    if (tileIdx < 0) return 'invalid_args';

    const cols = state.entities.cols;
    const producerId = args.producerId ?? args.entityId;
    let colonyIndex = 0;

    if (cmd.colonyIndex !== undefined) {
      const colony = commandColony(cmd);
      if (typeof colony === 'string') return colony;
      colonyIndex = colony;
    }

    if (producerId !== undefined) {
      const pRow = ownEntityRow(state, cmd, producerId);
      if (typeof pRow === 'string') return pRow;
      if (cols.hp[pRow]! <= 0 || cols.state[pRow] === ENTITY_STATE.inert) return 'invalid_args';
      if (cmd.colonyIndex === undefined && cols.owner[pRow]! >= 0) {
        colonyIndex = cols.owner[pRow]!;
      }
    }

    setFactoryRallyPoint(state, colonyIndex, args.q, args.r, producerId, ctx.tick);
    return undefined;
  },
});

function checkW18AttackMoveTargetTile(
  state: PlanetState,
  attackerOwner: number,
  tileOwner: number,
  q: number,
  r: number,
  tick: number,
  data: Parameters<typeof isColonyRaidProtected>[3],
): 'cross_sector_disabled' | 'truce_active' | 'raid_protected' | null {
  if (!canAttackMoveToTileSector(state, attackerOwner, q, r).ok) {
    return 'cross_sector_disabled';
  }
  if (tileOwner >= 0 && tileOwner !== attackerOwner && hasActiveTruce(state, attackerOwner, tileOwner, tick)) {
    return 'truce_active';
  }
  if (tileOwner >= 0 && tileOwner !== attackerOwner && isColonyRaidProtected(state, tileOwner, tick, data)) {
    return 'raid_protected';
  }
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) continue;
    if (cols.q[row] !== q || cols.r[row] !== r) continue;
    const entOwner = cols.owner[row]!;
    if (entOwner < 0 || entOwner === attackerOwner) continue;
    if (hasActiveTruce(state, attackerOwner, entOwner, tick)) return 'truce_active';
    if (isColonyRaidProtected(state, entOwner, tick, data)) return 'raid_protected';
  }
  return null;
}

function recordW18AttackMoveHostility(
  state: PlanetState,
  attackerOwner: number,
  tileOwner: number,
  q: number,
  r: number,
  tick: number,
  data: Parameters<typeof dropColonyShield>[3],
): void {
  const cols = state.entities.cols;
  let foreignOwner = tileOwner >= 0 && tileOwner !== attackerOwner ? tileOwner : -1;
  if (foreignOwner < 0) {
    for (let row = 0; row < state.entities.count; row++) {
      if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) continue;
      if (cols.q[row] === q && cols.r[row] === r && cols.owner[row]! >= 0 && cols.owner[row]! !== attackerOwner) {
        foreignOwner = cols.owner[row]!;
        break;
      }
    }
  }
  if (foreignOwner >= 0) {
    dropColonyShield(state, attackerOwner, tick, data);
    recordHostilityBetween(state, attackerOwner, foreignOwner, tick);
  }
}

export const attackMoveHandler = defineCommandHandler({
  kind: 'attackMove',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = parseArgs('attackMove', normalizeCombatArgs(cmd.args));
    if (!args) return 'invalid_args';

    const tileIdx = hexIndex(state.grid.radius).indexOf(args.q, args.r);
    if (tileIdx < 0) return 'invalid_args';

    const ids = extractEntityIds(args);
    if (ids.length === 0) return 'invalid_args';

    const cols = state.entities.cols;
    const tileOwner = state.grid.layers.owner?.[tileIdx] ?? -1;
    for (const id of ids) {
      const row = ownEntityRow(state, cmd, id);
      if (typeof row === 'string') return row;
      if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) return 'invalid_args';
      const isMobile = mobileStats(cols.kind[row]!, ctx.data) !== null;
      const hasWeapon = resolveAttackerWeaponRow(state, row, ctx.data) !== undefined;
      if (!isMobile && !hasWeapon) return 'invalid_args';
      const attackerOwner = cols.owner[row]!;
      if (ctx.flags.has('W18') && attackerOwner >= 0) {
        const w18Block = checkW18AttackMoveTargetTile(state, attackerOwner, tileOwner, args.q, args.r, ctx.tick, ctx.data);
        if (w18Block) return w18Block;
      }
    }

    for (const id of ids) {
      const row = rowOf(state.entities, id);
      if (ctx.flags.has('W18') && row >= 0 && cols.owner[row]! >= 0) {
        recordW18AttackMoveHostility(state, cols.owner[row]!, tileOwner, args.q, args.r, ctx.tick, ctx.data);
      }
    }
    if (ctx.flags.has('W18') && ids.length >= 2) {
      orderRaidGroupFlowMarch(state, ids, { q: args.q, r: args.r }, ctx, 'own');
    } else {
      for (const id of ids) {
        cancelWorkerJobs(state, id, ctx.tick);
        orderUnitAttackMove(state, id, { q: args.q, r: args.r }, ctx);
      }
    }
    return undefined;
  },
});

export const attackTargetHandler = defineCommandHandler({
  kind: 'attackTarget',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = parseArgs('attackTarget', normalizeCombatArgs(cmd.args));
    if (!args) return 'invalid_args';

    const cols = state.entities.cols;
    const tRow = rowOf(state.entities, args.targetId);
    if (tRow < 0) return 'unknown_entity';
    if (
      cols.hp[tRow]! <= 0 ||
      cols.state[tRow] === ENTITY_STATE.inert ||
      cols.state[tRow] === ENTITY_STATE.descending
    ) {
      return 'invalid_args';
    }

    const ids = extractEntityIds(args);
    if (ids.length === 0) return 'invalid_args';

    for (const id of ids) {
      const row = ownEntityRow(state, cmd, id);
      if (typeof row === 'string') return row;
      if (row === tRow || cols.owner[row] === cols.owner[tRow]) return 'invalid_args';
      if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) return 'invalid_args';
      if (
        ctx.flags.has('W18') &&
        cols.owner[row]! >= 0 &&
        cols.owner[tRow]! >= 0
      ) {
        if (!canRaidTargetSector(state, cols.owner[row]!, cols.owner[tRow]!).ok) {
          return 'cross_sector_disabled';
        }
        if (hasActiveTruce(state, cols.owner[row]!, cols.owner[tRow]!, ctx.tick)) {
          return 'truce_active';
        }
      }
      const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
      if (!weaponRow || !canWeaponHitTarget(state, weaponRow, tRow, ctx.data)) {
        return 'invalid_args';
      }
    }

    for (const id of ids) {
      const row = rowOf(state.entities, id);
      if (ctx.flags.has('W18') && row >= 0 && cols.owner[row]! >= 0 && cols.owner[tRow]! >= 0) {
        recordHostilityBetween(state, cols.owner[row]!, cols.owner[tRow]!, ctx.tick);
      }
      cancelWorkerJobs(state, id, ctx.tick);
      orderUnitAttackTarget(state, id, args.targetId, ctx);
    }
    return undefined;
  },
});
