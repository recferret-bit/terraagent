// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS, type DeedView } from '@terra/contracts';
import { StakingPanel } from './stakingPanel';

function ctxMock(overFlags: string[] = ['W20', 'W28']) {
  const listeners = new Set<() => void>();
  return {
    host: 'server' as const,
    flags: { has: (f: string) => overFlags.includes(f) },
    services: {
      pilot: {
        view: () => ({ isGuest: false, accessToken: 'tok', accountId: 'pilot.mock' }),
        subscribe: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      world: { currentPlanetId: () => 'planet-desert-01' },
    },
  } as never;
}

function settledDeed(colonyId = 'col_0'): DeedView {
  return {
    colonyId,
    planetId: 'planet-desert-01',
    tokenId: `deed:${colonyId}`,
    ownerAccountId: 'col.pilot.mock',
    contractId: 'deed.mock',
    metadata: {
      planet: 'planet-desert-01',
      colony: colonyId,
      colonyName: 'Aegis',
      planetType: 'desert',
      stage: 4,
      terraformBp: 10_000,
      status: 'settled',
      settled: true,
      version: 2,
      imageUrl: '/v1/near/deed/image.png',
    },
    version: 2,
    status: 'settled',
    settled: true,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed: true,
    claimedByAccountId: 'pilot.mock',
    txHash: 'mock:deed',
    mintedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    history: [],
  };
}

function makePanelFetch(opts: { readonly shouldFailUnstake: () => boolean; readonly postBodies: Array<{ url: string; body: Record<string, unknown> }> }) {
  const pastMs = Date.now() - 10_000;
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      if (input.includes('/v1/near/claim-account')) {
        return new Response(JSON.stringify({ claimed: true, accountId: 'col.pilot.mock', claimedByAccountId: 'pilot.mock' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          accountId: 'pilot.mock',
          walletBalanceNear: '50',
          pools: [
            { poolId: 'astro-stakers.pool.mock', name: 'Astro', apyBp: 900 },
            { poolId: 'chorus-one.pool.mock', name: 'Chorus', apyBp: 850 },
          ],
          positions: [
            { accountId: 'pilot.mock', pool: 'astro-stakers.pool.mock', staked: '60', unbonding: '0', withdrawable: '0', rewards: '0.5', asset: 'near' },
            { accountId: 'pilot.mock', pool: 'chorus-one.pool.mock', staked: '10', unbonding: '0', withdrawable: '0', rewards: '0.1', asset: 'near' },
          ],
          perks: {
            ...STAKING_TIERS[2], version: 2, active: true, tier: 2, tierKey: 'commander', tierName: 'Commander', feeTier: 2,
            minStakeNear: '10', totalStakedNear: '70', activeStakedNear: '70', unbondingNear: '0', grossApyBp: 900, netApyBp: 720,
            protocolYieldShareBp: 2000, platformFeeBp: 50, standardPlatformFeeBp: 100, managedAutopilotUnlocked: true,
            protocolAccountId: 'protocol.mock', aiModel: 'z-ai/glm-5.3-flash', aiMode: 'tee', maxAiColonySlots: 3, activeAiColonySlots: 1,
            dailyAiCallLimit: 90, dailyAiCallsUsed: 0, dailyAiBudgetUsd: 0.1, freeTrialTurnsRemaining: 0, feeWarmupReadyAtMs: pastMs,
            earlyExitFeeBp: 0, earlyExitFreeAtMs: pastMs, stakedSinceMs: pastMs - 100_000, gasMultiplier: 4, sweepSeconds: 60,
            botKeys: 3, guildRadarLeadMs: 300_000, daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0, leadPatronPlanetIds: [], nextTierMinNear: 200,
          },
        }),
        { status: 200 },
      );
    }
    const parsedBody = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    opts.postBodies.push({ url: input, body: parsedBody });
    if (input.includes('/unstake') && opts.shouldFailUnstake()) {
      return new Response(JSON.stringify({ error: { message: 'Unstake denied on pool' } }), { status: 400 });
    }
    return new Response(
      JSON.stringify({ position: { accountId: 'pilot.mock', pool: String(parsedBody.pool ?? 'astro-stakers.pool.mock'), staked: '40', unbonding: '20', withdrawable: '0', rewards: '0.5' } }),
      { status: 200 },
    );
  });
}

describe('StakingPanel & expired-warmup coverage (unit)', () => {
  it('refreshes position display on pool dropdown change, handles expired warmup, supports partial unstake, and surfaces POST failures', async () => {
    const parent = document.createElement('div');
    let failUnstake = true;
    const postBodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = makePanelFetch({ shouldFailUnstake: () => failUnstake, postBodies });
    const panel = new StakingPanel(parent, ctxMock(), { fetchFn: fetchFn as unknown as typeof fetch });
    panel.syncDeed(settledDeed('col_0'));

    const poolSelect = parent.querySelector<HTMLSelectElement>('[data-testid="staking-pool-select"]')!;
    const stakedEl = parent.querySelector<HTMLElement>('[data-testid="staking-staked-value"]')!;
    await vi.waitFor(() => expect(stakedEl.textContent).toContain('60'));
    expect((parent.querySelector<HTMLElement>('[data-testid="staking-perks-banner"]')?.textContent ?? '').toLowerCase()).not.toContain('warmup in');

    poolSelect.value = 'chorus-one.pool.mock';
    poolSelect.dispatchEvent(new Event('change'));
    expect(stakedEl.textContent).toContain('10');

    poolSelect.value = 'astro-stakers.pool.mock';
    poolSelect.dispatchEvent(new Event('change'));
    parent.querySelector<HTMLInputElement>('[data-testid="staking-amount-input"]')!.value = '20';
    const unstakeBtn = parent.querySelector<HTMLButtonElement>('[data-testid="staking-unstake-btn"]')!;
    unstakeBtn.click();
    await vi.waitFor(() => expect(parent.querySelector<HTMLElement>('[data-testid="staking-status-msg"]')?.textContent ?? '').toContain('Unstake denied on pool'));

    failUnstake = false;
    unstakeBtn.click();
    await vi.waitFor(() => expect(postBodies.filter((b) => b.url.includes('/unstake')).length).toBe(2));
    expect(postBodies[1]!.body.amount).toBe('20');
    panel.dispose();
  });
});
