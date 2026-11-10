import { pairId, ResourceKey } from '@terra/contracts';
import { compileData, guildPolicy, type GuildNpc as RosterNpc, type GuildPolicy } from '@terra/sim';
import { GuildProvisionError } from './guild-error.js';
import { barterPairIds } from './maker/pairs.js';

export type { RosterNpc, GuildPolicy };

/** Parent of `guild-N.npc.terraagent.mock` (mock chain; the real parent is `npc.terraagent.near`). */
export const GUILD_PARENT = 'npc.terraagent.mock';
/** Function-call gas stored on the key. Not principal and not the quote budget. */
export const GUILD_GAS_ALLOWANCE = '300000000000000';
export const GUILD_KEY_RECEIVER = 'intents.near';
export const GUILD_KEY_METHODS = ['execute_intents'] as const;
export const FIXTURE_LABEL = 'fixture' as const;
export const SUBSIDY_LABEL = 'subsidy' as const;
export const YOCTO_PER_NEAR = 10n ** 24n;
/** Planet ids are runtime (W15-09). The key is bound to the route token until a visit names a planet. */
export const SERVICE_PLANET = 'loop-local';

export interface CargoLine {
  readonly resource: string;
  readonly amount: number;
  readonly label: typeof FIXTURE_LABEL;
  readonly organic: false;
  readonly source: 'mock-grant';
}

export interface InventoryCache {
  readonly label: typeof FIXTURE_LABEL;
  readonly organic: false;
  readonly lines: readonly CargoLine[];
}

export interface StrategyDoc {
  readonly actorKind: 'npc';
  readonly policyVersion: string;
  readonly cashEnabled: 0;
  readonly quoteLabel: typeof SUBSIDY_LABEL;
}

export interface HomeRouteDoc {
  readonly routeLoop: number;
  readonly route: readonly string[];
}

/** One provisioned NPC. Counters are the stored values; a second boot returns this object unchanged. */
export interface GuildAllocation {
  readonly npcId: string;
  readonly accountId: string;
  readonly allocationId: string;
  readonly quoteBudgetAtomic: string;
  readonly spendAtomic: string;
  readonly lossAtomic: string;
  readonly tradeKeyId: string;
  readonly publicKey: string;
  readonly cargoLabel: typeof FIXTURE_LABEL;
  readonly quoteLabel: typeof SUBSIDY_LABEL;
  readonly cashEnabled: 0;
  readonly actorKind: 'npc';
  readonly inventory: InventoryCache;
  readonly policyVersion: string;
}

export interface GuildDraft {
  readonly npc: RosterNpc;
  readonly policyVersion: string;
  readonly quoteBudgetAtomic: string;
  readonly publicKey: string;
  readonly tradeKeyId: string;
  readonly strategy: StrategyDoc;
  readonly inventory: InventoryCache;
  readonly homeRoute: HomeRouteDoc;
}

/** `guild-alloc:{policyVersion}:{npcId}` — one id per NPC, stable across boots. */
export function allocationId(policyVersion: string, npcId: string): string {
  return `guild-alloc:${policyVersion}:${npcId}`;
}

export function publicKeyOf(npcId: string): string {
  return `ed25519:guild-${npcId}`;
}

export function ownerIdOf(npcId: string): string {
  return `guild:${npcId}`;
}

export function opId(npcId: string, step: 'sub' | 'key'): string {
  return `guild:${npcId}:${step}`;
}

export function lockKey(npcId: string): string {
  return `guild-npc:${npcId}`;
}

export function loadPolicy(has: (wave: string) => boolean): GuildPolicy {
  return guildPolicy(compileData({ has }));
}

/** Per-NPC NEAR float (yocto), clamped by the remaining global float. Never above either cap. */
export function quoteAtomic(policy: GuildPolicy, allocated: bigint): bigint {
  const perNpc = BigInt(policy.npcNearFloatCap) * YOCTO_PER_NEAR;
  const global = BigInt(policy.globalNearFloatCap) * YOCTO_PER_NEAR;
  const room = global > allocated ? global - allocated : 0n;
  return perNpc < room ? perNpc : room;
}

export function emptyInventory(): InventoryCache {
  return { label: FIXTURE_LABEL, organic: false, lines: [] };
}

/** Amount 0 leaves the cache as it is, so a zero grant does not create a cargo line. */
export function withCargo(cache: InventoryCache, resource: string, amount: number): InventoryCache {
  if (amount === 0) return cache;
  const line: CargoLine = { resource, amount, label: FIXTURE_LABEL, organic: false, source: 'mock-grant' };
  return { label: FIXTURE_LABEL, organic: false, lines: [...cache.lines, line] };
}

/** USDC books from provisioning, plus the Tier-1 barter books the maker rests while cash is off. */
export function tradePairs(pairs: readonly string[]): string[] {
  const usdc = pairs.map((base) => {
    const parsed = ResourceKey.safeParse(base);
    if (!parsed.success) throw new GuildProvisionError('bad_amount', `Guild pair ${base} is not a resource`);
    return pairId(parsed.data, 'USDC');
  });
  return [...usdc, ...barterPairIds()];
}

export function accountName(accountId: string): string {
  const name = accountId.split('.')[0] ?? '';
  if (!/^guild-[1-8]$/.test(name)) throw new GuildProvisionError('account_mismatch', `Not a guild sub-account: ${accountId}`);
  return name;
}

export function slotOf(accountId: string): number {
  return Number(accountName(accountId).slice('guild-'.length));
}

export function draftOf(npc: RosterNpc, policy: GuildPolicy, quote: bigint, tradeKeyId: string): GuildDraft {
  return {
    npc,
    policyVersion: policy.policyVersion,
    quoteBudgetAtomic: quote.toString(),
    publicKey: publicKeyOf(npc.id),
    tradeKeyId,
    strategy: { actorKind: 'npc', policyVersion: policy.policyVersion, cashEnabled: 0, quoteLabel: SUBSIDY_LABEL },
    inventory: emptyInventory(),
    homeRoute: { routeLoop: npc.routeLoop, route: [...npc.route] },
  };
}

export function assertT1Cargo(resource: string, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new GuildProvisionError('bad_amount', 'Cargo amount must be a whole number of units, zero or more');
  }
  const parsed = ResourceKey.safeParse(resource);
  if (!parsed.success || !['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'].includes(parsed.data)) {
    throw new GuildProvisionError('bad_amount', `Cargo ${resource} is not a Tier-1 resource`);
  }
}
