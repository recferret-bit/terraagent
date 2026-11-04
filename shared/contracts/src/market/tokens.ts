import { z } from 'zod';
import { RESOURCE_KEYS, ResourceKey } from '../ws/sim';

/**
 * Market tokens (W13-01, NEAR-65, ECONOMY §3). A pair is `<base ResourceKey>/<quote token>`; the quote is another
 * `ResourceKey` (barter), `USDC` (the default cash quote) or `NEAR`. Energy is never tradable (D-34).
 *
 * **Market atomic units.** Every amount the market stores or sends is an exact non-negative integer of the token's
 * smallest *market* unit, serialized as a decimal string: USDC micro-units (6 decimals), NEAR yocto (24 decimals) and
 * **whole units** for resources (market decimals 0, base lot 1). The verifier ledger keeps resources in NEP-245 chain base
 * units (`chainDecimals` 18, like `CargoTokenPort`); adapters convert at that boundary with {@link toChainUnits} /
 * {@link fromChainUnits}. Display precision never defines settlement precision.
 */
export const QUOTE_FIAT_TOKENS = ['USDC', 'NEAR'] as const;
export const MARKET_TOKEN_KEYS = [...RESOURCE_KEYS, ...QUOTE_FIAT_TOKENS] as const;
export const MarketTokenKey = z.enum(MARKET_TOKEN_KEYS);
export type MarketTokenKey = z.infer<typeof MarketTokenKey>;
/** The quote side of a pair: any market token. USDC is the default; resources mean barter. */
export const QuoteToken = MarketTokenKey;
export type QuoteToken = MarketTokenKey;

/** A non-negative integer amount in market atomic units, as a decimal string (no sign, no leading zeros, ≤ 78 digits). */
export const AtomicAmount = z.string().regex(/^(0|[1-9]\d{0,77})$/, 'expected a non-negative integer decimal string');
export type AtomicAmount = z.infer<typeof AtomicAmount>;
/** A signed integer amount in market atomic units, as a decimal string (ledger deltas, `-10200000`). */
export const SignedAtomicAmount = z.string().regex(/^(0|-?[1-9]\d{0,77})$/, 'expected an integer decimal string');
export type SignedAtomicAmount = z.infer<typeof SignedAtomicAmount>;

export interface MarketTokenDef {
  readonly key: MarketTokenKey;
  /** Verifier (`intents.near` mock) token id. */
  readonly verifierId: string;
  /** Decimals of the market atomic unit (display only). */
  readonly decimals: number;
  /** Decimals of the on-chain base unit the verifier ledger stores. */
  readonly chainDecimals: number;
  readonly kind: 'resource' | 'ft' | 'native';
  /** Mock tokens are labelled as such in every UI (NEAR-65, W13-17). */
  readonly mock: boolean;
}

/** NEP-245 multi-token contract of the mock cargo resources (one token id per sub-resource, D-34). */
export const MOCK_RESOURCE_CONTRACT = 'res.terraagent.mock';
export const MOCK_USDC_CONTRACT = 'usdc.mock';

const resourceDef = (key: ResourceKey): MarketTokenDef => ({
  key, verifierId: `nep245:${MOCK_RESOURCE_CONTRACT}:${key}`, decimals: 0, chainDecimals: 18, kind: 'resource', mock: true,
});

export const MARKET_TOKENS: Readonly<Record<MarketTokenKey, MarketTokenDef>> = {
  ...(Object.fromEntries(RESOURCE_KEYS.map((k) => [k, resourceDef(k)])) as Record<ResourceKey, MarketTokenDef>),
  USDC: { key: 'USDC', verifierId: `nep141:${MOCK_USDC_CONTRACT}`, decimals: 6, chainDecimals: 6, kind: 'ft', mock: true },
  NEAR: { key: 'NEAR', verifierId: 'native:near', decimals: 24, chainDecimals: 24, kind: 'native', mock: true },
};

export const marketToken = (key: MarketTokenKey): MarketTokenDef => MARKET_TOKENS[key];
export const isResourceToken = (key: MarketTokenKey): key is ResourceKey => MARKET_TOKENS[key].kind === 'resource';
export const tokenKeyOfVerifierId = (verifierId: string): MarketTokenKey | null =>
  MARKET_TOKEN_KEYS.find((k) => MARKET_TOKENS[k].verifierId === verifierId) ?? null;

const scale = (key: MarketTokenKey): bigint => 10n ** BigInt(MARKET_TOKENS[key].chainDecimals - MARKET_TOKENS[key].decimals);
/** Market atomic → verifier chain base units (resources × 10^18; USDC/NEAR unchanged). */
export const toChainUnits = (key: MarketTokenKey, atomic: bigint | string): bigint => BigInt(atomic) * scale(key);
/** Verifier chain base units → market atomic, floored (fractions of a whole resource unit stay in the verifier). */
export const fromChainUnits = (key: MarketTokenKey, chain: bigint | string): bigint => BigInt(chain) / scale(key);

/** `bio.water/USDC`: the pair id used in books, pushes, REST and the DB. */
export const PAIR_ID_RE = /^([a-z]+\.[a-z0-9]+)\/([A-Za-z]+(?:\.[a-z0-9]+)?)$/;
export const pairId = (base: ResourceKey, quote: QuoteToken): string => `${base}/${quote}`;
export const PairId = z.string().refine((s) => parsePairId(s) !== null, 'expected <ResourceKey>/<quote token> with base ≠ quote');
export type PairId = string;
export function parsePairId(id: string): { base: ResourceKey; quote: QuoteToken } | null {
  const m = PAIR_ID_RE.exec(id);
  if (!m) return null;
  const base = ResourceKey.safeParse(m[1]);
  const quote = QuoteToken.safeParse(m[2]);
  if (!base.success || !quote.success || (base.data as string) === quote.data) return null;
  return { base: base.data, quote: quote.data };
}
