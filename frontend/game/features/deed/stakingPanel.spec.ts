// @vitest-environment jsdom
import type { DeedView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { buildMockNep413Signature, type OpenSignerModalHandle } from './signerModal';
import { StakingPanel } from './stakingPanel';
import { REAL_NEAR_COPY } from './stakingPanelParts';

function makeDeed(settled: boolean, accountClaimed = false): DeedView {
  const metadata = {
    planet: 'planet_w20',
    colony: 'col_0',
    colonyName: 'Aegis Spire',
    planetType: 'temperate' as const,
    stage: 4,
    terraformBp: settled ? 10_000 : 4000,
    status: settled ? ('settled' as const) : ('active' as const),
    settled,
    version: settled ? 2 : 1,
    imageUrl: '/v1/near/deed/deed%3Acol_0/image.png?v=1',
  };
  return {
    colonyId: 'col_0',
    planetId: 'planet_w20',
    tokenId: 'deed:col_0',
    ownerAccountId: 'planet_w20-col_0.terraagent.mock',
    contractId: 'deeds.terraagent.mock',
    metadata,
    version: metadata.version,
    status: metadata.status,
    settled,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed,
    claimedByAccountId: accountClaimed ? 'pilot.mock' : null,
    txHash: 'mock:tx1',
    mintedAt: 1731153600000,
    updatedAt: 1731153600000,
    history: [],
  };
}

function fakeSigner(decision: 'approve' | 'reject'): () => OpenSignerModalHandle {
  return () => {
    const root = document.createElement('div');
    const promise =
      decision === 'approve'
        ? Promise.resolve({
            status: 'approved' as const,
            signature: buildMockNep413Signature({
              accountId: 'pilot.mock',
              recipient: 'astro-stakers.poolv1.near',
              message: 'stake',
            }),
          })
        : Promise.resolve({
            status: 'rejected' as const,
            reason: 'Cancelled in wallet' as const,
          });
    return {
      promise,
      approve: () => {},
      reject: () => {},
      close: () => {},
      root,
    };
  };
}

describe('W20-21 StakingPanel Day-1 availability & signer rejection (unit)', () => {
  it('shows staking controls from Day 1 (even before settled), renders Real NEAR + perks copy, and prompts account claim before staking', async () => {
    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track: () => {} },
    };
    const panel = new StakingPanel(parent, ctx, { openSigner: fakeSigner('approve') });

    panel.syncDeed(makeDeed(false, false));
    expect(panel.lockedBannerEl.hidden).toBe(true);
    expect(panel.controlsWrapEl.hidden).toBe(false);
    expect(panel.copyEl.textContent).toBe(REAL_NEAR_COPY);
    expect(panel.perksBannerEl.textContent).toContain('Stake >= 10 NEAR from Day 1');
    expect(panel.root.dataset.perksActive).toBe('false');

    panel.syncDeed(makeDeed(true, false));
    expect(panel.lockedBannerEl.hidden).toBe(true);
    expect(panel.controlsWrapEl.hidden).toBe(false);

    // Attempt stake before claiming -> shows inline prompt "Claim your colony account to stake"
    const stakedBeforeClaim = await panel.stakeFlow();
    expect(stakedBeforeClaim).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('Claim your colony account to stake');
    expect(panel.claimBtnEl.hidden).toBe(false);

    panel.dispose();
  });

  it('records "Cancelled in wallet" and tracks stake_cancelled when signer modal is rejected', async () => {
    const parent = document.createElement('div');
    const track = vi.fn();
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track },
    };
    const panel = new StakingPanel(parent, ctx, { openSigner: fakeSigner('reject') });
    panel.syncDeed(makeDeed(true, true));

    const ok = await panel.stakeFlow();
    expect(ok).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('Cancelled in wallet');
    expect(track).toHaveBeenCalledWith(
      'stake_started',
      expect.objectContaining({ colonyId: 'col_0', pool: 'astro-stakers.poolv1.near' }),
    );
    expect(track).toHaveBeenCalledWith(
      'stake_cancelled',
      expect.objectContaining({ colonyId: 'col_0', pool: 'astro-stakers.poolv1.near' }),
    );
    panel.dispose();
  });
});

function createLifecycleFetchMock(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/v1/near/stake')) {
      return {
        ok: true,
        json: async () => ({
          txHash: 'mock:stake-10',
          walletBalanceNear: '90',
          position: {
            colonyId: 'col_0',
            accountId: 'pilot.mock',
            pool: 'astro-stakers.poolv1.near',
            staked: '10',
            unbonding: '0',
            unbondingReadyAtMs: null,
            withdrawable: '0',
            rewards: '0.002466',
            apyBp: 900,
          },
        }),
      };
    }
    if (path.includes('/v1/near/unstake')) {
      return {
        ok: true,
        json: async () => ({
          txHash: 'mock:unstake-10',
          walletBalanceNear: '90',
          position: {
            colonyId: 'col_0',
            accountId: 'pilot.mock',
            pool: 'astro-stakers.poolv1.near',
            staked: '0',
            unbonding: '10',
            unbondingReadyAtMs: Date.now() + 172_800_000,
            withdrawable: '10',
            rewards: '0.002466',
            apyBp: 900,
          },
        }),
      };
    }
    if (path.includes('/v1/near/withdraw')) {
      return {
        ok: true,
        json: async () => ({
          txHash: 'mock:withdraw-10',
          walletBalanceNear: '100.002466',
          position: {
            colonyId: 'col_0',
            accountId: 'pilot.mock',
            pool: 'astro-stakers.poolv1.near',
            staked: '0',
            unbonding: '0',
            unbondingReadyAtMs: null,
            withdrawable: '0',
            rewards: '0',
            apyBp: 900,
          },
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

describe('W20-21 StakingPanel stake -> unstake -> withdraw flow (unit)', () => {
  it('completes stake -> unstake -> withdraw and updates position, rewards, unbonding, and wallet balance', async () => {
    const parent = document.createElement('div');
    const track = vi.fn();
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track },
    };

    const fetchFn = createLifecycleFetchMock();

    const panel = new StakingPanel(parent, ctx, {
      fetchFn,
      openSigner: fakeSigner('approve'),
    });
    panel.syncDeed(makeDeed(true, true));
    panel.amountInputEl.value = '10';

    expect(await panel.stakeFlow()).toBe(true);
    expect(panel.root.querySelector('[data-testid="staking-staked-value"]')?.textContent).toContain(
      '10 NEAR staked',
    );
    expect(panel.root.querySelector('[data-testid="staking-rewards-value"]')?.textContent).toBe(
      '0.002466 NEAR',
    );
    expect(panel.unstakeBtnEl.disabled).toBe(false);

    expect(await panel.unstakeFlow()).toBe(true);
    expect(panel.statusMsgEl.textContent).toContain('Unbonding (4 epochs)');
    expect(panel.withdrawBtnEl.disabled).toBe(false);

    expect(await panel.withdrawFlow()).toBe(true);
    expect(panel.root.querySelector('[data-testid="staking-wallet-balance"]')?.textContent).toBe(
      'Wallet: 100.002466 NEAR',
    );
    expect(track).toHaveBeenCalledWith(
      'withdraw_completed',
      expect.objectContaining({ colonyId: 'col_0', pool: 'astro-stakers.poolv1.near' }),
    );
    panel.dispose();
  });

  it('honors custom stakerPlatformFeeBp, minStakeNear, and protocolYieldShareBp both before and right after staking', async () => {
    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track: () => {} },
    };
    const panel = new StakingPanel(parent, ctx, {
      fetchFn: createLifecycleFetchMock(),
      openSigner: fakeSigner('approve'),
    });
    panel.syncDeed(makeDeed(false, true));
    panel.applyStatusResponse({
      colonyId: 'col_0',
      accountId: 'pilot.mock',
      walletAccountId: 'pilot.mock',
      walletBalanceNear: '100',
      deedSettled: false,
      accountClaimed: true,
      claimedByAccountId: 'pilot.mock',
      pools: [{ poolId: 'astro-stakers.poolv1.near', name: 'Astro Stakers', apyBp: 900 }],
      positions: [],
      perks: {
        active: false,
        minStakeNear: '10',
        totalStakedNear: '0',
        grossApyBp: 900,
        netApyBp: 810,
        protocolYieldShareBp: 1_000,
        platformFeeBp: 100,
        stakerPlatformFeeBp: 25,
        standardPlatformFeeBp: 100,
        managedAutopilotUnlocked: false,
        protocolAccountId: 'protocol.terraagent.mock',
      },
    });

    expect(panel.perksBannerEl.textContent).toContain('8.1% Net APY (10% yield -> TerraAgent Protocol)');
    expect(panel.perksBannerEl.textContent).toContain('75% Lower Market Fee (0.25%)');
    expect(panel.poolSelectEl.options[0]?.textContent).toContain('8.1% net / 9% validator APY');
    expect(panel.root.textContent).toContain('Net Rewards (8.1% APY)');

    panel.amountInputEl.value = '10';
    expect(await panel.stakeFlow()).toBe(true);
    expect(panel.perksBannerEl.textContent).toContain('PERKS ACTIVE (>= 10 NEAR): 8.1% Net APY');
    expect(panel.perksBannerEl.textContent).toContain('0.25% Market Fee');
    panel.dispose();
  });
});
