import { T1_RESOURCE_KEYS, type T1ResourceKey } from '@terra/contracts';
import { intArg, parseLine } from '../../dev/console/parse';

export const GUILD_NPC_IDS = ['kestrel', 'vanguard'] as const;
export type GuildNpcId = (typeof GUILD_NPC_IDS)[number];

export type GuildDevParsed =
  | { readonly name: 'guild.summon'; readonly npc: GuildNpcId }
  | { readonly name: 'guild.depart'; readonly npc: GuildNpcId }
  | { readonly name: 'guild.disable'; readonly npc: GuildNpcId }
  | { readonly name: 'guild.setInventory'; readonly npc: GuildNpcId; readonly resource: T1ResourceKey; readonly amount: number }
  | { readonly name: 'away.simulate'; readonly on: boolean }
  | { readonly name: 'director.allowance'; readonly amount: number; readonly resource: T1ResourceKey };

const T1 = new Set<string>(T1_RESOURCE_KEYS);

/** Parse one console line (`guild.summon kestrel`). The runner passes the same words to {@link parseGuildDev}. */
export function parseGuildDevLine(line: string): GuildDevParsed {
  const [name, ...args] = parseLine(line);
  if (!name) throw new Error('missing command');
  return parseGuildDev(name, args);
}

/** Words after the command name. Unknown NPCs, `maybe`, and a negative amount throw. */
export function parseGuildDev(name: string, args: readonly string[]): GuildDevParsed {
  switch (name) {
    case 'guild.summon':
    case 'guild.depart':
    case 'guild.disable':
      return { name, npc: oneNpc(name, args) };
    case 'guild.setInventory':
      return stock(args);
    case 'away.simulate':
      return { name, on: awayFlag(args) };
    case 'director.allowance':
      return allowance(args);
    default:
      throw new Error(`unknown command "${name}"`);
  }
}

function oneNpc(name: string, args: readonly string[]): GuildNpcId {
  if (args.length === 0) throw new Error('missing <npc>');
  if (args.length !== 1) throw new Error(`usage: ${name} <npc>`);
  return npcOf(args[0]!);
}

function stock(args: readonly string[]): GuildDevParsed {
  if (args.length < 3) throw new Error(args.length < 2 ? 'missing <resource>' : 'missing <amount>');
  if (args.length !== 3) throw new Error('usage: guild.setInventory <npc> <res> <amt>');
  return { name: 'guild.setInventory', npc: npcOf(args[0]!), resource: resourceOf(args[1]!), amount: wholeAmount(args, 2) };
}

function awayFlag(args: readonly string[]): boolean {
  if (args.length !== 1) throw new Error('usage: away.simulate on|off');
  const flag = args[0]!.toLowerCase();
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  throw new Error('away.simulate expects on|off');
}

function allowance(args: readonly string[]): GuildDevParsed {
  if (args.length === 1) return { name: 'director.allowance', resource: 'metals.t1', amount: wholeAmount(args, 0) };
  if (args.length === 2) return { name: 'director.allowance', resource: resourceOf(args[0]!), amount: wholeAmount(args, 1) };
  throw new Error(args.length === 0 ? 'missing <amount>' : 'usage: director.allowance [resource] <amt>');
}

function npcOf(raw: string): GuildNpcId {
  if (raw === 'kestrel' || raw === 'vanguard') return raw;
  throw new Error(`unknown npc "${raw}"`);
}

function resourceOf(raw: string): T1ResourceKey {
  if (T1.has(raw)) return raw as T1ResourceKey;
  throw new Error(`unknown resource "${raw}"`);
}

function wholeAmount(args: readonly string[], index: number): number {
  const amount = intArg(args, index, 'amount');
  if (amount < 0) throw new Error('<amount> must be 0 or more');
  return amount;
}
