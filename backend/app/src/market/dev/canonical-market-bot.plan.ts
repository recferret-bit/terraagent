import {
  canonicalPlanetById,
  type MarketTokenKey,
  type OrderSide,
  type PlanetType,
  type QuoteToken,
  type ResourceKey,
} from '@terra/contracts';

export interface CanonicalMarketBotDef {
  readonly slug: string;
  readonly colonyIndex: number;
  readonly playerId: string;
  readonly stallName: string;
  readonly stallFeeBp: number;
}

export const CANONICAL_MARKET_BOTS: readonly CanonicalMarketBotDef[] = [
  { slug: 'iron', colonyIndex: 91, playerId: 'bot:iron-guild', stallName: 'Iron Guild Outpost', stallFeeBp: 50 },
  { slug: 'crimson', colonyIndex: 92, playerId: 'bot:crimson-vanguard', stallName: 'Crimson Vanguard', stallFeeBp: 75 },
  { slug: 'aether', colonyIndex: 93, playerId: 'bot:aether-syndicate', stallName: 'Aether Syndicate', stallFeeBp: 40 },
  { slug: 'helios', colonyIndex: 94, playerId: 'bot:helios-consortium', stallName: 'Helios Consortium', stallFeeBp: 60 },
  { slug: 'nexus', colonyIndex: 95, playerId: 'bot:nexus-prime', stallName: 'Nexus Prime', stallFeeBp: 50 },
] as const;

export interface CanonicalBotPairSpec {
  readonly pair: string;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly orderAmount: number;
  readonly tradeAmount: number;
  readonly midByPlanet: Readonly<Record<PlanetType, bigint>>;
}

const NEAR_CENT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export const CANONICAL_BOT_PAIRS: readonly CanonicalBotPairSpec[] = [
  {
    pair: 'bio.water/USDC',
    base: 'bio.water',
    quote: 'USDC',
    orderAmount: 35,
    tradeAmount: 25,
    midByPlanet: { desert: 1_200_000n, ocean: 800_000n, temperate: 1_000_000n },
  },
  {
    pair: 'metals.t1/USDC',
    base: 'metals.t1',
    quote: 'USDC',
    orderAmount: 40,
    tradeAmount: 28,
    midByPlanet: { desert: 900_000n, ocean: 1_400_000n, temperate: 1_150_000n },
  },
  {
    pair: 'minerals.t1/USDC',
    base: 'minerals.t1',
    quote: 'USDC',
    orderAmount: 35,
    tradeAmount: 24,
    midByPlanet: { desert: 1_500_000n, ocean: 1_600_000n, temperate: 1_250_000n },
  },
  {
    pair: 'bio.biomass/USDC',
    base: 'bio.biomass',
    quote: 'USDC',
    orderAmount: 30,
    tradeAmount: 22,
    midByPlanet: { desert: 1_900_000n, ocean: 1_650_000n, temperate: 1_450_000n },
  },
  {
    pair: 'metals.t1/NEAR',
    base: 'metals.t1',
    quote: 'NEAR',
    orderAmount: 40,
    tradeAmount: 26,
    midByPlanet: { desert: 22n * NEAR_CENT, ocean: 28n * NEAR_CENT, temperate: 25n * NEAR_CENT },
  },
  {
    pair: 'bio.water/NEAR',
    base: 'bio.water',
    quote: 'NEAR',
    orderAmount: 40,
    tradeAmount: 26,
    midByPlanet: { desert: 26n * NEAR_CENT, ocean: 18n * NEAR_CENT, temperate: 22n * NEAR_CENT },
  },
  {
    pair: 'metals.t1/minerals.t1',
    base: 'metals.t1',
    quote: 'minerals.t1',
    orderAmount: 40,
    tradeAmount: 30,
    midByPlanet: { desert: 1n, ocean: 2n, temperate: 1n },
  },
  {
    pair: 'metals.t1/bio.water',
    base: 'metals.t1',
    quote: 'bio.water',
    orderAmount: 40,
    tradeAmount: 30,
    midByPlanet: { desert: 1n, ocean: 2n, temperate: 1n },
  },
  {
    pair: 'bio.water/minerals.t1',
    base: 'bio.water',
    quote: 'minerals.t1',
    orderAmount: 40,
    tradeAmount: 30,
    midByPlanet: { desert: 2n, ocean: 1n, temperate: 1n },
  },
  {
    pair: 'bio.biomass/minerals.t1',
    base: 'bio.biomass',
    quote: 'minerals.t1',
    orderAmount: 35,
    tradeAmount: 25,
    midByPlanet: { desert: 2n, ocean: 2n, temperate: 1n },
  },
] as const;

export const BOT_FUNDING_AMOUNTS: ReadonlyArray<readonly [MarketTokenKey, bigint]> = [
  ['USDC', 500_000n * 1_000_000n],
  ['NEAR', 50_000n * 10n ** 24n],
  ['metals.t1', 50_000n],
  ['minerals.t1', 50_000n],
  ['bio.water', 50_000n],
  ['bio.biomass', 50_000n],
] as const;

export interface BotWorldTarget {
  readonly id: string;
  readonly type: PlanetType;
}

export interface LadderOrderSpec {
  readonly botIndex: number;
  readonly side: OrderSide;
  readonly amount: number;
  readonly priceAmount: bigint;
}

export interface BotCrossSpec {
  readonly buyerBot: CanonicalMarketBotDef;
  readonly sellerBot: CanonicalMarketBotDef;
  readonly amount: number;
  readonly priceAmount: bigint;
}

const LADDER_LEVELS: ReadonlyArray<{ readonly side: OrderSide; readonly offsetBp: bigint }> = [
  { side: 'buy', offsetBp: -300n },
  { side: 'buy', offsetBp: -600n },
  { side: 'buy', offsetBp: -1000n },
  { side: 'sell', offsetBp: 300n },
  { side: 'sell', offsetBp: 600n },
  { side: 'sell', offsetBp: 1000n },
];

/** Symmetric 10-pair Eulerian rotation across all 5 bots keeping counterparty concentration <= 2500bp. */
const CROSS_SLOTS: ReadonlyArray<{ readonly offsetBp: bigint; readonly bots: readonly [number, number] }> = [
  { offsetBp: -180n, bots: [0, 1] },
  { offsetBp: 90n, bots: [2, 3] },
  { offsetBp: -90n, bots: [4, 0] },
  { offsetBp: 160n, bots: [1, 2] },
  { offsetBp: 0n, bots: [3, 4] },
  { offsetBp: -140n, bots: [0, 2] },
  { offsetBp: 120n, bots: [1, 3] },
  { offsetBp: -60n, bots: [2, 4] },
  { offsetBp: 60n, bots: [3, 0] },
  { offsetBp: 140n, bots: [4, 1] },
];

export function canonicalBotColonyId(planetId: string, slug: string): string {
  return `bot-${slug}.${planetId}`;
}

export function resolveBotPlanetType(planetId: string, dbType?: string | null): PlanetType {
  const canonical = canonicalPlanetById(planetId);
  if (canonical) return canonical.type;
  if (dbType === 'desert' || dbType === 'ocean' || dbType === 'temperate') return dbType;
  const lower = planetId.toLowerCase();
  if (lower.includes('ocean')) return 'ocean';
  if (lower.includes('temperate') || lower.includes('forest')) return 'temperate';
  return 'desert';
}

export function buildLadderSpecs(pairIndex: number, planetType: PlanetType, spec: CanonicalBotPairSpec): LadderOrderSpec[] {
  const mid = spec.midByPlanet[planetType];
  return LADDER_LEVELS.map((lvl, levelIdx) => {
    const raw = (BigInt(spec.orderAmount) * mid * (10_000n + lvl.offsetBp)) / 10_000n;
    const priceAmount = raw > 0n ? raw : 1n;
    return {
      botIndex: (pairIndex * 6 + levelIdx) % CANONICAL_MARKET_BOTS.length,
      side: lvl.side,
      amount: spec.orderAmount,
      priceAmount,
    };
  });
}

function buildCrossSpec(planetType: PlanetType, spec: CanonicalBotPairSpec, slotIndex: number): BotCrossSpec {
  const slot = CROSS_SLOTS[((slotIndex % CROSS_SLOTS.length) + CROSS_SLOTS.length) % CROSS_SLOTS.length]!;
  const mid = spec.midByPlanet[planetType];
  const raw = (BigInt(spec.tradeAmount) * mid * (10_000n + slot.offsetBp)) / 10_000n;
  return {
    buyerBot: CANONICAL_MARKET_BOTS[slot.bots[0]]!,
    sellerBot: CANONICAL_MARKET_BOTS[slot.bots[1]]!,
    amount: spec.tradeAmount,
    priceAmount: raw > 0n ? raw : 1n,
  };
}

export function buildBootstrapCrosses(planetType: PlanetType, spec: CanonicalBotPairSpec, count: number): BotCrossSpec[] {
  const crosses: BotCrossSpec[] = [];
  for (let i = 0; i < count; i++) {
    crosses.push(buildCrossSpec(planetType, spec, i));
  }
  return crosses;
}

export function buildLiveCross(planetType: PlanetType, spec: CanonicalBotPairSpec, seq: number): BotCrossSpec {
  return buildCrossSpec(planetType, spec, seq);
}

/**
 * If one counterparty's volume share nears or exceeds `counterpartyWeightCapBp` (4000bp),
 * returns 2 inside-spread crosses among the 3 least-represented bots to bring concentration below 3500bp.
 */
export function buildRebalanceCrosses(
  planetId: string,
  planetType: PlanetType,
  spec: CanonicalBotPairSpec,
  trades: ReadonlyArray<{ readonly buyerColonyId: string; readonly sellerColonyId: string; readonly amount: bigint }>,
): BotCrossSpec[] {
  if (trades.length === 0) return [];
  const participation = new Map<string, bigint>();
  let doubleVolume = 0n;
  for (const t of trades) {
    participation.set(t.buyerColonyId, (participation.get(t.buyerColonyId) ?? 0n) + t.amount);
    participation.set(t.sellerColonyId, (participation.get(t.sellerColonyId) ?? 0n) + t.amount);
    doubleVolume += t.amount * 2n;
  }
  if (doubleVolume === 0n) return [];
  const maxPart = [...participation.values()].reduce((a, b) => (a > b ? a : b), 0n);
  const topBp = Number((maxPart * 10_000n) / doubleVolume);
  if (topBp <= 3800) return [];

  const ranked = [...CANONICAL_MARKET_BOTS].sort((a, b) => {
    const va = participation.get(canonicalBotColonyId(planetId, a.slug)) ?? 0n;
    const vb = participation.get(canonicalBotColonyId(planetId, b.slug)) ?? 0n;
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  const mid = spec.midByPlanet[planetType];
  const makePrice = (offsetBp: bigint): bigint => {
    const raw = (BigInt(spec.tradeAmount) * mid * (10_000n + offsetBp)) / 10_000n;
    return raw > 0n ? raw : 1n;
  };
  return [
    { buyerBot: ranked[0]!, sellerBot: ranked[1]!, amount: spec.tradeAmount, priceAmount: makePrice(-90n) },
    { buyerBot: ranked[2]!, sellerBot: ranked[0]!, amount: spec.tradeAmount, priceAmount: makePrice(90n) },
  ];
}
