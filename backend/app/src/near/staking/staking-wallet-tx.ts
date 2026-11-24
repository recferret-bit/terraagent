import { randomUUID } from 'node:crypto';
import { CoreException } from '../../core/errors/index.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { parseStakingPoolsConfig } from './staking-pools.config.js';
import { PROTOCOL_STAKING_ACCOUNT_ID, nearToYocto } from './yocto.js';

export type StakingWalletTxAction =
  | 'stake_payable'
  | 'unstake'
  | 'withdraw'
  | 'deposit_near'
  | 'claim_native_near'
  | 'stake_lst'
  | 'deposit_and_stake_lst'
  | 'withdraw_lst'
  | 'compound_yield';

export type StakingWalletMethodName = StakingWalletTxAction | 'ft_transfer_call';

const WALLET_TX_ACTIONS: ReadonlySet<string> = new Set<StakingWalletTxAction>([
  'stake_payable',
  'unstake',
  'withdraw',
  'deposit_near',
  'claim_native_near',
  'stake_lst',
  'deposit_and_stake_lst',
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
  'meta-pool.mock',
  'linear-protocol.near',
  'linear-protocol.testnet',
  'linear-protocol.mock',
  'rnear.near',
  'rnear.testnet',
  'rnear.mock',
]);

const LST_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = {
  mock: new Set(['meta-pool.mock', 'linear-protocol.mock', 'rnear.mock']),
  testnet: new Set(['meta-v2.pool.testnet', 'linear-protocol.testnet', 'rnear.testnet']),
  mainnet: new Set(['meta-pool.near', 'linear-protocol.near', 'rnear.near']),
};

export function resolveStakingContractId(env?: Record<string, string | undefined>): string {
  const source = env ?? process.env;
  const kind = nearAdapterFor('Staking', source);
  if (kind === 'mock') {
    return source.NEAR_CONTRACT_STAKING?.trim() || PROTOCOL_STAKING_ACCOUNT_ID;
  }
  return resolveNearNetworkConfig(source, kind === 'mainnet' ? 'mainnet' : 'testnet').contracts.staking;
}

function defaultNativePoolFor(kind: string): string {
  if (kind === 'mock') return 'astro-stakers.pool.mock';
  if (kind === 'testnet') return 'astro-stakers.pool.testnet';
  return 'astro-stakers.poolv1.near';
}

function resolveLstContract(raw: string | undefined, kind: string): string {
  const defaultLst = kind === 'mock' ? 'meta-pool.mock' : kind === 'testnet' ? 'meta-v2.pool.testnet' : 'meta-pool.near';
  const lstContract = (raw ?? defaultLst).trim().toLowerCase();
  const allowed = LST_BY_KIND[kind] ?? WHITELISTED_LST_CONTRACTS;
  if (!allowed.has(lstContract)) {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: `Unsupported or unwhitelisted LST contract for ${kind}: ${lstContract}`,
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

function requireAccount(accountId: string | undefined, action: string): string {
  const id = (accountId ?? '').trim();
  if (!id) {
    throw new CoreException('INVALID_REQUEST', { status: 400, message: `accountId is required for ${action}` });
  }
  return id;
}

function isNativeValidatorPool(poolId: string, source: Record<string, string | undefined>, kind: string): boolean {
  const lower = poolId.toLowerCase();
  if (WHITELISTED_LST_CONTRACTS.has(lower)) return false;
  try {
    const pools = parseStakingPoolsConfig(source.NEAR_STAKING_POOLS, { ...source, NEAR_ADAPTER_STAKING: kind });
    if (pools.some((p) => p.poolId.toLowerCase() === lower)) return true;
  } catch {
    // Fallback suffix check if custom env is unset/partial
  }
  return /\.(?:pool|poolv1)\.(?:testnet|near|mock)$/i.test(lower);
}

/** Never routes an LST wallet tx into a native validator pool (`astro-stakers.pool.*`), preventing native/LST collisions. */
function resolveLstPoolId(
  rawPoolId: string | undefined,
  lstContract: string,
  source: Record<string, string | undefined>,
  kind: string,
): string {
  const candidate = (rawPoolId ?? '').trim();
  if (!candidate || isNativeValidatorPool(candidate, source, kind)) return lstContract;
  return candidate;
}

/** `compound_yield(pool_id, account_id?, apy_bp, now_ms)`: owner-signed, `0` deposit, rolls 80 % yield into principal. */
function buildCompoundTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  kind: string,
  source: Record<string, string | undefined>,
): StakingWalletTxDescriptor {
  const defaultPool = defaultNativePoolFor(kind);
  const poolId = query.lstContract
    ? resolveLstPoolId(query.poolId, resolveLstContract(query.lstContract, kind), source, kind)
    : requirePool(query.poolId ?? defaultPool, 'compound_yield');
  const isLst = Boolean(query.lstContract) || WHITELISTED_LST_CONTRACTS.has(poolId.toLowerCase());
  return {
    contractId,
    methodName: 'compound_yield',
    args: {
      pool_id: poolId,
      apy_bp: isLst ? 0 : WALLET_TX_APY_BP,
      now_ms: Date.now(),
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: '0',
    gasTgas: 60,
  };
}

/** `unstake(op_id, account_id, pool_id, apy_bp, amount, now_ms)`: self-custody unbond (`0` deposit, chain block time). */
function buildUnstakeTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  amountYocto: string,
  kind: string,
  source: Record<string, string | undefined>,
): StakingWalletTxDescriptor {
  const owner = requireAccount(accountId, 'unstake');
  const defaultPool = defaultNativePoolFor(kind);
  const poolId = query.lstContract
    ? resolveLstPoolId(query.poolId, resolveLstContract(query.lstContract, kind), source, kind)
    : requirePool(query.poolId ?? defaultPool, 'unstake');
  return {
    contractId,
    methodName: 'unstake',
    args: {
      op_id: `wallet-unstake-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      account_id: owner,
      pool_id: poolId,
      apy_bp: query.lstContract ? 0 : WALLET_TX_APY_BP,
      amount: amountYocto,
      now_ms: Date.now(),
    },
    attachedDepositYocto: '0',
    gasTgas: 45,
  };
}

/** `withdraw(op_id, account_id, recipient_id, pool_id, apy_bp, now_ms)`: self-custody 1-step native NEAR payout (`0` deposit). */
function buildWithdrawTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  kind: string,
): StakingWalletTxDescriptor {
  const owner = requireAccount(accountId, 'withdraw');
  const defaultPool = defaultNativePoolFor(kind);
  return {
    contractId,
    methodName: 'withdraw',
    args: {
      op_id: `wallet-withdraw-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      account_id: owner,
      recipient_id: owner,
      pool_id: requirePool(query.poolId ?? defaultPool, 'withdraw'),
      apy_bp: WALLET_TX_APY_BP,
      now_ms: Date.now(),
    },
    attachedDepositYocto: '0',
    gasTgas: 55,
  };
}

/** `withdraw_lst(pool_id, lst_contract, amount, account_id?)`: owner-signed 1-step LST payout, `0` deposit. */
function buildWithdrawLstTx(
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  amountYocto: string,
  kind: string,
  source: Record<string, string | undefined>,
): StakingWalletTxDescriptor {
  const lstContract = resolveLstContract(query.lstContract, kind);
  return {
    contractId,
    methodName: 'withdraw_lst',
    args: {
      pool_id: resolveLstPoolId(query.poolId, lstContract, source, kind),
      lst_contract: lstContract,
      amount: amountYocto,
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: '0',
    gasTgas: 80,
  };
}

function buildLstWalletTx(
  rawAction: 'stake_lst' | 'deposit_and_stake_lst',
  query: StakingWalletTxQuery,
  contractId: string,
  accountId: string | undefined,
  amountYocto: string,
  kind: string,
  source: Record<string, string | undefined>,
): StakingWalletTxDescriptor {
  if (rawAction === 'deposit_and_stake_lst' && BigInt(amountYocto) < 5_000_000_000_000_000_000_000n) {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: 'amountNear must be at least 0.005 NEAR for deposit_and_stake_lst',
    });
  }
  const lstContract = resolveLstContract(query.lstContract, kind);
  const poolId = resolveLstPoolId(query.poolId, lstContract, source, kind);
  if (rawAction === 'stake_lst') {
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
  const referralId = resolveNearNetworkConfig(source, kind === 'mainnet' ? 'mainnet' : 'testnet').accounts.protocol;
  return {
    contractId,
    methodName: 'deposit_and_stake_lst',
    args: {
      pool_id: poolId,
      lst_contract: lstContract,
      referral_id: referralId,
      ...(accountId ? { account_id: accountId } : {}),
    },
    attachedDepositYocto: amountYocto,
    gasTgas: 95,
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
  let amountYocto: string;
  try {
    amountYocto = nearToYocto(amountNear);
  } catch {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: `Invalid amountNear: ${amountNear || '(empty)'}`,
    });
  }
  if (rawAction !== 'compound_yield' && rawAction !== 'withdraw' && BigInt(amountYocto) <= 0n) {
    throw new CoreException('INVALID_REQUEST', {
      status: 400,
      message: `amountNear must be greater than zero for ${rawAction}`,
    });
  }
  const contractId = resolveStakingContractId(source);
  const accountId = query.accountId?.trim() || undefined;
  if (rawAction === 'compound_yield') return buildCompoundTx(query, contractId, accountId, kind, source);
  if (rawAction === 'unstake') return buildUnstakeTx(query, contractId, accountId, amountYocto, kind, source);
  if (rawAction === 'withdraw') return buildWithdrawTx(query, contractId, accountId, kind);
  if (rawAction === 'withdraw_lst') return buildWithdrawLstTx(query, contractId, accountId, amountYocto, kind, source);
  if (rawAction === 'stake_lst' || rawAction === 'deposit_and_stake_lst') {
    return buildLstWalletTx(rawAction, query, contractId, accountId, amountYocto, kind, source);
  }
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
  const defaultPool = defaultNativePoolFor(kind);
  const poolId = requirePool(query.poolId ?? defaultPool, 'stake_payable');
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
