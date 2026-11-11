import { z } from 'zod';
import { MarketPrice, OrderSide } from '../market/orders';
import { AtomicAmount, MarketTokenKey } from '../market/tokens';
import { ResourceKey } from '../ws/sim';

/** Player action on a curated Guild offer. `buy` means the player receives `resource`. */
export const GuildOfferAction = OrderSide;
export type GuildOfferAction = z.infer<typeof GuildOfferAction>;

/**
 * One "fills now" offer inside `guild.arrived` (top 6: best price per pair and side).
 * `price` is the cargo quote only. Platform and stall fees are added by the W13 settlement path.
 * `reason` is optional judge-facing text (owner default on Q-04-5: the field exists, offers may omit it).
 */
export const GuildOfferSchema = z.strictObject({
  offerId: z.string().min(1).max(160),
  shipId: z.string().min(1).max(64),
  npcId: z.string().min(1).max(64),
  npcAccountId: z.string().min(2).max(64),
  action: GuildOfferAction,
  resource: ResourceKey,
  amount: z.number().int().positive().max(1_000_000_000),
  price: MarketPrice,
  /** Changes when the NPC re-quotes. Accepting an id from an older seq is `offer_expired`. */
  quoteSeq: z.number().int().nonnegative(),
  reason: z.string().max(240).optional(),
}).refine((o) => (o.resource as string) !== o.price.token, { message: 'base and quote must differ', path: ['price', 'token'] });
export type GuildOffer = z.infer<typeof GuildOfferSchema>;

export const GuildArrivedPayload = z.object({
  shipId: z.string().min(1).max(64),
  planetId: z.string().min(1).max(64),
  npcId: z.string().min(1).max(64),
  /** Display name, e.g. "Kestrel". */
  name: z.string().min(1).max(64),
  /** Unix ms when the ship leaves. The client counts down from this. */
  departAt: z.number().int().nonnegative(),
  offers: z.array(GuildOfferSchema).max(6),
});
export type GuildArrivedPayload = z.infer<typeof GuildArrivedPayload>;

export const GuildDepartedPayload = z.object({
  shipId: z.string().min(1).max(64),
  planetId: z.string().min(1).max(64),
  npcId: z.string().min(1).max(64),
});
export type GuildDepartedPayload = z.infer<typeof GuildDepartedPayload>;

/** One token row of a limited key. `available = allowance - reserved - spent`, all atomic decimal strings. */
export const DirectorTokenAllowanceSchema = z.object({
  token: MarketTokenKey,
  allowance: AtomicAmount,
  reserved: AtomicAmount,
  spent: AtomicAmount,
  available: AtomicAmount,
});
export type DirectorTokenAllowance = z.infer<typeof DirectorTokenAllowanceSchema>;

/**
 * `director.status` push (NEAR-80). Distinct from the W16 sim event `directorStatus`.
 * Principal is per token. Gas is a separate NEAR allowance and is not an asset-spend limit (NEAR-81).
 */
export const DirectorKeyStatusPayload = z.object({
  colonyId: z.string().min(1).max(64),
  state: z.enum(['missing', 'active', 'revoked']),
  tokens: z.array(DirectorTokenAllowanceSchema).max(16),
  gasAllowance: AtomicAmount.optional(),
  gasSpent: AtomicAmount.optional(),
});
export type DirectorKeyStatusPayload = z.infer<typeof DirectorKeyStatusPayload>;
