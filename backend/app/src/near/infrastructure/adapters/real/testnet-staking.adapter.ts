import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  PositionInput,
  RewardsInput,
  type RewardsResult,
  StakeInput,
  StakingPoolView,
  StakingPort,
  StakingPositionView,
  UnstakeInput,
  WithdrawInput,
} from '../../../application/ports/staking.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { parseStakingPoolsConfig } from '../../../staking/staking-pools.config.js';
import { GAME_DAY_MS } from '../../../staking/yocto.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface ContractPositionView {
  readonly account_id: string;
  readonly pool_id: string;
  readonly staked: string;
  readonly unbonding: string;
  readonly unbonding_ready_at_ms: number | null;
  readonly withdrawable: string;
  readonly rewards: string;
}

/**
 * Real NEAR Testnet `StakingPort`: delegates validator pool staking, 4-epoch unbonding,
 * and APY reward accrual to `staking.<root>.testnet`.
 */
@Injectable()
export class TestnetStakingAdapter implements StakingPort {
  private readonly rpc: NearRpcClient;
  private readonly cache = new OpReceiptCache<ChainReceipt>();
  private localOffsetMs = 0;
  private creditSeq = 0;

  constructor(@Optional() @Inject(APP_ENV) private readonly env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('Staking', source)));
  }

  advanceGameDays(days: number): void {
    if (Number.isFinite(days) && days > 0) {
      this.localOffsetMs += Math.floor(days * GAME_DAY_MS);
    }
  }

  async nearBalanceOf(accountId: string): Promise<string> {
    try {
      const vaultBal = await this.rpc.view<string>(this.rpc.config.contracts.staking, 'get_near_balance', {
        account_id: accountId,
      });
      return vaultBal || '0';
    } catch {
      return '0';
    }
  }

  async creditNear(accountId: string, yoctoAmount: string, opId?: string): Promise<void> {
    const signer = this.requireOperatorSigner();
    const effectiveOpId = opId?.trim() || `credit:${accountId}:${yoctoAmount}:${++this.creditSeq}`;
    await this.rpc.call({
      signerAccountId: signer.accountId,
      signerSecretKey: signer.secretKey,
      contractId: this.rpc.config.contracts.staking,
      methodName: 'credit_near',
      args: { op_id: effectiveOpId, account_id: accountId, amount: yoctoAmount },
    });
  }

  private nowMs(): number {
    return Date.now() + this.localOffsetMs;
  }

  private resolvePools(): readonly StakingPoolView[] {
    const bag = this.env as Record<string, string | undefined> | undefined;
    return parseStakingPoolsConfig(bag?.NEAR_STAKING_POOLS ?? process.env.NEAR_STAKING_POOLS, {
      ...(bag ?? process.env),
      NEAR_ADAPTER_STAKING: this.rpc.network,
    });
  }

  private assertPoolWhitelisted(poolId: string): StakingPoolView {
    const found = this.resolvePools().find((p) => p.poolId === poolId);
    if (!found) {
      throw new NearException('POOL_NOT_WHITELISTED', { details: { pool: poolId } });
    }
    return found;
  }

  async listPools(): Promise<readonly StakingPoolView[]> {
    return this.resolvePools();
  }

  async stake(raw: StakeInput): Promise<ChainReceipt> {
    const input = StakeInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    if (BigInt(input.amount) <= 0n) {
      throw new NearException('STAKE_INSUFFICIENT_BALANCE', { message: 'Stake amount must be greater than zero.' });
    }
    const signer = this.requireOperatorSigner();
    return this.cache.run(`stake:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.staking,
        methodName: 'stake',
        args: {
          op_id: input.opId,
          account_id: input.accountId,
          payer_id: input.walletAccountId ?? null,
          pool_id: pool.poolId,
          apy_bp: pool.apyBp,
          amount: input.amount,
          now_ms: this.nowMs(),
        },
      });
      return receipt;
    });
  }

  async unstake(raw: UnstakeInput): Promise<ChainReceipt> {
    const input = UnstakeInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    if (BigInt(input.amount) <= 0n) {
      throw new NearException('STAKE_INSUFFICIENT_BALANCE', { message: 'Unstake amount must be greater than zero.' });
    }
    const signer = this.requireOperatorSigner();
    return this.cache.run(`unstake:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.staking,
        methodName: 'unstake',
        args: {
          op_id: input.opId,
          account_id: input.accountId,
          pool_id: pool.poolId,
          apy_bp: pool.apyBp,
          amount: input.amount,
          now_ms: this.nowMs(),
        },
      });
      return receipt;
    });
  }

  async withdraw(raw: WithdrawInput): Promise<ChainReceipt> {
    const input = WithdrawInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const signer = this.requireOperatorSigner();
    return this.cache.run(`withdraw:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.staking,
        methodName: 'withdraw',
        args: {
          op_id: input.opId,
          account_id: input.accountId,
          recipient_id: input.toAccountId ?? null,
          pool_id: pool.poolId,
          apy_bp: pool.apyBp,
          now_ms: this.nowMs(),
        },
      });
      return receipt;
    });
  }

  async rewards(raw: RewardsInput): Promise<RewardsResult> {
    const input = RewardsInput.parse(raw);
    const pos = await this.position(input);
    return { accrued: pos.rewards };
  }

  async position(raw: PositionInput): Promise<StakingPositionView> {
    const input = PositionInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const view = await this.rpc.view<ContractPositionView>(this.rpc.config.contracts.staking, 'get_position', {
      account_id: input.accountId,
      pool_id: pool.poolId,
      apy_bp: pool.apyBp,
      now_ms: this.nowMs(),
    });
    return StakingPositionView.parse({
      accountId: view.account_id,
      pool: view.pool_id,
      staked: view.staked,
      unbonding: view.unbonding,
      unbondingReadyAtMs: view.unbonding_ready_at_ms,
      withdrawable: view.withdrawable,
      rewards: view.rewards,
    });
  }

  private requireOperatorSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for StakingPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: StakingPort, kind: 'testnet', useClass: TestnetStakingAdapter });
export const mainnetAdapter = adapterOf({ port: StakingPort, kind: 'mainnet', useClass: TestnetStakingAdapter });
