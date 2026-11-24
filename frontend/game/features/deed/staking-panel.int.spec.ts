// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS, type DeedView } from '@terra/contracts';
import { StakingPanel } from './stakingPanel';

function deedFor(network: 'mock' | 'testnet', claimed = true): DeedView {
  const suffix = network === 'mock' ? 'mock' : 'testnet';
  return {
    colonyId: 'col_int', planetId: 'planet-desert-01', tokenId: 'deed:col_int',
    ownerAccountId: `col.${suffix}`, contractId: `deed.terraagent.${suffix}`,
    metadata: {
      planet: 'planet-desert-01', colony: 'col_int', colonyName: 'IntColony', planetType: 'desert',
      stage: 4, terraformBp: 10_000, status: 'settled', settled: true, version: 2, imageUrl: '/v1/near/deed/image.png',
    },
    version: 2, status: 'settled', settled: true, pendingState: 'FINAL', pendingRetries: 0,
    accountClaimed: claimed, claimedByAccountId: claimed ? `pilot.${suffix}` : null,
    txHash: `${network}:deed`, mintedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, history: [],
  };
}

function panelCtx(accountId: string) {
  return {
    host: 'server' as const,
    flags: { has: () => true },
    services: {
      pilot: { view: () => ({ isGuest: false, accessToken: 'tok', accountId }), subscribe: () => () => undefined },
      world: { currentPlanetId: () => 'planet-desert-01' },
    },
  } as never;
}

function makeApprovingSigner() {
  return () =>
    ({
      promise: Promise.resolve({
        status: 'approved',
        signature: { accountId: 'pilot.mock', publicKey: 'ed25519:mock', signature: 'ed25519:sig', nonce: 'AAAAAAAAAAAAAAAAAAAAAA==', message: 'stake', recipient: 'staking.mock' },
      }),
      approve() {}, reject() {}, close() {}, root: document.createElement('div'),
    }) as never;
}

function makePerksPayload(staked: number, unbonding: number) {
  return {
    ...STAKING_TIERS[staked >= 50 ? 2 : 0],
    version: 2, active: staked >= 10, tier: staked >= 50 ? 2 : 0, tierKey: staked >= 50 ? 'commander' : 'cadet',
    tierName: staked >= 50 ? 'Commander' : 'Cadet', feeTier: staked >= 10 ? 1 : 0, minStakeNear: '10',
    totalStakedNear: String(staked), activeStakedNear: String(staked), unbondingNear: String(unbonding),
    grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, platformFeeBp: staked >= 50 ? 50 : 100,
    standardPlatformFeeBp: 100, managedAutopilotUnlocked: staked >= 10, protocolAccountId: 'protocol.mock',
    aiModel: 'z-ai/glm-5.3-flash', aiMode: 'tee', maxAiColonySlots: 3, activeAiColonySlots: 0,
    dailyAiCallLimit: 90, dailyAiCallsUsed: 0, dailyAiBudgetUsd: 0.1, freeTrialTurnsRemaining: 0,
    feeWarmupReadyAtMs: null, earlyExitFeeBp: 0, earlyExitFreeAtMs: null, stakedSinceMs: staked > 0 ? 1 : null,
    gasMultiplier: 4, sweepSeconds: 60, botKeys: 3, guildRadarLeadMs: 300_000, daoVoteWeightBp: 10_000,
    stallRoyaltyBonusBp: 0, leadPatronPlanetIds: [], nextTierMinNear: 200,
  };
}

function createStatefulMockFetch(pool: string, seenUrls: string[]) {
  const st = { staked: 0, unbonding: 0, withdrawable: 0, rewards: 0.25 };
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    seenUrls.push(`${init?.method ?? 'GET'}:${url.split('?')[0]}`);
    if (!init?.method || init.method === 'GET') {
      if (url.includes('/v1/near/claim-account')) {
        return new Response(JSON.stringify({ claimed: true, accountId: 'col.mock', claimedByAccountId: 'pilot.mock' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        accountId: 'pilot.mock', walletBalanceNear: '100', pools: [{ poolId: pool, name: 'Astro', apyBp: 900 }],
        positions: [{ accountId: 'pilot.mock', pool, staked: String(st.staked), unbonding: String(st.unbonding), withdrawable: String(st.withdrawable), rewards: String(st.rewards), asset: 'near' }],
        perks: makePerksPayload(st.staked, st.unbonding),
      }), { status: 200 });
    }
    const body = init.body ? (JSON.parse(String(init.body)) as { amount?: string }) : {};
    if (url.includes('/v1/near/stake/compound')) { st.staked += st.rewards; st.rewards = 0; }
    else if (url.includes('/v1/near/stake')) { st.staked += Number(body.amount ?? 0); }
    else if (url.includes('/v1/near/unstake')) { const amt = Number(body.amount ?? 0); st.staked -= amt; st.unbonding += amt; st.withdrawable += amt; }
    else if (url.includes('/v1/near/withdraw')) { st.unbonding = 0; st.withdrawable = 0; }
    return new Response(JSON.stringify({ position: { accountId: 'pilot.mock', pool, staked: String(st.staked), unbonding: String(st.unbonding), withdrawable: String(st.withdrawable), rewards: String(st.rewards) } }), { status: 200 });
  });
  return { st, fetchFn };
}

describe('StakingPanel integration (mock REST mode)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('executes stake -> partial unstake -> compound -> withdraw across REST fetches', async () => {
    const pool = 'astro-stakers.pool.mock';
    const seenUrls: string[] = [];
    const { st, fetchFn } = createStatefulMockFetch(pool, seenUrls);
    const host = document.createElement('div');
    const panel = new StakingPanel(host, panelCtx('pilot.mock'), { fetchFn: fetchFn as unknown as typeof fetch, openSigner: makeApprovingSigner() });
    panel.syncDeed(deedFor('mock', true));
    await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>('[data-testid="staking-pool-select"]')?.value).toBe(pool));

    const amt = host.querySelector<HTMLInputElement>('[data-testid="staking-amount-input"]')!;
    amt.value = '50';
    host.querySelector<HTMLButtonElement>('[data-testid="staking-stake-btn"]')?.click();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="staking-staked-value"]')?.textContent).toContain('50'));

    amt.value = '15';
    host.querySelector<HTMLButtonElement>('[data-testid="staking-unstake-btn"]')?.click();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="staking-staked-value"]')?.textContent).toContain('35'));

    host.querySelector<HTMLButtonElement>('[data-testid="staking-compound-btn"]')?.click();
    await vi.waitFor(() => expect(st.rewards).toBe(0));

    host.querySelector<HTMLButtonElement>('[data-testid="staking-withdraw-btn"]')?.click();
    await vi.waitFor(() => expect(st.withdrawable).toBe(0));
    expect(seenUrls.some((u) => u.includes('/v1/near/withdraw'))).toBe(true);
    panel.dispose();
  });
});

describe('StakingPanel integration (testnet selectorFactory)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('builds wallet-tx descriptors and signs native + LST txs through selectorFactory', async () => {
    const signed: string[] = [];
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/v1/near/staking/wallet-tx')) {
        const action = new URL(url, 'http://x').searchParams.get('action') ?? 'stake_payable';
        return new Response(JSON.stringify({
          contractId: 'staking.terraagent.testnet', methodName: action, args: { pool_id: 'astro-stakers.pool.testnet' },
          attachedDepositYocto: action === 'stake_payable' || action === 'deposit_and_stake_lst' ? '10000000000000000000000000' : '0', gasTgas: 75,
        }), { status: 200 });
      }
      if (url.includes('/v1/near/claim-account')) {
        return new Response(JSON.stringify({ claimed: true, accountId: 'col.testnet', claimedByAccountId: 'pilot.testnet' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        accountId: 'pilot.testnet', walletBalanceNear: '100', pools: [{ poolId: 'astro-stakers.pool.testnet', name: 'Astro', apyBp: 900 }],
        positions: [{ accountId: 'pilot.testnet', pool: 'astro-stakers.pool.testnet', staked: '20', unbonding: '0', withdrawable: '1', rewards: '0.2', asset: 'near' }],
      }), { status: 200 });
    });

    const host = document.createElement('div');
    const panel = new StakingPanel(host, panelCtx('pilot.testnet'), {
      fetchFn: fetchFn as unknown as typeof fetch,
      selectorFactory: async () => ({
        wallet: async () => ({
          signAndSendTransaction: async (tx: { actions: Array<{ functionCall?: { methodName?: string } }> }) => {
            signed.push(tx.actions[0]?.functionCall?.methodName ?? 'unknown');
            return { transaction: { hash: 'testnet-tx' } };
          },
        }),
      }) as never,
    });
    panel.syncDeed(deedFor('testnet', true));
    await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>('[data-testid="staking-pool-select"]')?.value).toBe('astro-stakers.pool.testnet'));

    host.querySelector<HTMLInputElement>('[data-testid="staking-amount-input"]')!.value = '10';
    host.querySelector<HTMLButtonElement>('[data-testid="staking-stake-btn"]')?.click();
    await vi.waitFor(() => expect(signed).toContain('stake_payable'));

    const asset = host.querySelector<HTMLSelectElement>('[data-testid="staking-asset-select"]')!;
    asset.value = 'stNEAR';
    asset.dispatchEvent(new Event('change'));
    host.querySelector<HTMLButtonElement>('[data-testid="staking-wallet-deposit-btn"]')?.click();
    await vi.waitFor(() => expect(signed.length).toBeGreaterThanOrEqual(2));
    panel.dispose();
  });
});
