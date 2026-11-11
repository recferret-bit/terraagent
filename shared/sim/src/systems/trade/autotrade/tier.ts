import type { ResourceKey } from '@terra/contracts';

/** Vertical-slice keys (W15-23). T2/T3 stay on the schema; the forecast refuses them unless `tier1Only` is false. */
export const TIER1_AUTO_TRADE_KEYS = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const satisfies readonly ResourceKey[];

const TIER1: ReadonlySet<string> = new Set(TIER1_AUTO_TRADE_KEYS);

export const isTier1AutoTradeKey = (key: string): boolean => TIER1.has(key);

export const AUTO_TRADE_BLOB = 'autoTrade';
