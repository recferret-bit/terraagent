import type { StakingPort } from '../../application/ports/staking.port.js';

/** Test / dev hooks the mock and in-memory adapters expose next to the port (real adapters have none of them). */
export interface StakingPortHooks {
  creditNear?(accountId: string, yoctoAmount: string): Promise<void>;
  nearBalanceOf?(accountId: string): Promise<string>;
  advanceClockMs?(deltaMs: number): void;
  advanceGameDays?(days: number): void;
}

export const portHooks = (staking: StakingPort): StakingPortHooks => staking as unknown as StakingPortHooks;

/** The staking clock: adapters with a dev warp expose theirs, every other adapter runs on wall time. */
export const stakingNowMs = (staking: StakingPort): number => staking.clockNowMs?.() ?? Date.now();
