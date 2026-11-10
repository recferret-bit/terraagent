import { isResourceToken, type QuoteToken, type ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../../kernel/config';
import type { Ratio } from '../../../economy/flows/ratio';
import { quoteColony } from '../agent/decide';
import type { AgentParams } from '../agent/params';
import type { AgentColonyInput, AgentQuotes, ReferenceBasis, WalkAwayInputs } from '../agent/types';
import { guildPolicy, type GuildPolicy } from './policy';

/**
 * One Guild NPC's book inputs. Reference age and eligible volume are the W13-62 board summary
 * (organic trades only). A missing price is passed through; this module never invents one.
 */
export interface GuildQuoteFixture {
  readonly resource: ResourceKey;
  readonly quote: QuoteToken;
  readonly inventory: bigint;
  /** Free quote-token balance (USDC/NEAR atomic, or whole units for barter). */
  readonly cash: bigint;
  readonly referencePrice: Ratio | null;
  readonly referenceAgeS: number | null;
  readonly eligibleVolume: number | null;
  readonly platformFeeBp: number;
  readonly maxStallFeeBp: number;
  readonly transportPerUnit: Ratio | null;
  readonly ownUnitCost: Ratio | null;
  readonly walkAway: WalkAwayInputs;
  readonly npcId?: string;
  readonly basis?: ReferenceBasis;
  readonly need?: AgentColonyInput['need'];
  readonly freeUnits?: bigint;
  readonly keepUnits?: bigint;
  readonly lotUnits?: number;
  readonly minNotionalAtomic?: bigint;
  readonly budgetLeft?: bigint | null;
}

/**
 * Thin side: inventory below the NPC target widens the ask; inventory above it widens the bid.
 * Exactly at the target keeps both half-spreads. `thinHalfSpreadBp` never tightens a wider base side.
 */
export function guildQuoteParams(policy: GuildPolicy, inventory: bigint, target: bigint): AgentParams {
  const base = policy.params;
  if (inventory < target) return withSpread(base, 'askHalfSpreadBp', policy.thinHalfSpreadBp);
  if (inventory > target) return withSpread(base, 'bidHalfSpreadBp', policy.thinHalfSpreadBp);
  return base;
}

/** `AgentColonyInput` for `quoteColony`. Buy size is room under the inventory cap; sell size is the stock. */
export function guildColonyInput(policy: GuildPolicy, fixture: GuildQuoteFixture): AgentColonyInput {
  const target = targetOf(policy, fixture);
  const inventory = fixture.inventory;
  const cap = BigInt(policy.inventoryCapUnits);
  const room = cap > inventory ? cap - inventory : 0n;
  return {
    resource: fixture.resource,
    quote: fixture.quote,
    need: fixture.need ?? { planned: room, reserve: 0n, available: 0n, expectedOwn: 0n },
    inventory,
    target,
    freeUnits: fixture.freeUnits ?? (inventory > 0n ? inventory : 0n),
    keepUnits: fixture.keepUnits ?? 0n,
    reference: {
      price: fixture.referencePrice,
      ageS: fixture.referenceAgeS,
      eligibleVolume: fixture.eligibleVolume,
      basis: fixture.basis ?? 'organic',
    },
    walkAway: fixture.walkAway,
    ownUnitCost: fixture.ownUnitCost,
    transportPerUnit: fixture.transportPerUnit,
    // Cash bids stay off while cashEnabled is 0. The library pauses them; a stale or thin reference still wins.
    freeQuote: policy.cashEnabled === 0 && !isResourceToken(fixture.quote) ? 0n : fixture.cash,
    budgetLeft: fixture.budgetLeft ?? null,
    platformFeeBp: fixture.platformFeeBp,
    maxStallFeeBp: fixture.maxStallFeeBp,
    lotUnits: fixture.lotUnits ?? 1,
    minNotionalAtomic: fixture.minNotionalAtomic ?? 1n,
  };
}

/** Guild quote: the W13 `quoteColony` function and the guild policy row. No second pricer. */
export function quoteGuild(data: CompiledDataLike, fixture: GuildQuoteFixture): AgentQuotes {
  const policy = guildPolicy(data);
  const input = guildColonyInput(policy, fixture);
  return quoteColony(input, guildQuoteParams(policy, input.inventory, input.target));
}

function withSpread(base: AgentParams, side: 'bidHalfSpreadBp' | 'askHalfSpreadBp', thin: number): AgentParams {
  const next = Math.max(base[side], thin);
  return next === base[side] ? base : { ...base, [side]: next };
}

function targetOf(policy: GuildPolicy, fixture: GuildQuoteFixture): bigint {
  const id = fixture.npcId ?? 'kestrel';
  const npc = policy.roster.find((n) => n.id === id);
  if (!npc) throw new RangeError(`guild npc ${id} is not on the roster`);
  const target = npc.targets[fixture.resource];
  if (target === undefined) throw new RangeError(`guild ${id} has no target for ${fixture.resource}`);
  return BigInt(target);
}
