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
    accountId: 'planet_w20-col_0.terraagent.mock',
    contract: 'deeds.terraagent.mock',
    metadata,
    version: metadata.version,
    status: metadata.status,
    settled,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed,
    claimedByAccountId: accountClaimed ? 'pilot.mock' : null,
    lastUpdateTx: 'mock:tx1',
    explorerUrl: '/dev/chain/?tab=deeds&tokenId=deed%3Acol_0',
    shareUrl: '/deed/deed%3Acol_0',
    imageUrl: metadata.imageUrl,
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

describe('W20-21 StakingPanel gating & signer rejection (unit)', () => {
  it('hides staking controls until deed is settled, shows explicit Real NEAR copy, and prompts account claim before staking', async () => {
    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: {},
    };
    const panel = new StakingPanel(parent, ctx, { openSigner: fakeSigner('approve') });

    panel.syncDeed(makeDeed(false, false));
    expect(panel.lockedBannerEl.hidden).toBe(false);
    expect(panel.controlsWrapEl.hidden).toBe(true);
    expect(panel.copyEl.textContent).toBe(REAL_NEAR_COPY);

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
});
