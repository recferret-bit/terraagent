import { ACHIEVEMENT_FAMILY_BY_ID, type ProgressEventV1 } from '@terra/contracts';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import { tradeIdOf } from '../settlement/settlement-fills.hook.js';

/** W12 family id. Prose calls the same counter `progress.guildContact`. */
export const GUILD_CONTACT_FAMILY = 'guild-contact' as const;

/** Owners who may receive the fact. Fixture, subsidy and `guild` do not. */
const CREDITABLE = new Set(['player', 'bot']);

export interface GuildContactParty {
  readonly actorKind: string;
  readonly colonyId: string;
  readonly playerId: string | null;
}

export interface GuildContactFill {
  readonly tradeId: string;
  readonly planetId: string;
  readonly amount: number;
  readonly tick?: number;
  readonly takerOrderId?: string;
  readonly makerOrderId?: string;
  readonly buyer: GuildContactParty;
  readonly seller: GuildContactParty;
}

export interface GuildContactOrder {
  readonly orderId: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly playerId: string | null;
  readonly actorKind: string;
  readonly filled: bigint;
}

export interface GuildContactMatch {
  readonly incoming: GuildContactOrder | null;
  readonly fills: readonly Fill[];
  readonly makers: ReadonlyMap<string, GuildContactOrder>;
}

export function guildContactEventId(tradeId: string, playerId: string): string {
  return `guild:guildContact:${tradeId}:${playerId}`;
}

/**
 * The live trade id for a fill. No stored row keeps `computedId`. A non-FAILED row keeps it.
 * A FAILED row uses the latest non-FAILED retry, or null when the fill did not survive.
 */
export function liveTradeId(
  computedId: string,
  exact: { readonly state: string } | null,
  retries: readonly { readonly tradeId: string; readonly state: string }[],
): string | null {
  if (!exact || exact.state !== 'FAILED') return computedId;
  const ranked = retries
    .filter((row) => row.state !== 'FAILED')
    .sort((a, b) => retryRank(a.tradeId) - retryRank(b.tradeId));
  const picked = ranked[ranked.length - 1];
  return picked ? picked.tradeId : null;
}

function retryRank(tradeId: string): number {
  const mark = tradeId.lastIndexOf('~');
  if (mark < 0) return 0;
  const n = Number(tradeId.slice(mark + 1));
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** +1 for the non-NPC player. Zero qty, player-player, same colony and same owner are null. */
export function guildContactEvent(fill: GuildContactFill): ProgressEventV1 | null {
  if (!fill.tradeId || !fill.planetId) return null;
  if (!Number.isSafeInteger(fill.amount) || fill.amount <= 0) return null;
  const npc = [fill.buyer, fill.seller].filter((side) => side.actorKind === 'npc');
  if (npc.length !== 1) return null;
  const player = fill.buyer.actorKind === 'npc' ? fill.seller : fill.buyer;
  const guild = npc[0]!;
  if (!CREDITABLE.has(player.actorKind) || !player.playerId || !player.colonyId) return null;
  if (player.colonyId === guild.colonyId) return null;
  if (guild.playerId && guild.playerId === player.playerId) return null;
  return {
    eventId: guildContactEventId(fill.tradeId, player.playerId),
    playerId: player.playerId,
    colonyId: player.colonyId,
    planetId: fill.planetId,
    family: GUILD_CONTACT_FAMILY,
    metric: ACHIEVEMENT_FAMILY_BY_ID.get(GUILD_CONTACT_FAMILY)!.metric,
    value: 1,
    atTick: fill.tick ?? 0,
  };
}

/** One matcher outcome, one description per leg. Ids match the fills hook before a FAILED retry suffix. */
export function guildContactFills(outcome: GuildContactMatch): GuildContactFill[] {
  const orders = new Map<string, GuildContactOrder>();
  if (outcome.incoming) orders.set(outcome.incoming.orderId, outcome.incoming);
  for (const [id, row] of outcome.makers) orders.set(id, row);
  const filledBefore = new Map<string, bigint>();
  const out: GuildContactFill[] = [];
  for (const fill of outcome.fills) {
    const described = describeFill(fill, orders, filledBefore);
    if (described) out.push(described);
  }
  return out;
}

function partyOf(order: GuildContactOrder): GuildContactParty {
  return { actorKind: order.actorKind, colonyId: order.colonyId, playerId: order.playerId };
}

function describeFill(
  fill: Fill,
  orders: ReadonlyMap<string, GuildContactOrder>,
  filledBefore: Map<string, bigint>,
): GuildContactFill | null {
  const taker = orders.get(fill.takerOrderId);
  const buyer = orders.get(fill.buyerOrderId);
  const seller = orders.get(fill.sellerOrderId);
  if (!taker || !buyer || !seller) return null;
  const before = filledBefore.get(taker.orderId) ?? taker.filled;
  filledBefore.set(taker.orderId, before + fill.qty);
  const amount = fill.qty > 0n && fill.qty <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(fill.qty) : 0;
  return {
    tradeId: tradeIdOf(fill, before),
    planetId: buyer.planetId || seller.planetId,
    amount,
    takerOrderId: fill.takerOrderId,
    makerOrderId: fill.makerOrderId,
    buyer: partyOf(buyer),
    seller: partyOf(seller),
  };
}
