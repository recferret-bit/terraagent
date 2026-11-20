import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  CompoundInput,
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
import { isW28Enabled } from '../../../staking/perks/legacy-ladder.js';
import { rpcApyProbe } from './chain-apy-probe.js';
import { OpReceiptCache } from './op-receipt-cache.js';
import { classifyStakingRpcFailure, isUnknownAccountError, StakingRpcError } from './staking-rpc-error.js';
import {
  finalValueOf,
  lstContractFor,
  mapAccountPosition,
  readLstBalance,
  readWalletNearYocto,
  type ContractAccountPosition,
  type StakingRpc,
} from './testnet-staking-reads.js';
import { ValidatorApyReader, type ApyProbe, type ValidatorApy } from './validator-apy.js';

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
  private readonly rpc: StakingRpc;
  private readonly apy: ValidatorApyReader;
  private readonly cache = new OpReceiptCache<ChainReceipt>();
  private localOffsetMs = 0;
  private creditSeq = 0;

  /** `rpc` / `apyProbe` are test seams (a fake RPC, so no test ever sends a transaction); Nest passes only `env`. */
  constructor(
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() rpc?: StakingRpc,
    @Optional() apyProbe?: ApyProbe,
  ) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    const client = rpc ? null : new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('Staking', source)));
    this.rpc = rpc ?? (client as NearRpcClient);
    this.apy = new ValidatorApyReader(apyProbe ?? rpcApyProbe(client as NearRpcClient), () => Date.now());
  }

  /** Surfaces a typed staking RPC failure as the API's `NEAR_UNAVAILABLE` exception (never a silent fallback value). */
  private async typed<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      throw err instanceof StakingRpcError ? err.toNearException() : err;
    }
  }

  private get lstNetwork(): 'testnet' | 'mainnet' {
    return this.rpc.network === 'mainnet' ? 'mainnet' : 'testnet';
  }

  /** Staking clock (wall time plus the dev warp, which real adapters only apply to the `now_ms` they send). */
  clockNowMs(): number {
    return this.nowMs();
  }

  /** Trailing validator APY (`live`), the last good one (`cached`) or the `Sim APY` constant (`sim`), always flagged. */
  validatorApy(): Promise<ValidatorApy> {
    return this.apy.read();
  }

  advanceGameDays(days: number): void {
    if (Number.isFinite(days) && days > 0) {
      this.localOffsetMs += Math.floor(days * GAME_DAY_MS);
    }
  }

  /**
   * With `W28` on: the wallet's real liquid NEAR (`view_account`, exact yocto), which is what a wallet-signed
   * `stake_payable` spends. With it off: the custodial vault balance of the W20 operator-staked path.
   * RPC failures are typed errors, never a silent `0`; an account the node does not know holds `0`.
   */
  async nearBalanceOf(accountId: string): Promise<string> {
    if (isW28Enabled((this.env ?? process.env) as Record<string, string | undefined>)) {
      return this.typed(() => readWalletNearYocto(this.rpc, accountId));
    }
    try {
      return (await this.rpc.view<string>(this.rpc.config.contracts.staking, 'get_near_balance', { account_id: accountId })) || '0';
    } catch (err) {
      if (isUnknownAccountError(err)) return '0';
      throw classifyStakingRpcFailure(err, { operation: 'get_near_balance', accountId, contractId: this.rpc.config.contracts.staking }).toNearException();
    }
  }

  /** The wallet's `stNEAR` / `LiNEAR` balance in share units (`ft_balance_of`). */
  async lstBalanceOf(accountId: string, asset: 'stNEAR' | 'LiNEAR'): Promise<string> {
    return this.typed(() => readLstBalance(this.rpc, lstContractFor(this.lstNetwork, asset), accountId));
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
      const lst = input.asset && input.asset !== 'near' ? input.asset : null;
      const { receipt, outcome } = lst
        ? await this.withdrawLst(input, pool, lst, signer)
        : await this.rpc.call({
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
      // The payout is a Promise: the transaction's final value is `on_withdraw`'s result, and a failed transfer is rolled back
      // there as a SUCCESSFUL outcome with `withdrawn: "0"`. Treating that as success would report a payout that never happened.
      const result = finalValueOf<{ withdrawn?: string }>(outcome);
      if (result?.withdrawn === '0') {
        throw new StakingRpcError('withdraw_rolled_back', 'the payout transfer failed and the position was restored; retry', {
          operation: 'withdraw',
          accountId: input.accountId,
          contractId: this.rpc.config.contracts.staking,
        }).toNearException();
      }
      return receipt;
    });
  }

  /** LST pools pay out in one transaction through `withdraw_lst` (`ft_transfer` of the matured shares to the wallet). */
  private async withdrawLst(
    input: WithdrawInput,
    pool: StakingPoolView,
    asset: 'stNEAR' | 'LiNEAR',
    signer: { accountId: string; secretKey: string },
  ) {
    const view = await this.position({ accountId: input.accountId, pool: pool.poolId });
    const amount = BigInt(view.withdrawable);
    if (amount <= 0n) throw new NearException('NOTHING_TO_WITHDRAW', { details: { accountId: input.accountId, pool: pool.poolId } });
    return this.rpc.call({
      signerAccountId: signer.accountId,
      signerSecretKey: signer.secretKey,
      contractId: this.rpc.config.contracts.staking,
      methodName: 'withdraw_lst',
      args: {
        pool_id: pool.poolId,
        lst_contract: lstContractFor(this.lstNetwork, asset),
        amount: amount.toString(),
        account_id: input.accountId,
        recipient_id: input.toAccountId ?? null,
      },
    });
  }

  /** W28 `compound_yield`: accrued yield becomes principal (`0 %` fee, deposit clocks untouched). `STAKE_NO_YIELD` maps to `NOTHING_TO_COMPOUND`. */
  async compound(raw: CompoundInput): Promise<ChainReceipt> {
    const input = CompoundInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const signer = this.requireOperatorSigner();
    return this.cache.run(`compound:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.staking,
        methodName: 'compound_yield',
        args: { pool_id: pool.poolId, account_id: input.accountId, apy_bp: pool.apyBp, now_ms: this.nowMs() },
      });
      return receipt;
    });
  }

  /** W28 `get_account_positions`: every pool position of the wallet with its deposit clocks and asset. */
  async accountPositions(accountId: string): Promise<readonly StakingPositionView[]> {
    const pools = this.resolvePools();
    let rows: ContractAccountPosition[];
    try {
      rows = await this.rpc.view<ContractAccountPosition[]>(this.rpc.config.contracts.staking, 'get_account_positions', {
        account_id: accountId,
        apy_bp: pools[0]?.apyBp ?? null,
        now_ms: this.nowMs(),
      });
    } catch (err) {
      throw classifyStakingRpcFailure(err, { operation: 'get_account_positions', accountId, contractId: this.rpc.config.contracts.staking }).toNearException();
    }
    if (!Array.isArray(rows)) {
      throw new StakingRpcError('invalid_response', 'get_account_positions did not return a list', { operation: 'get_account_positions', accountId }).toNearException();
    }
    return rows.map((r) => StakingPositionView.parse(mapAccountPosition(r, this.lstNetwork)));
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
    // The deposit clocks come from the V2 contract's `get_account_positions`; with W28 off the V1 contract is assumed.
    const clocks = isW28Enabled((this.env ?? process.env) as Record<string, string | undefined>)
      ? (await this.accountPositions(input.accountId)).find((p) => p.pool === pool.poolId)
      : undefined;
    return StakingPositionView.parse({
      accountId: view.account_id,
      pool: view.pool_id,
      staked: view.staked,
      unbonding: view.unbonding,
      unbondingReadyAtMs: view.unbonding_ready_at_ms,
      withdrawable: view.withdrawable,
      rewards: view.rewards,
      ...(clocks ? { stakedSinceMs: clocks.stakedSinceMs, lastStakedAtMs: clocks.lastStakedAtMs, asset: clocks.asset } : {}),
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
