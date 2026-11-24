import { STAKING_RULES } from '@terra/contracts';
import { readSavedNearWallet } from '../../../../design/pilot/nearWalletStorage';
import { sendTxWithInjectedExtraWallet } from '../../../../design/pilot/walletSelectorExtras';
import { createRealSignerWalletSelector, type RealNearNetwork } from './realNearWalletDriver';

export type StakingWalletAction =
  | 'stake_payable'
  | 'unstake'
  | 'withdraw'
  | 'deposit_near'
  | 'claim_native_near'
  | 'stake_lst'
  | 'deposit_and_stake_lst'
  | 'withdraw_lst'
  | 'compound_yield';

export interface StakingWalletTx {
  readonly contractId: string;
  readonly methodName: string;
  readonly args: Record<string, unknown>;
  readonly attachedDepositYocto: string;
  readonly gasTgas: number;
}

/** The slice of the wallet-selector API the staking path uses (lets specs inject a recording fake). */
export interface StakingWalletSelector {
  wallet(id?: string): Promise<{
    signAndSendTransaction(params: {
      receiverId: string;
      actions: unknown[];
    }): Promise<unknown>;
  }>;
}
export type StakingSelectorFactory = (network: RealNearNetwork) => Promise<StakingWalletSelector>;

/** Whitelisted LST contracts per network (mirrors the backend wallet-tx whitelist). */
export const LST_CONTRACTS: Record<RealNearNetwork, Record<'stNEAR' | 'LiNEAR', string>> = {
  mainnet: { stNEAR: 'meta-pool.near', LiNEAR: 'linear-protocol.near' },
  testnet: { stNEAR: 'meta-v2.pool.testnet', LiNEAR: 'linear-protocol.testnet' },
};

/** Early-prototype default APY the wallet tx names for the contract (`<= 1000 bp` is accepted from owners). */
export const WALLET_TX_APY_BP = STAKING_RULES.simGrossApyBp;

type NearActionCreators = typeof import('@near-wallet-selector/core')['actionCreators'];
let resolvedActionCreators: NearActionCreators | null = null;
let actionCreatorsPromise: Promise<NearActionCreators> | null = null;

/** Returns the already-resolved `@near-wallet-selector/core` `actionCreators` without extra microtask hops when warm. */
export function getCachedNearActionCreators(): NearActionCreators | null {
  return resolvedActionCreators;
}

/** Pre-loads and caches `@near-wallet-selector/core` `actionCreators` off the user-click critical path. */
export function loadNearActionCreators(): Promise<NearActionCreators> {
  if (resolvedActionCreators) return Promise.resolve(resolvedActionCreators);
  if (!actionCreatorsPromise) {
    actionCreatorsPromise = import('@near-wallet-selector/core')
      .then((m) => {
        resolvedActionCreators = m.actionCreators;
        return m.actionCreators;
      })
      .catch((err) => {
        actionCreatorsPromise = null;
        throw err;
      });
  }
  return actionCreatorsPromise;
}

export interface SendStakingWalletTxOptions {
  readonly fetchFn: typeof fetch;
  readonly network: RealNearNetwork;
  readonly action: StakingWalletAction;
  readonly poolId: string;
  readonly amountNear: string;
  readonly accountId: string | null;
  readonly lstContract?: string;
  readonly statusMsgEl?: HTMLElement;
  readonly onSuccess?: () => Promise<unknown>;
  readonly selectorFactory?: StakingSelectorFactory;
}

/**
 * Builds the descriptor on the backend, then signs it with the wallet the user ACTUALLY connected:
 * `selector.wallet()` with no module id (HOT / Intear / MyNearWallet / Meteor ...), never a hard-coded one.
 * One tx per action: `stake_payable` carries the deposit, `compound_yield` / `withdraw_lst` carry none.
 */
export async function sendStakingWalletTx(opts: SendStakingWalletTxOptions): Promise<string | null> {
  try {
    const qs = new URLSearchParams({ action: opts.action, poolId: opts.poolId, amountNear: opts.amountNear });
    if (opts.accountId) qs.set('accountId', opts.accountId);
    if (opts.lstContract) qs.set('lstContract', opts.lstContract);
    const res = await opts.fetchFn(`/v1/near/staking/wallet-tx?${qs.toString()}`);
    if (!res.ok) throw new Error('Unable to build staking wallet transaction.');
    const tx = (await res.json()) as StakingWalletTx;
    const gasYocto = (BigInt(Math.round(tx.gasTgas)) * 1_000_000_000_000n).toString();
    const sentViaInjected = !opts.selectorFactory
      ? await sendTxWithInjectedExtraWallet(readSavedNearWallet()?.walletId, {
          receiverId: tx.contractId,
          methodName: tx.methodName,
          args: tx.args,
          gasYocto,
          depositYocto: tx.attachedDepositYocto,
        })
      : false;
    if (!sentViaInjected) {
      const cachedCreators = getCachedNearActionCreators();
      const [actionCreators, selector] = cachedCreators
        ? [cachedCreators, await (opts.selectorFactory ?? createRealSignerWalletSelector)(opts.network)]
        : await Promise.all([
            loadNearActionCreators(),
            (opts.selectorFactory ?? createRealSignerWalletSelector)(opts.network),
          ]);
      const wallet = await selector.wallet();
      await wallet.signAndSendTransaction({
        receiverId: tx.contractId,
        actions: [
          actionCreators.functionCall(
            tx.methodName,
            tx.args,
            BigInt(gasYocto),
            BigInt(tx.attachedDepositYocto),
          ),
        ],
      });
    }
    const msg = `Submitted ${tx.methodName} (${opts.amountNear} NEAR) to ${tx.contractId}.`;
    if (opts.statusMsgEl) opts.statusMsgEl.textContent = msg;
    if (opts.onSuccess) await opts.onSuccess();
    return msg;
  } catch (err) {
    if (opts.statusMsgEl) opts.statusMsgEl.textContent = err instanceof Error ? err.message : 'Wallet tx cancelled.';
    return null;
  }
}
