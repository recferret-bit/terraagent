import { Injectable } from '@nestjs/common';
import { compileData, guildPolicy, hashString, type GuildNpc } from '@terra/sim';
import {
  GuildStrategyError,
  GuildStrategyPort,
  parseGuildStrategy,
  type GuildStrategyChoice,
  type GuildStrategyClock,
  type GuildStrategyNpc,
  type GuildStockpileGoal,
} from './port.js';

const SPECIALISATION = 'balanced';
const RISK = 'conservative';

let roster: readonly GuildNpc[] | undefined;

/**
 * Default guild strategy (W15-13). The route token is seeded from the NPC id.
 * Stockpile goals are that NPC's targets on the `guild` table, not a second number table.
 * The clock does not change the result.
 */
@Injectable()
export class DeterministicGuildStrategy extends GuildStrategyPort {
  async choose(npc: GuildStrategyNpc, _clock: GuildStrategyClock): Promise<GuildStrategyChoice> {
    return choiceFor(npc.id);
  }
}

/** One stop from the NPC's data route. The same id and list always return the same token. */
export function guildRouteToken(npcId: string, route: readonly string[]): string {
  const token = route[hashString(npcId) % route.length];
  if (token === undefined) throw new GuildStrategyError('bad_strategy', 'Guild route is empty');
  return token;
}

function choiceFor(id: string): GuildStrategyChoice {
  const npc = guildRoster().find((row) => row.id === id);
  if (!npc) throw new GuildStrategyError('unknown_npc', `No guild NPC ${id}`);
  const parsed = parseGuildStrategy({
    route: guildRouteToken(id, npc.route),
    stockpile: stockpileOf(npc),
    specialisation: SPECIALISATION,
    risk: RISK,
  });
  if (!parsed.ok) throw new GuildStrategyError(parsed.code, `Guild data strategy rejected: ${parsed.code}`);
  return parsed.value;
}

function stockpileOf(npc: GuildNpc): GuildStockpileGoal[] {
  return npc.pairs.map((resource) => ({ resource, target: targetOf(npc, resource) }));
}

function targetOf(npc: GuildNpc, resource: string): number {
  const target = npc.targets[resource];
  if (typeof target !== 'number')
    throw new GuildStrategyError('bad_strategy', `No guild target for ${npc.id} ${resource}`);
  return target;
}

function guildRoster(): readonly GuildNpc[] {
  roster ??= guildPolicy(compileData(new Set(['W15']))).roster;
  return roster;
}
