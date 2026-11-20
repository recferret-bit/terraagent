import { readActivePilot } from '../../game/features/achievements/activePilot';
import { FeePill, StakingPill } from '../../game/features/shared/stakingPill/pill';
import type { TradeClient } from '../api/client';
import type { TradeState } from '../model/state';
import { StakeProfitsControl, type NearMode } from './stakeProfitsView';

export interface TradeStakingDeps {
  readonly client: TradeClient;
  readonly mode: () => NearMode;
  /** After a real stake the page reloads balances. */
  readonly reloadBalances: () => void;
  readonly accountId?: () => string | null;
}

const ownAccountId = (): string | null => {
  const p = readActivePilot();
  return p && p.isGuest !== true ? (p.accountId ?? null) : null;
};

/** W28-11 trade header: `⚡ TIER N · APY` pill, taker-fee pill (warmup countdown) and the `[⚡ Stake Trade Profits]` control. */
export class TradeStaking {
  readonly pill: StakingPill;
  readonly fee = new FeePill();
  readonly profits: StakeProfitsControl;

  constructor(private readonly d: TradeStakingDeps) {
    const known = d.accountId ?? ownAccountId;
    // a dev / session pilot without a stored account: the perks answer names the session's linked wallet
    let sessionWallet: string | null = null;
    const accountId = (): string | null => known() ?? sessionWallet;
    this.pill = new StakingPill({
      doFetch: d.client.fetchFn(),
      query: () => ({ accountId: accountId(), token: d.client.token }),
      onPerks: (perks, wallet) => {
        if (wallet) sessionWallet = wallet;
        this.fee.update(perks);
      },
    });
    this.profits = new StakeProfitsControl({
      doFetch: d.client.fetchFn(),
      token: d.client.token,
      accountId,
      mode: d.mode,
      onStaked: () => { void this.pill.refresh(); d.reloadBalances(); },
    });
  }

  refresh(): Promise<void> { return this.pill.refresh(); }

  /** Re-draws the warmup countdown (page tick). */
  tick(): void { this.fee.update(); }

  /** Shows the stake-profits button while the wallet holds free USDC. */
  updateBalances(s: TradeState): void {
    const raw = s.balances?.quote.USDC?.free ?? '0';
    this.profits.update(/^\d+$/.test(raw) ? BigInt(raw) : 0n);
  }
}
