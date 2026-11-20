import { randomUUID } from 'node:crypto';
import { CoreException } from '../../core/errors/index.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { PROTOCOL_STAKING_ACCOUNT_ID, nearToYocto } from './yocto.js';

export type StakingWalletTxAction =
  | 'stake_payable'
  | 'deposit_near'
  | 'claim_native_near'
  | 'stake_lst'
  | 'withdraw_lst'
  | 'compound_yield';

export type StakingWalletMethodName = StakingWalletTxAction | 'ft_transfer_call';

const WALLET_TX_ACTIONS: ReadonlySet<string> = new Set<StakingWalletTxAction>([
  'stake_payable',
  'deposit_near',
  'claim_native_near',
  'stake_lst',
  'withdraw_lst',
  'compound_yield',
]);

/** Sim validator APY the contract accepts from a non-operator caller (`<= 1000 bp`). */
const WALLET_TX_APY_BP = 900;

export interface StakingWalletTxDescriptor {
  readonly contractId: string;
  readonly methodName: StakingWalletMethodName;
  readonly args: Record<string, unknown>;
  readonly attachedDepositYocto: string;
  readonly gasTgas: number;
}

export interface StakingWalletTxQuery {
  readonly action?: string;
  readonly poolId?: string;
  readonly amountNear?: string;
  readonly accountId?: string;
  readonly lstContract?: string;
}

const WHITELISTED_LST_CONTRACTS = new Set([
  'meta-pool.near',
  'meta-v2.pool.testnet',
  'linear-protocol.near',
  'linear-protocol.testnet',
  'rnear.near',
  'rnear.testnet',
]);

export function resolveStakingContractId(env?: Record<string, string | undefined>): string {
  const source = env ?? process.env;
  const kind = nearAdapterFor('Staking', source);
  if (kind === 'mock') {
    return source.NEAR_CONTRACT_STAKING?.trim() || PROTOCOL_STAKING_ACCOUNT_ID;
  }
  return resolveNearNetworkConfig(source, kind === 'mainnet' ? 'mainnet' : 'testnet').contracts.staking;
}

function resolveLstContract(raw: string | undefined, kind: string): string {
  const defaultLst = kind === 'testnet' ? 'meta-v2.pool.testnet' : 'meta-pool.near';
  const lstContract = (raw ?? defaultLst).trim().toLowerCase();
  if (!WHITELISTED_LST_CONTRACTS.has(lstContract)) {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: `Unsupported or unwhitelisted LST contract: ${lstContract}`,
    });
  }
  return lstContract;
}

function requirePool(poolId: string | undefined, action: string): string {
  const pool = (poolId ?? '').trim();
  if (!pool) {
    throw new CoreException('INVALID_REQUEST', { status: 400, message: `poolId is required for ${action}` });
  }
  return pool;
}

/** `compound_yield(pool_id, account_id?, apy_bp, now_ms)`: owner-signed, `0` deposit, rolls 80 % yield into principal. */
function buildCompoundTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  kind: string,
): StakingWalletTxDescriptor {
  const defaultPool = kind === 'testnet' ? 'astro-stakers.pool.testnet' : 'astro-stakers.poolv1.near';
  return {
    contractId,
    methodName: 'compound_yield',
    args: {
      pool_id: requirePool(query.poolId ?? defaultPool, 'compound_yield'),
      apy_bp: WALLET_TX_APY_BP,
      now_ms: Date.now(),
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: '0',
    gasTgas: 60,
  };
}

/** `withdraw_lst(pool_id, lst_contract, amount, account_id?)`: owner-signed 1-step LST payout, `0` deposit. */
function buildWithdrawLstTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  amountYocto: string,
  kind: string,
): StakingWalletTxDescriptor {
  const lstContract = resolveLstContract(query.lstContract, kind);
  return {
    contractId,
    methodName: 'withdraw_lst',
    args: {
      pool_id: (query.poolId ?? lstContract).trim() || lstContract,
      lst_contract: lstContract,
      amount: amountYocto,
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: '0',
    gasTgas: 80,
  };
}

export function buildStakingWalletTxDescriptor(
  query: StakingWalletTxQuery,
  env?: Record<string, string | undefined>,
): StakingWalletTxDescriptor {
  const source = env ?? process.env;
  const kind = nearAdapterFor('Staking', source);
  const rawAction = (query.action ?? 'stake_payable').trim();
  if (!WALLET_TX_ACTIONS.has(rawAction)) {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: `Unsupported staking wallet tx action: ${rawAction}`,
    });
  }
  const amountNear = (query.amountNear ?? '10').trim();
  const amountYocto = nearToYocto(amountNear);
  const contractId = resolveStakingContractId(source);
  const accountId = query.accountId?.trim() || undefined;
  if (rawAction === 'compound_yield') return buildCompoundTx(query, contractId, accountId, kind);
  if (rawAction === 'withdraw_lst') return buildWithdrawLstTx(query, contractId, accountId, amountYocto, kind);
  if (rawAction === 'claim_native_near') {
    return {
      contractId,
      methodName: 'claim_native_near',
      args: { amount: amountYocto, ...(accountId ? { recipient_id: accountId } : {}) },
      attachedDepositYocto: '0',
      gasTgas: 35,
    };
  }
  if (rawAction === 'deposit_near') {
    return {
      contractId,
      methodName: 'deposit_near',
      args: accountId ? { account_id: accountId } : {},
      attachedDepositYocto: amountYocto,
      gasTgas: 30,
    };
  }
  if (rawAction === 'stake_lst') {
    const lstContract = resolveLstContract(query.lstContract, kind);
    const poolId = (query.poolId ?? lstContract).trim() || lstContract;
    return {
      contractId: lstContract,
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: contractId,
        amount: amountYocto,
        msg: JSON.stringify({ pool_id: poolId, ...(accountId ? { account_id: accountId } : {}) }),
      },
      attachedDepositYocto: '1',
      gasTgas: 60,
    };
  }
  const defaultPool = kind === 'testnet' ? 'astro-stakers.pool.testnet' : 'astro-stakers.poolv1.near';
  const poolId = (query.poolId ?? defaultPool).trim();
  if (!poolId) {
    throw new CoreException('INVALID_REQUEST', { status: 400, message: 'poolId is required for stake_payable' });
  }
  return {
    contractId,
    methodName: 'stake_payable',
    args: {
      op_id: `wallet-stake-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      pool_id: poolId,
      apy_bp: WALLET_TX_APY_BP,
      now_ms: Date.now(),
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: amountYocto,
    gasTgas: 45,
  };
}
