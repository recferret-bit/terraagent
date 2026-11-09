import type { TrackLike } from '../market/analytics/marketTracker';

/** Event names of the Colony Deed & Staking feature (W20-26, CLIENT §10.2). */
export const DEED_EVENTS = [
  'deed_viewed',
  'deed_shared',
  'stake_started',
  'stake_completed',
  'stake_cancelled',
  'unstake_started',
  'withdraw_completed',
] as const;

export type DeedEventName = (typeof DEED_EVENTS)[number];

export interface DeedViewEventProps {
  readonly colonyId: string;
  readonly planetId: string;
  readonly tokenId?: string;
  readonly settled?: boolean;
}

export interface DeedShareEventProps {
  readonly colonyId: string;
  readonly planetId: string;
  readonly tokenId?: string;
  readonly channel?: string;
}

export interface StakingEventProps {
  readonly colonyId: string;
  readonly planetId: string;
  readonly pool: string;
  readonly amount: string;
  readonly txHash?: string;
}

/**
 * Consent-gated analytics tracker for Colony Deed & Staking (W20-26).
 * Every event includes `colonyId` and `planetId` as required by the W20-26 acceptance check.
 */
export class DeedTracker {
  constructor(private readonly track: TrackLike | undefined) {}

  deedViewed(p: DeedViewEventProps): void {
    this.track?.('deed_viewed', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      ...(p.tokenId ? { tokenId: p.tokenId } : {}),
      ...(p.settled !== undefined ? { settled: p.settled } : {}),
    });
  }

  deedShared(p: DeedShareEventProps): void {
    this.track?.('deed_shared', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      ...(p.tokenId ? { tokenId: p.tokenId } : {}),
      ...(p.channel ? { channel: p.channel } : {}),
    });
  }

  stakeStarted(p: StakingEventProps): void {
    this.track?.('stake_started', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      pool: p.pool,
      amount: p.amount,
    });
  }

  stakeCompleted(p: StakingEventProps): void {
    this.track?.('stake_completed', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      pool: p.pool,
      amount: p.amount,
      ...(p.txHash ? { txHash: p.txHash } : {}),
    });
  }

  stakeCancelled(p: StakingEventProps): void {
    this.track?.('stake_cancelled', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      pool: p.pool,
      amount: p.amount,
    });
  }

  unstakeStarted(p: StakingEventProps): void {
    this.track?.('unstake_started', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      pool: p.pool,
      amount: p.amount,
    });
  }

  withdrawCompleted(p: StakingEventProps): void {
    this.track?.('withdraw_completed', {
      colonyId: p.colonyId,
      planetId: p.planetId,
      pool: p.pool,
      amount: p.amount,
      ...(p.txHash ? { txHash: p.txHash } : {}),
    });
  }
}
