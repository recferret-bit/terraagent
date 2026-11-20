import { STAKING_RULES } from '@terra/contracts';
import { dbAiUsageReader, type AiUsageReader } from './ai-usage.reader.js';
import type { WalletRef } from './stake-clock.reader.js';

/** `NEAR/USD` source for the dynamic AI cap. W28-05 plugs a cached live price here. */
export interface NearUsdPriceProvider {
  nearUsd(): number | Promise<number>;
}

/** Protocol trade-fee income from a wallet over the current UTC day, USD (the AI cap's "trade bonus"). */
export interface TradeFeeUsdProvider {
  dailyProtocolTradeFeeUsd(wallet: WalletRef, nowMs: number): number | Promise<number>;
}

export interface PerksDeps {
  readonly priceProvider: NearUsdPriceProvider;
  readonly tradeFeeProvider: TradeFeeUsdProvider;
  readonly usageReader: AiUsageReader;
  /**
   * The staking clock (ms). Wall time by default; `StakingService` swaps in the staking port clock so a mock `time.warp`
   * moves the 24h fee warmup and the 7-day exit window for every caller (market fees, AI gate, HUD) at once.
   */
  readonly clock: () => number;
}

/** Defaults: the `Est.` price from the tier table, no trade bonus, and the DB usage reads. */
export const DEFAULT_PERKS_DEPS: PerksDeps = Object.freeze({
  priceProvider: { nearUsd: () => STAKING_RULES.estNearUsd },
  tradeFeeProvider: { dailyProtocolTradeFeeUsd: () => 0 },
  usageReader: dbAiUsageReader,
  clock: () => Date.now(),
});

let current: PerksDeps = DEFAULT_PERKS_DEPS;

/** Process-wide providers used when a call passes none (Nest boot code or tests swap them). */
export function setPerksDeps(partial: Partial<PerksDeps>): void {
  current = { ...current, ...partial };
}

/** Restores wall time when `clock` is still the installed one (a closing Nest app undoes only its own clock). */
export function releasePerksClock(clock: () => number): void {
  if (current.clock === clock) current = { ...current, clock: DEFAULT_PERKS_DEPS.clock };
}

export function resetPerksDeps(): void {
  current = DEFAULT_PERKS_DEPS;
}

/** The staking clock now (see `PerksDeps.clock`). */
export const stakingNowMs = (): number => current.clock();

export function resolvePerksDeps(override?: Partial<PerksDeps>): PerksDeps {
  return override ? { ...current, ...override } : current;
}
