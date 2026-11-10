import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import { nextInt, seedStream } from '../../kernel/rng';
import { marketConfigFromData } from '../market-config';
import { ratio, type Ratio } from '../flows/ratio';
import { readMinNotionalAtomic } from '../../systems/trade/market-state';
import {
  guildPolicy, quoteGuild, type GuildPolicy, type GuildQuoteFixture,
} from '../../systems/trade/guild';
import type { SideQuote } from '../../systems/trade/agent/types';

/** Bounded replay (W15-29). Not the multi-week W13-48 suite. */
export const GUILD_PRICING_STEPS = 20;

const ORGANIC_ACTORS = ['player', 'bot'] as const;

/**
 * A guild side is not organic demand. Same first clause as `isOrganicFill` (`backend/.../settlement/organic.ts`):
 * `npc` is not `player` or `bot`.
 */
export const guildSideOrganic = (actorKind: string): boolean => (ORGANIC_ACTORS as readonly string[]).includes(actorKind);

export type GuildPricingStatus = 'rested' | 'funding_cap' | 'per_order' | 'paused';

export interface GuildPricingStep {
  readonly step: number;
  readonly npcId: string;
  readonly resource: ResourceKey;
  readonly status: GuildPricingStatus;
  /** Ask the library returned. Null when that side paused. A rejected ask still records its price. */
  readonly amount: string | null;
  readonly priceAmount: string | null;
  readonly bid: string | null;
  readonly exposure: string;
  readonly loss: string;
}

export interface GuildPricingFill {
  readonly actorKind: 'npc';
  readonly organic: boolean;
  readonly accountId: string;
  readonly resource: ResourceKey;
  readonly amount: string;
  readonly priceAmount: string;
}

export interface GuildPricingReplay {
  readonly seed: number;
  /** No buyer population and no reference price. */
  readonly demandSource: 'none';
  readonly steps: readonly GuildPricingStep[];
  readonly exposure: string;
  readonly loss: string;
  readonly perOrderCap: string;
  readonly globalCap: string;
  readonly lossCap: string;
  readonly fill: GuildPricingFill | null;
}

/**
 * Largest whole-unit cost whose ask, after the policy reserve margin, still fits in `perOrder`.
 * Not an observed price and not a demand input: there is no reference, so the bid stays paused.
 */
export function capProbeUnitCost(perOrder: bigint, units: bigint, reserveMarginBp: number): Ratio {
  if (perOrder <= 0n || units <= 0n) throw new RangeError('per-order cap cannot fund a guild lot');
  const margin = 10_000 + reserveMarginBp;
  const num = (perOrder * 10_000n) / (units * BigInt(margin));
  if (num <= 0n) throw new RangeError('per-order cap cannot fund one unit after the reserve margin');
  return ratio(num, 1n);
}

/** One Guild ask input. Inventory is the compiled NPC target. Reference is null on purpose. */
export function guildPricingFixture(data: CompiledDataLike, npcId: string, resource: ResourceKey): GuildQuoteFixture {
  const policy = guildPolicy(data);
  const cfg = marketConfigFromData(data);
  const npc = policy.roster.find((n) => n.id === npcId);
  if (!npc) throw new RangeError(`guild npc ${npcId} is not on the roster`);
  const target = npc.targets[resource];
  if (target === undefined) throw new RangeError(`guild ${npcId} has no target for ${resource}`);
  const units = BigInt(policy.params.maxOrderUnits);
  return {
    npcId, resource, quote: 'USDC', inventory: BigInt(target), freeUnits: BigInt(target), keepUnits: 0n, cash: 0n,
    referencePrice: null, referenceAgeS: null, eligibleVolume: null, basis: 'organic',
    platformFeeBp: cfg.platformFeeBp, maxStallFeeBp: cfg.stallFeeMaxBp, transportPerUnit: ratio(0n),
    ownUnitCost: capProbeUnitCost(BigInt(policy.perOrderExposureAtomic), units, policy.params.reserveMarginBp),
    walkAway: { localUnitCost: null, localMinutesPerUnit: null, minuteValue: null, needValue: null },
    lotUnits: cfg.baseLotUnits, minNotionalAtomic: readMinNotionalAtomic(data, 'USDC'), budgetLeft: null,
  };
}

interface Admission { readonly status: GuildPricingStatus; readonly add: bigint }

/** `reserved + spent + amount <= cap`, same inequality as the funding book's `reserveExposure`. */
function admit(ask: SideQuote | null, perOrder: bigint, globalCap: bigint, used: bigint): Admission {
  if (!ask) return { status: 'paused', add: 0n };
  if (ask.priceAmount <= 0n || ask.priceAmount > perOrder) return { status: 'per_order', add: 0n };
  if (used + ask.priceAmount > globalCap) return { status: 'funding_cap', add: 0n };
  return { status: 'rested', add: ask.priceAmount };
}

function resourceAt(pairs: readonly string[], index: number): ResourceKey {
  const key = pairs[index];
  if (key !== 'metals.t1' && key !== 'minerals.t1' && key !== 'bio.water' && key !== 'bio.biomass') {
    throw new RangeError(`guild pair ${key ?? ''} is not Tier-1`);
  }
  return key;
}

function fillOf(policy: GuildPolicy, npcId: string, resource: ResourceKey, ask: SideQuote): GuildPricingFill {
  const npc = policy.roster.find((n) => n.id === npcId);
  const organic = guildSideOrganic('npc');
  return {
    actorKind: 'npc', organic, accountId: npc?.accountId ?? npcId, resource,
    amount: ask.amount.toString(), priceAmount: ask.priceAmount.toString(),
  };
}

/**
 * Fixed-seed guild quotes through `quoteGuild` (which calls `quoteColony`). At most `steps` asks.
 * Exposure is the sum of rested ask notionals and never passes `globalExposureAtomic`.
 * Loss is not posted (LED-41) and is refused if it would pass `dailyLossAtomic`.
 */
export function replayGuildPricing(data: CompiledDataLike, seed: number, steps = GUILD_PRICING_STEPS): GuildPricingReplay {
  const policy = guildPolicy(data);
  const perOrder = BigInt(policy.perOrderExposureAtomic);
  const globalCap = BigInt(policy.globalExposureAtomic);
  const lossCap = BigInt(policy.dailyLossAtomic);
  // A fill does not post a loss (LED-41). The counter stays 0, which is inside dailyLossAtomic.
  const loss = 0n;
  const rng = seedStream(`guild-pricing:${seed}`, 'experiment');
  const pairs = policy.roster[0]?.pairs ?? [];
  let used = 0n;
  let fill: GuildPricingFill | null = null;
  const out: GuildPricingStep[] = [];
  const n = Math.min(GUILD_PRICING_STEPS, Math.max(0, steps));
  for (let step = 0; step < n; step++) {
    const npc = policy.roster[nextInt(rng, 0, policy.roster.length - 1)];
    if (!npc) throw new RangeError('guild roster is empty');
    const resource = resourceAt(pairs, nextInt(rng, 0, pairs.length - 1));
    const quotes = quoteGuild(data, guildPricingFixture(data, npc.id, resource));
    const gate = admit(quotes.ask, perOrder, globalCap, used);
    used += gate.add;
    if (gate.status === 'rested' && quotes.ask && !fill) fill = fillOf(policy, npc.id, resource, quotes.ask);
    out.push({
      step, npcId: npc.id, resource, status: gate.status,
      amount: quotes.ask ? quotes.ask.amount.toString() : null,
      priceAmount: quotes.ask ? quotes.ask.priceAmount.toString() : null,
      bid: quotes.bid ? quotes.bid.priceAmount.toString() : null,
      exposure: used.toString(), loss: loss.toString(),
    });
  }
  return {
    seed, demandSource: 'none', steps: out, exposure: used.toString(), loss: loss.toString(),
    perOrderCap: perOrder.toString(), globalCap: globalCap.toString(), lossCap: lossCap.toString(), fill,
  };
}
