import { authorizeProposal } from './authorize';
import { compareSupply } from './compare';
import { committedSurplus, reserveShortage } from './position';
import type { AutoTradeForecast, AutoTradeForecastInput } from './types';

/** Surplus, shortage and whether this sell or buy is inside the player's `withinAutoTrade` limit. */
export function forecastAutoTrade(input: AutoTradeForecastInput): AutoTradeForecast {
  const surplus = committedSurplus(input);
  const shortage = reserveShortage(input);
  const decision = authorizeProposal(input, surplus);
  const compared = compareSupply(input, shortage);
  return {
    resource: input.resource,
    partner: input.partner,
    surplus,
    shortage,
    storagePct: input.storageCap > 0 ? (input.stock / input.storageCap) * 100 : 0,
    authorized: decision.authorized,
    ...(decision.reason ? { reason: decision.reason } : {}),
    remedies: compared.remedies,
    ...(compared.preference ? { preference: compared.preference } : {}),
  };
}
