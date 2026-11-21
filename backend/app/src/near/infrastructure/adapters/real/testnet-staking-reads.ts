import type { ChainReceipt, NearNetwork } from '../../../domain/types.js';
import type { StakingAssetKind, StakingPositionView } from '../../../application/ports/staking.port.js';
import { isMethodNotFoundRpcError, LST_CONTRACTS, lstContractFor, resolveLstPoolView } from '../../../staking/lst-pools.js';
import type { ContractCallParams } from '../../rpc/near-rpc.client.js';
import { classifyStakingRpcFailure, isUnknownAccountError, StakingRpcError } from './staking-rpc-error.js';

export { isMethodNotFoundRpcError, LST_CONTRACTS, lstContractFor, resolveLstPoolView };

/** The slice of `NearRpcClient` the staking adapter needs; a fake implements it in tests (no real transaction is ever sent). */
export interface StakingRpc {
  readonly network: Exclude<NearNetwork, 'mock'>;
  readonly config: {
    readonly contracts: { readonly staking: string };
    readonly accounts: { readonly minter: string };
    readonly secrets: { readonly minterSecretKey?: string | undefined };
  };
  view<T>(contractId: string, methodName: string, args?: Record<string, unknown>): Promise<T>;
  call(params: ContractCallParams): Promise<{ receipt: ChainReceipt; outcome: unknown }>;
  accountBalanceYocto(accountId: string): Promise<string>;
}

const assetOfContract = (network: 'testnet' | 'mainnet', raw: string): StakingAssetKind => {
  if (raw === 'NEAR') return 'near';
  return raw === LST_CONTRACTS[network].LiNEAR ? 'LiNEAR' : 'stNEAR';
};

/** The wallet's real liquid NEAR (`view_account` amount, exact yocto). An unknown account holds `0`; any other failure throws. */
export async function readWalletNearYocto(rpc: StakingRpc, accountId: string): Promise<string> {
  try {
    return await rpc.accountBalanceYocto(accountId);
  } catch (err) {
    if (isUnknownAccountError(err)) return '0';
    throw classifyStakingRpcFailure(err, { operation: 'view_account', accountId });
  }
}

/** The wallet's LST balance in share units (`ft_balance_of`); a malformed answer throws `invalid_response`. */
export async function readLstBalance(rpc: StakingRpc, lstContract: string, accountId: string): Promise<string> {
  let raw: unknown;
  try {
    raw = await rpc.view<unknown>(lstContract, 'ft_balance_of', { account_id: accountId });
  } catch (err) {
    if (isUnknownAccountError(err)) return '0';
    throw classifyStakingRpcFailure(err, { operation: 'ft_balance_of', accountId, contractId: lstContract });
  }
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new StakingRpcError('invalid_response', `ft_balance_of returned ${JSON.stringify(raw)}`, { operation: 'ft_balance_of', accountId, contractId: lstContract });
  }
  return raw;
}

export interface ContractAccountPosition {
  readonly account_id: string;
  readonly pool_id: string;
  readonly asset: string;
  readonly staked: string;
  readonly unbonding: string;
  readonly unbonding_ready_at_ms: number | null;
  readonly withdrawable: string;
  readonly rewards: string;
  readonly staked_since_ms: number | null;
  readonly last_staked_at_ms: number | null;
}

/** Maps one `get_account_positions` entry to the port view (clocks of `0` mean none, like the contract's cleared meta). */
export function mapAccountPosition(view: ContractAccountPosition, network: 'testnet' | 'mainnet'): StakingPositionView {
  return {
    accountId: view.account_id,
    pool: view.pool_id,
    staked: view.staked,
    unbonding: view.unbonding,
    unbondingReadyAtMs: view.unbonding_ready_at_ms,
    withdrawable: view.withdrawable,
    rewards: view.rewards,
    stakedSinceMs: view.staked_since_ms ? view.staked_since_ms : null,
    lastStakedAtMs: view.last_staked_at_ms ? view.last_staked_at_ms : null,
    asset: assetOfContract(network, view.asset),
  };
}

/**
 * The final value of a transaction: the `SuccessValue` of its outcome (for `withdraw` that is the `on_withdraw` callback's
 * result, because the payout is a Promise). `undefined` when the outcome carries no JSON value.
 */
export function finalValueOf<T>(outcome: unknown): T | undefined {
  const status = (outcome as { status?: unknown } | null)?.status;
  const b64 = typeof status === 'object' && status !== null && 'SuccessValue' in status ? (status as { SuccessValue?: unknown }).SuccessValue : undefined;
  if (typeof b64 !== 'string' || b64.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as T;
  } catch (err) {
    throw new StakingRpcError('invalid_response', 'transaction result is not JSON', { operation: 'final_value', cause: err });
  }
}
