import type {
  Nep413Signature,
  StakingActionResponse,
  StakingAsset,
  StakingPositionDto,
} from '@terra/contracts';
import type { createDeedTracker } from '../deedTracker';
import type { RealNearNetwork } from './realNearWalletDriver';
import { extractStakingApiCode, extractStakingApiError } from './stakingPanelParts';
import {
  LST_CONTRACTS,
  sendStakingWalletTx,
  type StakingSelectorFactory,
  type StakingWalletAction,
} from './stakingWalletTx';

export interface StakingFlowHost {
  readonly fetchFn: typeof fetch;
  readonly w28: boolean;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly statusEl: HTMLElement;
  tracker(): ReturnType<typeof createDeedTracker>;
  network(): 'mock' | RealNearNetwork;
  /** `colonyId` is `undefined` for a wallet-first W28 stake without a deed. */
  ids(): { colonyId: string | undefined; planetId: string; accountId: string | undefined };
  input(): { pool: string; asset: StakingAsset; amount: string };
  activePosition(): StakingPositionDto | null;
  say(message: string): void;
  applyAction(body: StakingActionResponse): void;
  refresh(): Promise<unknown>;
  /** Opens the NEP-413 signer; `undefined` when skipped (mock + not forced), `null` when rejected (status set). */
  sign(summary: string, recipient: string, message: string, force: boolean): Promise<Nep413Signature | undefined | null>;
  accountClaimed(): boolean;
  promptClaim(): void;
  staleClaim(): void;
  markCompoundUnavailable(): void;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function baseBody(h: StakingFlowHost): Record<string, string> {
  const { colonyId, accountId } = h.ids();
  return { ...(colonyId ? { colonyId } : {}), ...(h.w28 && accountId ? { accountId } : {}) };
}

function eventProps(h: StakingFlowHost, pool: string, amount: string) {
  const { colonyId, planetId } = h.ids();
  return { colonyId: colonyId ?? 'wallet', planetId, pool, amount };
}

async function postJson(h: StakingFlowHost, path: string, body: unknown): Promise<Response> {
  return h.fetchFn(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
}

function walletTx(h: StakingFlowHost, action: StakingWalletAction, pos: string, amount: string, lst?: string) {
  const net = h.network();
  if (net === 'mock') return Promise.resolve(null);
  return sendStakingWalletTx({
    fetchFn: h.fetchFn,
    network: net,
    action,
    poolId: pos,
    amountNear: amount,
    accountId: null,
    lstContract: lst,
    statusMsgEl: h.statusEl,
    selectorFactory: h.selectorFactory,
    onSuccess: () => h.refresh(),
  });
}

function lstFor(h: StakingFlowHost, asset: StakingAsset | undefined): string | undefined {
  const net = h.network();
  return net === 'mock' || !asset || asset === 'near' ? undefined : LST_CONTRACTS[net][asset];
}

/** Real network: ONE wallet tx (`stake_payable` with the attached deposit, or `stake_lst` via `ft_transfer_call`). */
async function stakeWithWallet(h: StakingFlowHost): Promise<boolean> {
  const { pool, asset, amount } = h.input();
  const lst = lstFor(h, asset);
  const targetPool = lst ?? pool;
  const props = eventProps(h, targetPool, amount);
  h.tracker().stakeStarted(props);
  const done = await walletTx(h, lst ? 'stake_lst' : 'stake_payable', targetPool, amount, lst);
  if (done === null) {
    h.tracker().stakeCancelled(props);
    return false;
  }
  h.tracker().stakeCompleted({ ...props, txHash: done });
  return true;
}

export async function runStake(h: StakingFlowHost): Promise<boolean> {
  if (!h.w28 && !h.accountClaimed()) {
    h.promptClaim();
    return false;
  }
  if (h.w28 && h.network() !== 'mock') return stakeWithWallet(h);
  const { pool, asset, amount } = h.input();
  const props = eventProps(h, pool, amount);
  h.tracker().stakeStarted(props);
  const signature = await h.sign(`Stake ${amount} NEAR in ${pool}`, pool, `stake:${props.colonyId}:${pool}:${amount}`, true);
  if (!signature) {
    h.tracker().stakeCancelled(props);
    return false;
  }
  try {
    const res = await postJson(h, '/v1/near/stake', {
      ...baseBody(h), pool, amount, ...(h.w28 ? { asset } : {}), walletSignature: signature,
    });
    const body = (await res.json()) as StakingActionResponse;
    if (!res.ok) {
      if (extractStakingApiCode(body) === 'ACCOUNT_NOT_CLAIMED') h.staleClaim();
      else h.say(extractStakingApiError(body, 'Stake failed'));
      return false;
    }
    h.applyAction(body);
    h.say(`${body.position.staked} NEAR staked (${body.txHash})`);
    h.tracker().stakeCompleted({ ...props, txHash: body.txHash });
    return true;
  } catch {
    return false;
  }
}

export async function runUnstake(h: StakingFlowHost): Promise<boolean> {
  const pos = h.activePosition();
  if (!pos || Number(pos.staked || '0') <= 0) return false;
  const amount = pos.staked;
  const props = eventProps(h, pos.pool, amount);
  const signature = await h.sign(`Unstake ${amount} NEAR from ${pos.pool}`, pos.pool, `unstake:${props.colonyId}:${pos.pool}:${amount}`, false);
  if (signature === null) return false;
  h.tracker().unstakeStarted(props);
  try {
    const res = await postJson(h, '/v1/near/unstake', {
      ...baseBody(h), pool: pos.pool, amount, ...(signature ? { walletSignature: signature } : {}),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as StakingActionResponse;
    h.applyAction(body);
    const fee = body.earlyExitFeeBp ? ` · early-exit fee ${body.earlyExitFeeNear ?? ''} NEAR (${body.earlyExitFeeBp} bp)` : '';
    h.say(`Unbonding (4 epochs)${fee}`);
    return true;
  } catch {
    return false;
  }
}

/** Single-step withdraw: one REST payout (or one `withdraw_lst` wallet tx for an LST position), no claim step. */
export async function runWithdraw(h: StakingFlowHost): Promise<boolean> {
  const pos = h.activePosition();
  if (!pos) return false;
  const amount = pos.withdrawable || pos.unbonding || '0';
  const lst = h.w28 && pos.asset && pos.asset !== 'near' ? lstFor(h, pos.asset) : undefined;
  if (lst) {
    const done = await walletTx(h, 'withdraw_lst', pos.pool, amount, lst);
    return done !== null;
  }
  const props = eventProps(h, pos.pool, amount);
  const signature = await h.sign(`Withdraw ${amount} NEAR from ${pos.pool}`, pos.pool, `withdraw:${props.colonyId}:${pos.pool}`, false);
  if (signature === null) return false;
  try {
    const res = await postJson(h, '/v1/near/withdraw', {
      ...baseBody(h), pool: pos.pool, ...(signature ? { walletSignature: signature } : {}),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as StakingActionResponse;
    h.applyAction(body);
    h.say(`Withdrawn to wallet (${body.txHash})`);
    h.tracker().withdrawCompleted({ ...props, txHash: body.txHash });
    return true;
  } catch {
    return false;
  }
}

/** `[↻ Compound Yield]`: 0 % fee. Mock/server -> `POST /v1/near/stake/compound`; real -> wallet `compound_yield`. */
export async function runCompound(h: StakingFlowHost): Promise<boolean> {
  const pos = h.activePosition();
  if (!h.w28 || !pos || Number(pos.rewards || '0') <= 0) return false;
  if (h.network() !== 'mock') {
    const done = await walletTx(h, 'compound_yield', pos.pool, pos.rewards);
    return done !== null;
  }
  try {
    const res = await postJson(h, '/v1/near/stake/compound', { ...baseBody(h), pool: pos.pool });
    if (res.status === 404) {
      h.markCompoundUnavailable();
      return false;
    }
    const body = (await res.json()) as StakingActionResponse;
    if (!res.ok) {
      h.say(extractStakingApiError(body, 'Compound failed'));
      return false;
    }
    h.applyAction(body);
    h.say(`Compounded ${body.compoundedNear ?? pos.rewards} NEAR into principal (0 % fee)`);
    return true;
  } catch {
    h.say('Compound failed');
    return false;
  }
}
