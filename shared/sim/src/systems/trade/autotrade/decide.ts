import type { AutoTradeOrder, AutoTradePartner } from '@terra/contracts';
import { withinAutoTrade } from '../../away/auto-trade';
import { orderFor } from './authorize';
import { forecastAutoTrade } from './forecast';
import type { AutoTradeForecastInput, AutoTradeRefuse } from './types';

export const DIRECTOR_SKIP_REASONS = [
  'storage',
  'session_cap',
  'autotrade_limit',
  'partner',
  'no_surplus',
  'no_shortage',
  'tier',
  'no_limit',
  'not_authorized',
  'truce_disabled',
] as const;
export type DirectorSkipReason = (typeof DIRECTOR_SKIP_REASONS)[number];

export interface DirectorTradePick {
  readonly side: 'sell' | 'buy';
  readonly resource: AutoTradeForecastInput['resource'];
  readonly amount: number;
}

/** A refusal. `session_cap` is only when `sessionSpent + amount` is past `maxPerSession` (`withinAutoTrade` is inclusive). */
export interface DirectorTradeSkip {
  readonly skip: DirectorSkipReason;
}

export type DirectorTradeDecision = DirectorTradePick | DirectorTradeSkip;

export function isDirectorTrade(d: DirectorTradeDecision): d is DirectorTradePick {
  return 'side' in d;
}

const KNOWN: ReadonlySet<string> = new Set(['guild', 'truce', 'anyone']);

function mapForecast(reason: AutoTradeRefuse | undefined): DirectorSkipReason {
  if (reason === 'limit') return 'autotrade_limit';
  if (
    reason === 'tier' ||
    reason === 'partner' ||
    reason === 'truce_disabled' ||
    reason === 'no_limit' ||
    reason === 'no_surplus'
  ) {
    return reason;
  }
  return 'not_authorized';
}

/** The first `withinAutoTrade` rule that fails, in that function's order. */
function refuse(input: AutoTradeForecastInput): DirectorSkipReason {
  const limit = input.limit!;
  if (!KNOWN.has(input.partner)) return 'partner';
  if (limit.partners === 'guild' && input.partner !== 'guild') return 'partner';
  if (limit.partners === 'truce' && input.partner !== 'guild' && input.partner !== 'truce') return 'partner';
  if (input.partner === 'truce' && input.truceEnabled === false) return 'truce_disabled';
  if (input.quantity > limit.maxPerTrade) return 'autotrade_limit';
  if (input.sessionSpent + input.quantity > limit.maxPerSession) return 'session_cap';
  if (input.side === 'buy') return 'autotrade_limit';
  const pct = input.storageCap > 0 ? (input.stock / input.storageCap) * 100 : undefined;
  if (limit.sellAboveStoragePct !== undefined && (pct === undefined || pct < limit.sellAboveStoragePct))
    return 'storage';
  return 'autotrade_limit';
}

/**
 * One director order, or a skip. The amount is the caller's quantity: 400 with max 300 is refused, not clamped.
 * `withinAutoTrade` allows `sessionSpent` 300 + amount 300 against a 600 cap (300 + 300 is not greater than 600).
 */
export function decideDirectorTrade(input: AutoTradeForecastInput): DirectorTradeDecision {
  const forecast = forecastAutoTrade(input);
  if (!input.limit) return { skip: 'no_limit' };
  if (
    !withinAutoTrade(input.limit, orderFor(input, input.side, input.quantity), { truceEnabled: input.truceEnabled })
  ) {
    return { skip: refuse(input) };
  }
  if (!forecast.authorized) return { skip: mapForecast(forecast.reason) };
  if (input.side === 'buy' && forecast.shortage <= 0) return { skip: 'no_shortage' };
  if (input.side === 'sell' && input.quantity > forecast.surplus) return { skip: 'no_surplus' };
  return { side: input.side, resource: input.resource, amount: input.quantity };
}

type Proposal = Omit<AutoTradeForecastInput, 'quantity' | 'side'>;

function sized(input: Proposal, side: 'sell' | 'buy', quantity: number): DirectorTradeDecision {
  return decideDirectorTrade({ ...input, side, quantity });
}

/** Sell `room`, or the surplus when `room` is more than the colony can give. */
function proposeSell(input: Proposal, room: number): DirectorTradeDecision {
  const sell = sized(input, 'sell', room);
  if (isDirectorTrade(sell) || sell.skip !== 'no_surplus') return sell;
  const surplus = forecastAutoTrade({ ...input, side: 'sell', quantity: room }).surplus;
  if (surplus <= 0 || surplus >= room) return sell;
  return sized(input, 'sell', surplus);
}

/** Buy only after a sell refusal, and only for a measured shortage (`potentialBuy` via the forecast). */
function proposeBuy(input: Proposal, room: number, sell: DirectorTradeSkip): DirectorTradeDecision {
  if ((sell.skip !== 'storage' && sell.skip !== 'no_surplus') || input.limit?.buyBelowStock === undefined) return sell;
  const shortage = forecastAutoTrade({ ...input, side: 'buy', quantity: 1 }).shortage;
  if (shortage <= 0) return sell;
  return sized(input, 'buy', Math.min(room, shortage));
}

/**
 * The size the director may ask for: at most one `maxPerTrade`, and only what the session cap still holds.
 * Guild is the partner the forecast input names. A second 300 with `sessionSpent` 300 still fits a 600 cap.
 */
export function proposeDirectorTrade(input: Proposal): DirectorTradeDecision {
  const limit = input.limit;
  if (!limit) return sized(input, 'sell', 0);
  const room = Math.min(limit.maxPerTrade, limit.maxPerSession - input.sessionSpent);
  if (room <= 0) return { skip: 'session_cap' };
  const sell = proposeSell(input, room);
  return isDirectorTrade(sell) ? sell : proposeBuy(input, room, sell);
}

/** Order shape the server re-checks with the same `withinAutoTrade` before it reserves. */
export function directorAutoOrder(input: Proposal, pick: DirectorTradePick): AutoTradeOrder {
  const partner = (KNOWN.has(input.partner) ? input.partner : 'guild') as AutoTradePartner;
  const storagePct = input.storageCap > 0 ? (input.stock / input.storageCap) * 100 : undefined;
  return {
    resource: pick.resource,
    give: pick.amount,
    stock: input.stock,
    sessionSpent: input.sessionSpent,
    partner,
    side: pick.side,
    ...(storagePct !== undefined ? { storagePct, storageCap: input.storageCap } : {}),
  };
}
