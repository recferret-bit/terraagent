// @vitest-environment jsdom
import type { StakingPositionDto, StakingStatusResponse } from '@terra/contracts';
import { STAKING_RULES, STAKING_TIERS } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { realNearCopyW28, REAL_NEAR_COPY } from './parts/stakingCopy';
import type { StakingWalletSelector } from './parts/stakingWalletTx';
import { buildMockNep413Signature, type OpenSignerModalHandle } from './signerModal';
import { StakingPanel } from './stakingPanel';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const POOL = 'astro-stakers.pool.testnet';
const STAKING = 'staking.terraagent.testnet';

const pos = (over: Partial<StakingPositionDto> = {}): StakingPositionDto => ({
  accountId: 'pilot.testnet', pool: POOL, staked: '10', unbonding: '0', unbondingReadyAtMs: null,
  withdrawable: '0', rewards: '0.5', lastStakedAtMs: NOW - 30 * DAY, ...over,
});

const status = (positions: StakingPositionDto[], net: 'mock' | 'testnet' = 'testnet'): StakingStatusResponse => ({
  accountId: net === 'testnet' ? 'pilot.testnet' : 'pilot.mock',
  walletAccountId: net === 'testnet' ? 'pilot.testnet' : 'pilot.mock',
  walletBalanceNear: '100', deedSettled: false, accountClaimed: true, claimedByAccountId: null,
  pools: [{ poolId: net === 'testnet' ? POOL : 'astro-stakers.poolv1.near', name: 'Astro', apyBp: 900 }],
  positions,
});

function fakeSelector(opts: { reject?: boolean } = {}) {
  const walletArgs: unknown[][] = [];
  const sent: Array<{ receiverId: string; actions: Array<{ functionCall: { methodName: string; deposit: bigint } }> }> = [];
  const selector: StakingWalletSelector = {
    wallet: async (...args: unknown[]) => {
      walletArgs.push(args);
      return {
        signAndSendTransaction: async (p: never) => {
          if (opts.reject) throw new Error('User rejected the transaction');
          sent.push(p);
          return {};
        },
      };
    },
  };
  return { selector, walletArgs, sent };
}

const DESCRIPTORS: Record<string, unknown> = {
  stake_payable: { contractId: STAKING, methodName: 'stake_payable', args: { pool_id: POOL }, attachedDepositYocto: '10000000000000000000000000', gasTgas: 45 },
  stake_lst: { contractId: 'meta-v2.pool.testnet', methodName: 'ft_transfer_call', args: { receiver_id: STAKING }, attachedDepositYocto: '1', gasTgas: 60 },
  withdraw_lst: { contractId: STAKING, methodName: 'withdraw_lst', args: { pool_id: POOL }, attachedDepositYocto: '0', gasTgas: 80 },
  compound_yield: { contractId: STAKING, methodName: 'compound_yield', args: { pool_id: POOL }, attachedDepositYocto: '0', gasTgas: 60 },
};

function makeFetch(routes: Record<string, (body: unknown) => { status?: number; json: unknown }> = {}) {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url.includes('/staking/wallet-tx')) {
      const action = new URL(url, 'http://x').searchParams.get('action') ?? '';
      return { ok: true, status: 200, json: async () => DESCRIPTORS[action] };
    }
    if (url.includes('/v1/near/staking?')) return { ok: true, status: 200, json: async () => ({}) };
    for (const [key, handler] of Object.entries(routes)) {
      if (url.endsWith(key)) {
        const r = handler(body);
        const st = r.status ?? 200;
        return { ok: st < 400, status: st, json: async () => r.json };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const ctxFor = (flags: string[]): FeatureContext => ({ flags: new Set(flags), host: 'server', services: { track: () => {} } });

function approvingSigner(): () => OpenSignerModalHandle {
  return () => ({
    promise: Promise.resolve({ status: 'approved' as const, signature: buildMockNep413Signature({ accountId: 'pilot.mock', recipient: 'r', message: 'm' }) }),
    approve: () => {}, reject: () => {}, close: () => {}, root: document.createElement('div'),
  });
}

function mount(flags: string[], f: ReturnType<typeof makeFetch>, extra: { selector?: StakingWalletSelector } = {}) {
  const parent = document.createElement('div');
  const panel = new StakingPanel(parent, ctxFor(flags), {
    fetchFn: f.fn, openSigner: approvingSigner(), nowFn: () => NOW,
    selectorFactory: extra.selector ? async () => extra.selector! : undefined,
  });
  return panel;
}

const actionBody = (p: StakingPositionDto, extra: Record<string, unknown> = {}) => ({ txHash: 'mock:tx', position: p, walletBalanceNear: '99', ...extra });

describe('W28-07 copy', () => {
  it('describes the real perks from STAKING_TIERS and never claims "no in-game bonus"', () => {
    const copy = realNearCopyW28();
    expect(copy).not.toMatch(/no in-game bonus/i);
    expect(copy).toContain('100 % principal back');
    expect(copy).toContain('Never game power');
    expect(copy).toContain(`${STAKING_TIERS[1]!.takerFeeBp}→${STAKING_TIERS[4]!.takerFeeBp} bp`);
    const panel = mount(['W28'], makeFetch());
    expect(panel.copyEl.textContent).toBe(copy);
  });

  it('keeps the W20 copy unchanged with W28 off, and hides every W28-only control', () => {
    const panel = mount(['W20'], makeFetch());
    panel.applyStatusResponse(status([pos({ lastStakedAtMs: NOW - DAY })], 'mock'));
    expect(panel.copyEl.textContent).toBe(REAL_NEAR_COPY);
    expect(panel.compoundBtnEl.hidden).toBe(true);
    expect(panel.earlyExitEl.hidden).toBe(true);
    expect(panel.assetSelectEl.parentElement!.hidden).toBe(true);
  });
});

describe('W28-07 real network: active wallet, single-tx stake', () => {
  it('stake_payable is the ONE tx, signed via selector.wallet() with no module id, no deed needed, no REST stake', async () => {
    const f = makeFetch();
    const w = fakeSelector();
    const panel = mount(['W28'], f, { selector: w.selector });
    panel.applyStatusResponse(status([]));
    panel.amountInputEl.value = '10';
    expect(await panel.stakeFlow()).toBe(true);
    expect(w.walletArgs).toEqual([[]]);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.receiverId).toBe(STAKING);
    expect(w.sent[0]!.actions[0]!.functionCall.methodName).toBe('stake_payable');
    expect(w.sent[0]!.actions[0]!.functionCall.deposit).toBe(10n * 10n ** 24n);
    expect(f.calls.some((c) => c.url.endsWith('/v1/near/stake'))).toBe(false);
    expect(f.calls.some((c) => /action=(deposit_near|claim_native_near)/.test(c.url))).toBe(false);
    expect(panel.depositWalletBtnEl.hidden).toBe(true);
  });

  it('stNEAR stakes through ft_transfer_call on the whitelisted LST contract', async () => {
    const f = makeFetch();
    const w = fakeSelector();
    const panel = mount(['W28'], f, { selector: w.selector });
    panel.applyStatusResponse(status([]));
    panel.assetSelectEl.value = 'stNEAR';
    expect(await panel.stakeFlow()).toBe(true);
    expect(f.calls.some((c) => c.url.includes('action=stake_lst') && c.url.includes('lstContract=meta-v2.pool.testnet'))).toBe(true);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.actions[0]!.functionCall.methodName).toBe('ft_transfer_call');
    expect(w.walletArgs).toEqual([[]]);
  });

  it('a wallet rejection surfaces the reason and stakes nothing', async () => {
    const track = vi.fn();
    const w = fakeSelector({ reject: true });
    const parent = document.createElement('div');
    const panel = new StakingPanel(parent, { ...ctxFor(['W28']), services: { track } }, {
      fetchFn: makeFetch().fn, nowFn: () => NOW, selectorFactory: async () => w.selector,
    });
    panel.applyStatusResponse(status([]));
    expect(await panel.stakeFlow()).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('User rejected the transaction');
    expect(track).toHaveBeenCalledWith('stake_cancelled', expect.anything());
  });

  it('withdraw of native NEAR is ONE payout call with no claim step and no wallet tx', async () => {
    const f = makeFetch({ '/v1/near/withdraw': () => ({ json: actionBody(pos({ staked: '0', withdrawable: '0', rewards: '0' })) }) });
    const w = fakeSelector();
    const panel = mount(['W28'], f, { selector: w.selector });
    panel.applyStatusResponse(status([pos({ staked: '0', withdrawable: '10', rewards: '0' })]));
    // real-network REST auth uses the NEP-413 signer modal (approved by the fake)
    const ok = await panel.withdrawFlow();
    expect(ok).toBe(true);
    const posts = f.calls.filter((c) => c.body);
    expect(posts.map((c) => c.url)).toEqual(['/v1/near/withdraw']);
    expect(w.sent).toHaveLength(0);
  });

  it('withdraw of an LST position is one withdraw_lst wallet tx via the active wallet', async () => {
    const f = makeFetch();
    const w = fakeSelector();
    const panel = mount(['W28'], f, { selector: w.selector });
    panel.applyStatusResponse(status([pos({ asset: 'stNEAR', staked: '0', withdrawable: '4', rewards: '0' })]));
    expect(await panel.withdrawFlow()).toBe(true);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.actions[0]!.functionCall.methodName).toBe('withdraw_lst');
    expect(w.walletArgs).toEqual([[]]);
    expect(f.calls.some((c) => c.body)).toBe(false);
  });

  it('compound signs compound_yield (0 deposit) with the active wallet', async () => {
    const f = makeFetch();
    const w = fakeSelector();
    const panel = mount(['W28'], f, { selector: w.selector });
    panel.applyStatusResponse(status([pos()]));
    expect(panel.compoundBtnEl.hidden).toBe(false);
    expect(await panel.compoundFlow()).toBe(true);
    expect(w.sent[0]!.actions[0]!.functionCall.methodName).toBe('compound_yield');
    expect(w.sent[0]!.actions[0]!.functionCall.deposit).toBe(0n);
    expect(w.walletArgs).toEqual([[]]);
  });

  it('a rejected compound wallet tx reports the reason', async () => {
    const w = fakeSelector({ reject: true });
    const panel = mount(['W28'], makeFetch(), { selector: w.selector });
    panel.applyStatusResponse(status([pos()]));
    expect(await panel.compoundFlow()).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('User rejected the transaction');
  });
});

describe('W28-07 mock/server mode against mocked REST', () => {
  it('stakes without a deed: body has no colonyId, carries asset, and the claim gate is skipped', async () => {
    const f = makeFetch({ '/v1/near/stake': () => ({ json: actionBody(pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near' })) }) });
    const panel = mount(['W28'], f);
    panel.applyStatusResponse(status([], 'mock'));
    expect(await panel.stakeFlow()).toBe(true);
    const call = f.calls.find((c) => c.url === '/v1/near/stake')!;
    expect(call.body).not.toHaveProperty('colonyId');
    expect(call.body).toMatchObject({ asset: 'near', amount: '10' });
    expect(panel.claimBtnEl.hidden).toBe(true);
  });

  it('with W28 off a stake still requires the claimed colony account (W20 behaviour)', async () => {
    const panel = mount(['W20'], makeFetch());
    expect(await panel.stakeFlow()).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('Claim your colony account to stake');
  });

  it('0 rewards hides Compound; >0 shows it; compound posts CompoundYieldRequest and updates the position', async () => {
    const after = pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near', staked: '10.5', rewards: '0' });
    const f = makeFetch({ '/v1/near/stake/compound': () => ({ json: actionBody(after, { compoundedNear: '0.5' }) }) });
    const panel = mount(['W28'], f);
    panel.applyStatusResponse(status([pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near', rewards: '0' })], 'mock'));
    expect(panel.compoundBtnEl.hidden).toBe(true);
    panel.applyStatusResponse(status([pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near' })], 'mock'));
    expect(panel.compoundBtnEl.hidden).toBe(false);
    expect(await panel.compoundFlow()).toBe(true);
    expect(f.calls.find((c) => c.url.endsWith('/stake/compound'))!.body).toMatchObject({ pool: 'astro-stakers.poolv1.near' });
    expect(panel.statusMsgEl.textContent).toContain('Compounded 0.5 NEAR');
    expect(panel.compoundBtnEl.hidden).toBe(true);
  });

  it('a 404 compound endpoint disables the button with a tooltip instead of throwing', async () => {
    const panel = mount(['W28'], makeFetch());
    panel.applyStatusResponse(status([pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near' })], 'mock'));
    expect(await panel.compoundFlow()).toBe(false);
    expect(panel.compoundBtnEl.disabled).toBe(true);
    expect(panel.compoundBtnEl.title).toMatch(/not available/i);
  });

  it('compound is a no-op with W28 off', async () => {
    const f = makeFetch();
    const panel = mount(['W20'], f);
    panel.applyStatusResponse(status([pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near' })], 'mock'));
    expect(await panel.compoundFlow()).toBe(false);
    expect(f.calls.some((c) => c.url.includes('compound'))).toBe(false);
  });
});

describe('W28-07 early-exit notice', () => {
  const mockPos = (lastStakedAtMs: number | null) => pos({ accountId: 'pilot.mock', pool: 'astro-stakers.poolv1.near', lastStakedAtMs });

  it('shows the 25 bp notice under 7 days, with days left', () => {
    const panel = mount(['W28'], makeFetch());
    panel.applyStatusResponse(status([mockPos(NOW - 2 * DAY)], 'mock'));
    expect(panel.earlyExitEl.hidden).toBe(false);
    expect(panel.earlyExitEl.textContent).toContain(`${STAKING_RULES.earlyExitFeeBp} bp`);
    expect(panel.earlyExitEl.textContent).toContain('5 more days');
  });

  it('hides it at exactly 7 days, for old stakes, unknown clocks and empty positions', () => {
    const panel = mount(['W28'], makeFetch());
    for (const last of [NOW - STAKING_RULES.earlyExitWindowMs, NOW - 30 * DAY, null]) {
      panel.applyStatusResponse(status([mockPos(last)], 'mock'));
      expect(panel.earlyExitEl.hidden).toBe(true);
    }
    panel.applyStatusResponse(status([{ ...mockPos(NOW - DAY), staked: '0' }], 'mock'));
    expect(panel.earlyExitEl.hidden).toBe(true);
  });

  it('prefers perks V2 earlyExitFeeBp and renders the effective fee tier line', () => {
    const panel = mount(['W28'], makeFetch());
    const st = status([mockPos(NOW - 30 * DAY)], 'mock');
    panel.applyStatusResponse({
      ...st,
      perks: {
        version: 2, tier: 2, tierKey: 'commander', tierName: 'Commander', feeTier: 1, activeStakedNear: '60', unbondingNear: '0',
        aiModel: 'm', aiMode: 'managed', maxAiColonySlots: 3, activeAiColonySlots: 0, dailyAiCallLimit: 90, dailyAiCallsUsed: 0,
        dailyAiBudgetUsd: 1, freeTrialTurnsRemaining: 0, feeWarmupReadyAtMs: NOW + 5 * 3_600_000, earlyExitFeeBp: 25,
        earlyExitFreeAtMs: null, stakedSinceMs: NOW, gasMultiplier: 4, sweepSeconds: 60, botKeys: 3, guildRadarLeadMs: 0,
        daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0, leadPatronPlanetIds: [], nextTierMinNear: 200,
        active: true, minStakeNear: '10', totalStakedNear: '60', grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000,
        platformFeeBp: 65, standardPlatformFeeBp: 100, managedAutopilotUnlocked: true, protocolAccountId: 'protocol.mock',
      } as never,
    });
    expect(panel.earlyExitEl.hidden).toBe(false);
    expect(panel.perksBannerEl.textContent).toContain(`Tier Commander: ${STAKING_TIERS[1]!.takerFeeBp} bp market fee now`);
  });
});
