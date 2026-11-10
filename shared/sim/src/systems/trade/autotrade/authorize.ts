import type { AutoTradeOrder, AutoTradePartner } from '@terra/contracts';
import { withinAutoTrade } from '../../away/auto-trade';
import { isTier1AutoTradeKey } from './tier';
import type { AutoTradeForecastInput, AutoTradeRefuse } from './types';

const KNOWN: ReadonlySet<string> = new Set(['guild', 'truce', 'anyone']);

export function orderFor(input: AutoTradeForecastInput, side: 'sell' | 'buy', quantity: number): AutoTradeOrder {
  const storagePct = input.storageCap > 0 ? (input.stock / input.storageCap) * 100 : undefined;
  return {
    resource: input.resource,
    give: quantity,
    stock: input.stock,
    sessionSpent: input.sessionSpent,
    partner: input.partner as AutoTradePartner,
    side,
    ...(storagePct !== undefined ? { storagePct, storageCap: input.storageCap } : {}),
  };
}

function refuseReason(input: AutoTradeForecastInput): AutoTradeRefuse {
  if (!KNOWN.has(input.partner)) return 'partner';
  if (input.partner === 'truce' && input.truceEnabled === false) return 'truce_disabled';
  return 'limit';
}

/** The proposal, judged by `withinAutoTrade`. A missing limit is not a trade. A sell cannot spend committed surplus. */
export function authorizeProposal(input: AutoTradeForecastInput, surplus: number): { authorized: boolean; reason?: AutoTradeRefuse } {
  if (input.tier1Only !== false && !isTier1AutoTradeKey(input.resource)) return { authorized: false, reason: 'tier' };
  if (!input.limit) return { authorized: false, reason: 'no_limit' };
  if (!withinAutoTrade(input.limit, orderFor(input, input.side, input.quantity), { truceEnabled: input.truceEnabled })) {
    return { authorized: false, reason: refuseReason(input) };
  }
  if (input.side === 'sell' && input.quantity > surplus) return { authorized: false, reason: 'no_surplus' };
  return { authorized: true };
}

/** Whether buying `qty` of this resource is inside the player's limit. No limit, no buy. */
export function buyAuthorized(input: AutoTradeForecastInput, qty: number): boolean {
  if (input.tier1Only !== false && !isTier1AutoTradeKey(input.resource)) return false;
  if (!input.limit) return false;
  return withinAutoTrade(input.limit, orderFor(input, 'buy', qty), { truceEnabled: input.truceEnabled });
}
