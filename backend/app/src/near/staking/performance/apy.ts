import { STAKING_RULES, type ApyView } from '@terra/contracts';

/** Optional trailing validator APY read (bp). Only a real RPC read may be wired here; `null` = unavailable. */
export const VALIDATOR_APY_READER = Symbol('W28_VALIDATOR_APY_READER');
export type ValidatorApyReader = () => Promise<number | null> | number | null;

/**
 * `live` only on mainnet with a real validator APY read; every other case is the simulated
 * `STAKING_RULES.simGrossApyBp` (badged `Sim APY`). The net APY is the gross minus the protocol yield share.
 */
export function buildApyView(network: 'mock' | 'testnet' | 'mainnet', liveGrossBp: number | null): ApyView {
  const live = network === 'mainnet' && liveGrossBp !== null && Number.isFinite(liveGrossBp) && liveGrossBp > 0;
  const grossApyBp = live ? Math.round(liveGrossBp as number) : STAKING_RULES.simGrossApyBp;
  const protocolYieldShareBp = STAKING_RULES.protocolYieldShareBp;
  const netApyBp = grossApyBp - Math.floor((grossApyBp * protocolYieldShareBp) / 10_000);
  return { grossApyBp, netApyBp, protocolYieldShareBp, source: live ? 'live' : 'sim' };
}
