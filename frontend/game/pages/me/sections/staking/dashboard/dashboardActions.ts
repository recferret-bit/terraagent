// Dashboard actions (stake / unstake / withdraw / compound / stake-profits). `mock`: wallet-first REST. Real network:
// the in-game one-tx wallet flows (`stakingWalletTx`, active `selector.wallet()`); specs inject a recording
// `selectorFactory`, nothing here signs or sends by itself.
import type { StakingAsset, StakingPerformanceResponse } from '@terra/contracts';
import type { MeFetchFn } from '../../../api';
import { DEFAULT_STAKING_POOLS } from '../../../../../features/deed/parts/stakingPanelParts';
import { LST_CONTRACTS, sendStakingWalletTx, type StakingSelectorFactory, type StakingWalletAction } from '../../../../../features/deed/parts/stakingWalletTx';
import { apiErrorMessage, parseProfitsResponse, postJson, type ApiAuth } from './dashboardApi';

export type StakingNetwork = 'mock' | 'testnet' | 'mainnet';

export interface ActionContext {
  readonly doFetch: MeFetchFn;
  readonly auth: ApiAuth;
  readonly accountId: string;
  readonly network: StakingNetwork;
  /** The host's whitelisted pool for this wallet (`GET /v1/near/staking`); the bundled default only as a fallback. */
  readonly pool?: string;
  readonly selectorFactory?: StakingSelectorFactory;
}

export interface ActionResult {
  /** The action reached the host (refetch performance). */
  readonly ok: boolean;
  readonly message: string;
  /** Endpoint missing (404): W28-04 not deployed / wave off. */
  readonly unavailable?: boolean;
  /** `profits`: the quote line. */
  readonly quote?: string;
}

export const DEFAULT_POOL = DEFAULT_STAKING_POOLS[0]!.poolId;
const unavailable = (what: string): ActionResult => ({ ok: false, unavailable: true, message: `${what} is not available on this host yet.` });

const lstFor = (net: StakingNetwork, asset: StakingAsset): string | undefined =>
  net === 'mock' || asset === 'near' ? undefined : LST_CONTRACTS[net][asset];

async function walletAction(c: ActionContext, action: StakingWalletAction, amount: string, asset: StakingAsset): Promise<ActionResult> {
  if (c.network === 'mock') return { ok: false, message: 'Wallet transaction is not used in mock mode.' };
  const status = document.createElement('span');
  const done = await sendStakingWalletTx({
    fetchFn: ((input: string, init?: RequestInit) => c.doFetch(input, init)) as unknown as typeof fetch,
    network: c.network,
    action,
    poolId: c.pool ?? DEFAULT_POOL,
    amountNear: amount,
    accountId: c.accountId,
    lstContract: lstFor(c.network, asset),
    statusMsgEl: status,
    selectorFactory: c.selectorFactory,
  });
  return done === null ? { ok: false, message: status.textContent || 'Wallet transaction cancelled.' } : { ok: true, message: done };
}

async function rest(c: ActionContext, path: string, body: Record<string, unknown>, label: string, okMsg: string): Promise<ActionResult> {
  const res = await postJson(c.doFetch, c.auth, path, { accountId: c.accountId, pool: c.pool ?? DEFAULT_POOL, ...body });
  if (res.status === 404) return unavailable(label);
  if (!res.ok) return { ok: false, message: apiErrorMessage(res.body, `${label} failed (${res.status || 'network'}).`) };
  return { ok: true, message: okMsg };
}

export function runStakeAction(c: ActionContext, amount: string, asset: StakingAsset): Promise<ActionResult> {
  if (c.network !== 'mock') return walletAction(c, asset === 'near' ? 'stake_payable' : 'stake_lst', amount, asset);
  return rest(c, '/v1/near/stake', { amount, asset }, 'Stake', `${amount} ${asset === 'near' ? 'NEAR' : asset} staked.`);
}

export const runUnstakeAction = (c: ActionContext, amount: string, asset: StakingAsset): Promise<ActionResult> =>
  rest(c, '/v1/near/unstake', { amount, asset }, 'Unstake', `Unstake of ${amount} NEAR started (unbonding).`);

export function runWithdrawAction(c: ActionContext, perf: StakingPerformanceResponse, asset: StakingAsset): Promise<ActionResult> {
  if (c.network !== 'mock' && asset !== 'near') return walletAction(c, 'withdraw_lst', perf.balances.withdrawableNear, asset);
  return rest(c, '/v1/near/withdraw', { asset }, 'Withdraw', 'Withdrawn to your wallet in one step.');
}

export function runCompoundAction(c: ActionContext, perf: StakingPerformanceResponse): Promise<ActionResult> {
  if (c.network !== 'mock') return walletAction(c, 'compound_yield', perf.balances.accruedYieldNear, 'near');
  return rest(c, '/v1/near/stake/compound', {}, 'Compound', `Compounded ${perf.balances.accruedYieldNear} NEAR into principal (0 % fee).`);
}

/** `[⚡ Stake Trade Profits (USDC → stNEAR)]`: testnet / mainnet are dry quotes (nothing is sent). */
export async function runStakeProfitsAction(c: ActionContext, amountUsdc: string): Promise<ActionResult> {
  const dry = c.network !== 'mock';
  const res = await postJson(c.doFetch, c.auth, '/v1/near/stake/profits', {
    accountId: c.accountId, amountUsdc, asset: 'stNEAR', pool: c.pool ?? DEFAULT_POOL, dry,
  });
  if (res.status === 404) return unavailable('Stake trade profits');
  if (!res.ok) return { ok: false, message: apiErrorMessage(res.body, `Stake trade profits failed (${res.status || 'network'}).`) };
  const parsed = parseProfitsResponse(res.body);
  if (!parsed) return { ok: false, message: 'Unexpected response from the profits endpoint.' };
  const q = parsed.quote;
  const quote = `${q.amountInUsdc} USDC → ${q.amountOutNear} stNEAR @ $${q.nearUsd.toFixed(2)} (${q.source}${q.dry ? ', dry quote' : ''})`;
  return { ok: !q.dry, message: q.dry ? 'Dry quote only: nothing was staked.' : 'Trade profits staked as stNEAR.', quote };
}
