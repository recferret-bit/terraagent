import type { CompiledDataLike } from '../../../kernel/config';
import { parseAgentParams, type AgentParams } from '../agent/params';

/** Tier-1 pairs. A T2/T3 entry is rejected; this wave does not quote them. */
const T1_PAIRS = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const;
const ROSTER = ['kestrel', 'vanguard'] as const;
const MAX_SPREAD_BP = 9999;

/** One Guild NPC as compiled from the `guild` table. */
export interface GuildNpc {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  /** 1 = the route loops the local planet (W11 off). */
  readonly routeLoop: number;
  readonly route: readonly string[];
  readonly pairs: readonly string[];
  readonly targets: Readonly<Record<string, number>>;
}

/**
 * Versioned Guild policy plus the `AgentParams` the W13 quote library already understands.
 * Funding ceilings are carried here and are not enforced (W15-12). Cash stays a stored flag.
 */
export interface GuildPolicy {
  readonly policyVersion: string;
  readonly cashEnabled: number;
  readonly killSwitch: number;
  readonly npcNearFloatCap: number;
  readonly globalNearFloatCap: number;
  readonly dockWindowS: number;
  readonly visitGapS: number;
  readonly inventoryCapUnits: number;
  readonly perOrderExposureAtomic: string;
  readonly globalExposureAtomic: string;
  readonly dailyLossAtomic: string;
  readonly dailySpendAtomic: string;
  readonly minEligibleTrades: number;
  readonly params: AgentParams;
  readonly roster: readonly GuildNpc[];
}

type Table = Record<string, Record<string, unknown>>;
type Row = Record<string, unknown>;

/** `AgentParams` for `quoteColony`. Same library fields as `market.agent`; the numbers come from `guild.policy`. */
export function guildAgentParams(data: CompiledDataLike): AgentParams {
  return guildPolicy(data).params;
}

/** Roster, caps and quote parameters. Throws when W15 is off or a row is not legal. */
export function guildPolicy(data: CompiledDataLike): GuildPolicy {
  const table = guildTable(data);
  const row = table.policy!;
  return { ...readLimits(row), params: agentFromRow(row), roster: readRoster(table) };
}

function guildTable(data: CompiledDataLike): Table {
  const table = data.tables.guild as Table | undefined;
  if (!table?.policy) throw new RangeError('guild.policy row is missing (wave W15 off?)');
  return table;
}

function agentFromRow(row: Row): AgentParams {
  for (const field of ['bidHalfSpreadBp', 'askHalfSpreadBp'] as const) {
    const v = row[field];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_SPREAD_BP) {
      throw new RangeError(`guild.policy.${field} must be an integer in 0..${MAX_SPREAD_BP}`);
    }
  }
  try {
    return parseAgentParams(row);
  } catch (e) {
    if (e instanceof RangeError) throw new RangeError(e.message.replaceAll('market.agent', 'guild.policy'), { cause: e });
    throw e;
  }
}

function readLimits(row: Row): Omit<GuildPolicy, 'params' | 'roster'> {
  const npcNearFloatCap = intField(row, 'policy', 'npcNearFloatCap', 0, 1_000_000);
  const globalNearFloatCap = intField(row, 'policy', 'globalNearFloatCap', 0, 10_000_000);
  if (globalNearFloatCap < npcNearFloatCap) throw new RangeError('guild.policy.globalNearFloatCap must be >= npcNearFloatCap');
  return {
    policyVersion: text(row, 'policy', 'policyVersion'),
    cashEnabled: intField(row, 'policy', 'cashEnabled', 0, 1),
    killSwitch: intField(row, 'policy', 'killSwitch', 0, 1),
    npcNearFloatCap,
    globalNearFloatCap,
    dockWindowS: intField(row, 'policy', 'dockWindowS', 60, 86_400),
    visitGapS: intField(row, 'policy', 'visitGapS', 60, 86_400),
    inventoryCapUnits: intField(row, 'policy', 'inventoryCapUnits', 0, 1_000_000),
    perOrderExposureAtomic: atomic(row, 'policy', 'perOrderExposureAtomic'),
    globalExposureAtomic: atomic(row, 'policy', 'globalExposureAtomic'),
    dailyLossAtomic: atomic(row, 'policy', 'dailyLossAtomic'),
    dailySpendAtomic: atomic(row, 'policy', 'dailySpendAtomic'),
    minEligibleTrades: intField(row, 'policy', 'minEligibleTrades', 1, 1000),
  };
}

function readRoster(table: Table): readonly GuildNpc[] {
  const ids = Object.keys(table).filter((id) => id !== 'policy').sort();
  if (ids.length !== ROSTER.length || ROSTER.some((id, i) => ids[i] !== id)) {
    throw new RangeError('guild roster must be exactly kestrel and vanguard');
  }
  return ROSTER.map((id) => readNpc(table[id]!, id));
}

function readNpc(row: Row, id: string): GuildNpc {
  const slot = intField(row, id, 'accountSlot', 1, 8);
  return {
    id,
    name: text(row, id, 'displayName'),
    accountId: `guild-${slot}.npc.terraagent.mock`,
    routeLoop: intField(row, id, 'routeLoop', 0, 1),
    route: stringList(row, id, 'route'),
    pairs: pairsOf(row, id),
    targets: {
      'metals.t1': intField(row, id, 'targetMetalsT1', 0, 1_000_000),
      'minerals.t1': intField(row, id, 'targetMineralsT1', 0, 1_000_000),
      'bio.water': intField(row, id, 'targetWater', 0, 1_000_000),
      'bio.biomass': intField(row, id, 'targetBiomass', 0, 1_000_000),
    },
  };
}

function pairsOf(row: Row, id: string): readonly string[] {
  const list = stringList(row, id, 'pairs');
  if (list.length !== T1_PAIRS.length || T1_PAIRS.some((p, i) => list[i] !== p)) {
    throw new RangeError(`guild.${id}.pairs must be ${T1_PAIRS.join(', ')}`);
  }
  return T1_PAIRS;
}

function stringList(row: Row, id: string, field: string): readonly string[] {
  const v = row[field];
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || x.length === 0)) {
    throw new RangeError(`guild.${id}.${field} must be a non-empty list of strings`);
  }
  return v as readonly string[];
}

function intField(row: Row, id: string, field: string, min: number, max: number): number {
  const v = row[field];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new RangeError(`guild.${id}.${field} must be an integer in ${min}..${max}`);
  }
  return v;
}

function text(row: Row, id: string, field: string): string {
  const v = row[field];
  if (typeof v !== 'string' || v.length === 0) throw new RangeError(`guild.${id}.${field} must be a non-empty string`);
  return v;
}

function atomic(row: Row, id: string, field: string): string {
  const v = row[field];
  if (typeof v !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(v) || BigInt(v) <= 0n) {
    throw new RangeError(`guild.${id}.${field} must be a positive decimal string`);
  }
  return v;
}
