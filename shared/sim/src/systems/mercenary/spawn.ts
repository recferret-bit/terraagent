import { ENTITY_KIND } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { setUnitStance } from '../combat/stances';
import { commandColony, parseArgs } from '../command';
import { colonyWho } from '../find';
import { MERCENARY_FACTION, MERCENARY_OWNER, readMercenary, writeMercenary, type MercenaryContract } from './blob';
import { hubEdgeTiles } from './tiles';

const MODULE_SOURCES: ReadonlySet<string> = new Set(['system', 'near', 'admin', 'dev']);

export const mercenarySpawnHandler = defineCommandHandler({
  kind: 'mercenary.spawn',
  wave: 'W22',
  handle: spawnSquad,
});

function spawnSquad(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  if (!MODULE_SOURCES.has(cmd.source)) return 'not_authorized';
  const colony = commandColony(cmd);
  if (colony === 'not_own_colony') return colony;
  const args = parseArgs('mercenary.spawn', cmd.args);
  if (!args || args.endTick <= ctx.tick) return 'invalid_args';
  const rosterId = rosterFor(ctx.data, args.count, args.rosterId);
  if (!rosterId) return 'invalid_args';
  const id = args.bountyId ?? `merc:${colony}:${ctx.tick}`;
  const blob = readMercenary(state);
  if (blob.contracts.some((contract) => contract.id === id && !contract.left)) return 'already_posted';
  const tiles = hubEdgeTiles(state, colony, args.count);
  if (!tiles) return 'unknown_entity';
  if (tiles.length < args.count) return 'invalid_args';
  const hp = reconHp(ctx.data);
  if (hp <= 0) return 'invalid_args';
  const contract = placeContract(state, ctx, {
    id,
    poster: colony,
    rosterId,
    faction: MERCENARY_FACTION,
    q: args.q,
    r: args.r,
    radius: args.radius,
    endTick: args.endTick,
    entityIds: [],
  }, tiles, hp);
  blob.contracts.push(contract);
  writeMercenary(state, blob, ctx.tick);
  const arrived = tiles[0]!;
  ctx.emit({
    kind: 'mercenaryArrived',
    colonyIds: [colonyWho(state, colony).colonyIdStr],
    data: { bountyId: id, rosterId, q: arrived.q, r: arrived.r },
  });
}

function placeContract(
  state: PlanetState,
  ctx: StepContext,
  contract: MercenaryContract,
  tiles: readonly { q: number; r: number }[],
  hp: number,
): MercenaryContract {
  const entityIds = tiles.map((tile) => placeRecon(state, ctx, tile.q, tile.r, hp));
  for (const entityId of entityIds) setUnitStance(state, entityId, 'defend', { q: contract.q, r: contract.r }, ctx.tick);
  return { ...contract, entityIds };
}

function placeRecon(state: PlanetState, ctx: StepContext, q: number, r: number, hp: number): number {
  const id = ctx.newEntityId();
  const row = insertRow(state.entities, id, ctx.tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.recon;
  cols.owner[row] = MERCENARY_OWNER;
  cols.tier[row] = 1;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  placeSpawnedEntity(state.entities, row, q, r, ctx.tick);
  return id;
}

function rosterFor(data: CompiledDataLike, count: number, requested?: string): string | null {
  const table = data.tables.mercenary as Record<string, { count?: number; archetype?: string }> | undefined;
  if (!table) return null;
  const matches = (id: string) => {
    const row = table[id];
    return !!row && Number(row.count) === count && row.archetype === 'robot.recon';
  };
  if (requested) return matches(requested) ? requested : null;
  return Object.keys(table).filter(matches).sort()[0] ?? null;
}

function reconHp(data: CompiledDataLike): number {
  const table = data.tables.combatUnits as Record<string, { hp?: number }> | undefined;
  const hp = Number(table?.recon?.hp);
  return Number.isFinite(hp) && hp > 0 ? Math.fround(hp) : 0;
}
