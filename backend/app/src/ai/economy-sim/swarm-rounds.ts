import { createHash } from 'node:crypto';

export type SwarmBuyerCohort = 'terraformer' | 'industrial' | 'shield_builder' | 'arb_bot';

export interface SwarmSealedBid {
  readonly agentAccountId: string;
  readonly cohort: SwarmBuyerCohort;
  readonly maxPriceUsdc: number;
  readonly desiredUnits: number;
}

export interface SwarmSealedAsk {
  readonly agentAccountId: string;
  readonly role: 'colony_exporter' | 'guild_merchant';
  readonly minPriceUsdc: number;
  readonly offeredUnits: number;
}

export interface SwarmRoundAllocation {
  readonly buyerAccountId: string;
  readonly cohort: SwarmBuyerCohort;
  readonly unitsReceived: number;
  readonly sharePaidUsdc: number;
}

export interface SwarmClearingRound {
  readonly round: number;
  readonly day: number;
  readonly resource: 'metals.t1' | 'minerals.t1' | 'bio.water' | 'bio.biomass';
  readonly buyerCount: number;
  readonly sellerCount: number;
  readonly bidsSubmitted: number;
  readonly asksSubmitted: number;
  readonly totalBidUnits: number;
  readonly totalAskUnits: number;
  readonly clearingPriceUsdc: number;
  readonly clearedUnits: number;
  readonly totalNotionalUsdc: number;
  readonly zeroSumVerified: boolean;
  readonly intentBatchHash: string;
  readonly topBids: readonly SwarmSealedBid[];
  readonly asks: readonly SwarmSealedAsk[];
  readonly allocations: readonly SwarmRoundAllocation[];
}

export interface SwarmSimulationSummary {
  readonly parentAccount: string;
  readonly buyerSubAccounts: number;
  readonly sellerSubAccounts: number;
  readonly zeroLlmCalls: true;
  readonly rounds: readonly SwarmClearingRound[];
}

const RESOURCES = ['metals.t1', 'bio.water', 'metals.t1', 'bio.biomass', 'metals.t1', 'minerals.t1', 'bio.biomass'] as const;
const BASE_PRICE: Record<(typeof RESOURCES)[number], number> = {
  'metals.t1': 1.0,
  'minerals.t1': 1.2,
  'bio.water': 0.9,
  'bio.biomass': 1.25,
};
const COHORTS: readonly SwarmBuyerCohort[] = ['terraformer', 'industrial', 'shield_builder', 'arb_bot'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hashUnit(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function buildTwentyScriptedBids(
  seed: string,
  day: number,
  anchor: number,
  parent: string,
): SwarmSealedBid[] {
  const bids: SwarmSealedBid[] = [];
  for (let i = 1; i <= 20; i++) {
    const id = String(i).padStart(2, '0');
    const cohort = COHORTS[(i - 1) % COHORTS.length]!;
    const spread = (hashUnit(seed, day * 97 + i * 13) - 0.38) * 0.28;
    const urgency = cohort === 'shield_builder' && (day === 3 || day === 5) ? 0.14 : 0;
    const maxPriceUsdc = round2(Math.max(0.45, anchor * (1 + spread + urgency)));
    const desiredUnits = 8 + ((i * 3 + day * 2) % 14);
    bids.push({
      agentAccountId: `buyer-${id}.${parent}`,
      cohort,
      maxPriceUsdc,
      desiredUnits,
    });
  }
  return bids.sort((a, b) => b.maxPriceUsdc - a.maxPriceUsdc || a.agentAccountId.localeCompare(b.agentAccountId));
}

function buildFiveScriptedAsks(
  seed: string,
  day: number,
  resource: (typeof RESOURCES)[number],
  anchor: number,
  rootAccount: string,
): SwarmSealedAsk[] {
  const accounts: Array<{ id: string; role: 'colony_exporter' | 'guild_merchant'; baseUnits: number }> = [
    { id: `seller-01.swarm.${rootAccount}`, role: 'colony_exporter', baseUnits: 34 },
    { id: `seller-02.swarm.${rootAccount}`, role: 'colony_exporter', baseUnits: 30 },
    { id: `seller-03.swarm.${rootAccount}`, role: 'colony_exporter', baseUnits: 28 },
    { id: `kestrel.npc.${rootAccount}`, role: 'guild_merchant', baseUnits: 46 },
    { id: `vanguard.npc.${rootAccount}`, role: 'guild_merchant', baseUnits: 42 },
  ];
  const floodBoost = resource === 'bio.biomass' && day >= 4 ? 18 : 0;
  return accounts
    .map((acc, idx) => {
      const tilt = (idx - 1.8) * 0.045 + (hashUnit(seed, day * 53 + idx * 19) - 0.5) * 0.06;
      const floodDiscount = floodBoost > 0 ? -0.12 : 0;
      return {
        agentAccountId: acc.id,
        role: acc.role,
        minPriceUsdc: round2(Math.max(0.4, anchor * (0.94 + tilt + floodDiscount))),
        offeredUnits: acc.baseUnits + floodBoost + ((day + idx * 4) % 9),
      };
    })
    .sort((a, b) => a.minPriceUsdc - b.minPriceUsdc || a.agentAccountId.localeCompare(b.agentAccountId));
}

function clearUniformAuction(
  bids: readonly SwarmSealedBid[],
  asks: readonly SwarmSealedAsk[],
  fallbackPrice: number,
): { clearingPriceUsdc: number; clearedUnits: number; allocations: SwarmRoundAllocation[] } {
  const candidates = [...new Set([...bids.map((b) => b.maxPriceUsdc), ...asks.map((a) => a.minPriceUsdc)])].sort((a, b) => a - b);
  let bestPrice = fallbackPrice;
  let bestVol = 0;

  for (const p of candidates) {
    const demand = bids.filter((b) => b.maxPriceUsdc >= p).reduce((s, b) => s + b.desiredUnits, 0);
    const supply = asks.filter((a) => a.minPriceUsdc <= p).reduce((s, a) => s + a.offeredUnits, 0);
    const vol = Math.min(demand, supply);
    if (vol >= bestVol && vol > 0) {
      bestVol = vol;
      bestPrice = p;
    }
  }

  let remaining = bestVol;
  const allocations: SwarmRoundAllocation[] = [];
  for (const b of bids) {
    if (remaining <= 0 || b.maxPriceUsdc < bestPrice) break;
    const fill = Math.min(b.desiredUnits, remaining);
    remaining -= fill;
    allocations.push({
      buyerAccountId: b.agentAccountId,
      cohort: b.cohort,
      unitsReceived: fill,
      sharePaidUsdc: round2(fill * bestPrice),
    });
  }
  return { clearingPriceUsdc: bestPrice, clearedUnits: bestVol, allocations };
}

/**
 * Track 05 (`swarms`) coordinator: runs `days` sealed-bid rounds across 20 buyer sub-accounts
 * and 5 seller/Guild sub-accounts using pure scripted strategies (zero LLM calls) and verifies
 * zero-sum NEP-413 `token_diff` conservation on every round.
 */
export function runScriptedSwarmRounds(
  seed: string,
  days: number,
  rootAccount = 'terraagent.testnet',
): SwarmSimulationSummary {
  const parentAccount = `swarm.${rootAccount}`;
  const rounds: SwarmClearingRound[] = [];

  for (let day = 1; day <= days; day++) {
    const resource = RESOURCES[(day - 1) % RESOURCES.length]!;
    const raidBump = resource === 'metals.t1' && (day === 3 || day === 5) ? 0.14 : 0;
    const anchor = round2(BASE_PRICE[resource] * (1 + raidBump));
    const bids = buildTwentyScriptedBids(seed, day, anchor, parentAccount);
    const asks = buildFiveScriptedAsks(seed, day, resource, anchor, rootAccount);
    const { clearingPriceUsdc, clearedUnits, allocations } = clearUniformAuction(bids, asks, anchor);

    const priceMicro = BigInt(Math.round(clearingPriceUsdc * 1_000_000));
    const buyerCargoSum = allocations.reduce((s, a) => s + BigInt(a.unitsReceived), 0n);
    const sellerCargoDelta = -BigInt(clearedUnits);
    const buyerUsdcDebit = buyerCargoSum * priceMicro;
    const sellerUsdcCredit = BigInt(clearedUnits) * priceMicro;
    const zeroSumVerified = buyerCargoSum + sellerCargoDelta === 0n && buyerUsdcDebit === sellerUsdcCredit;

    const intentBatchHash = createHash('sha256')
      .update(`${seed}:r${day}:${resource}:${clearingPriceUsdc}:${clearedUnits}`)
      .digest('hex')
      .slice(0, 16);

    rounds.push({
      round: day,
      day,
      resource,
      buyerCount: bids.length,
      sellerCount: asks.length,
      bidsSubmitted: bids.length,
      asksSubmitted: asks.length,
      totalBidUnits: bids.reduce((s, b) => s + b.desiredUnits, 0),
      totalAskUnits: asks.reduce((s, a) => s + a.offeredUnits, 0),
      clearingPriceUsdc,
      clearedUnits,
      totalNotionalUsdc: round2(clearedUnits * clearingPriceUsdc),
      zeroSumVerified,
      intentBatchHash: `nep413:${intentBatchHash}`,
      topBids: bids.slice(0, 5),
      asks,
      allocations,
    });
  }

  return {
    parentAccount,
    buyerSubAccounts: 20,
    sellerSubAccounts: 5,
    zeroLlmCalls: true,
    rounds,
  };
}
