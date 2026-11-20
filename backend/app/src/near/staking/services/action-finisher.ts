import type { StakingPositionDto } from '@terra/contracts';
import { StakingPort } from '../../application/ports/staking.port.js';
import type { StakingPositionSyncService } from '../staking-position-sync.service.js';

/** Hands out the per-process nonce that makes an unsigned action's op id unique. */
export class OpNonce {
  private counter = 0;

  next(): string {
    return String(++this.counter);
  }
}

/** Shared tail of every staking action: sync the read model, answer with the pool's position (or an empty fallback). */
export class ActionFinisher {
  constructor(
    private readonly staking: StakingPort,
    private readonly positionSync: StakingPositionSyncService,
  ) {}

  /** The synced position of `poolId`, or an empty row when the read model has none (a fully emptied position). */
  async positionAfter(accountId: string, poolId: string, colonyId?: string): Promise<StakingPositionDto> {
    const synced = await this.positionSync.syncAccount(accountId, {
      ...(colonyId ? { colonyId } : { wallet: true }),
      pool: poolId,
    });
    if (synced && synced.pool === poolId) return synced;
    return this.fallback(accountId, poolId, colonyId);
  }

  async fallback(accountId: string, poolId: string, colonyId?: string): Promise<StakingPositionDto> {
    const pools = await this.staking.listPools();
    const poolInfo = pools.find((p) => p.poolId === poolId);
    return {
      ...(colonyId ? { colonyId } : {}),
      accountId,
      pool: poolId,
      ...(poolInfo ? { poolName: poolInfo.name, apyBp: poolInfo.apyBp } : {}),
      staked: '0',
      unbonding: '0',
      unbondingReadyAtMs: null,
      withdrawable: '0',
      rewards: '0',
      updatedAt: Date.now(),
    };
  }
}
