// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS, type TradeBalancesResponse } from '@terra/contracts';
import { TradeClient } from '../api/client';
import { initialState } from '../model/state';
import { RampView } from './rampView';
import { TradeStaking } from './stakingHeader';
import type { NearMode } from './stakeProfitsView';

function perksJson(accountId: string | null, tier: 0 | 1 | 2 | 3 | 4) {
  const row = STAKING_TIERS[tier]!;
  return {
    accountId,
    perks: {
      active: tier >= 1, minStakeNear: '10', totalStakedNear: String(row.minStakeNear), grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000,
      platformFeeBp: row.takerFeeBp, standardPlatformFeeBp: 100, managedAutopilotUnlocked: tier >= 1, protocolAccountId: 'protocol.mock',
      version: 2, tier, tierKey: row.key, tierName: row.name, feeTier: tier, activeStakedNear: String(row.minStakeNear), unbondingNear: '0',
      aiModel: 'z-ai/glm-5.3-flash', aiMode: tier >= 1 ? 'tee' : 'script', maxAiColonySlots: row.aiColonySlots, activeAiColonySlots: 0,
      dailyAiCallLimit: 90, dailyAiCallsUsed: 0, dailyAiBudgetUsd: 0.2, freeTrialTurnsRemaining: 0, feeWarmupReadyAtMs: null,
      earlyExitFeeBp: 0, earlyExitFreeAtMs: null, stakedSinceMs: 1, gasMultiplier: row.gasMultiplier, sweepSeconds: row.sweepSeconds,
      botKeys: row.botKeys, guildRadarLeadMs: row.guildRadarLeadMs, daoVoteWeightBp: row.daoVoteWeightBp, stallRoyaltyBonusBp: row.stallRoyaltyBonusBp,
      leadPatronPlanetIds: [], nextTierMinNear: tier < 4 ? STAKING_TIERS[tier + 1]!.minStakeNear : null,
    },
    aiBudget: {
      model: 'z-ai/glm-5.3-flash', mode: tier >= 1 ? 'tee' : 'script', dailyBudgetUsd: 0.2, dailyBudgetUsedUsd: 0,
      dailyCallLimit: 90, dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 0, freeTrialTurnsTotal: 5,
      trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: row.aiColonySlots,
    },
  };
}

describe('/trade.html staking header + StakeProfits + RampView integration (jsdom)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('updates header tier on colony change, stakes USDC profits to refresh balances, and syncs RampView + Profits mode', async () => {
    let mode: NearMode = 'mock';
    let stakedTier: 1 | 3 = 1;
    const doFetch = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/near/staking/overview')) {
        return new Response(JSON.stringify({ apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'live' } }), { status: 200 });
      }
      if (url.includes('/v1/near/staking/perks')) {
        const isCol2 = url.includes('colonyId=col_2');
        return new Response(JSON.stringify(perksJson(isCol2 ? 'col2.near' : null, isCol2 ? 3 : stakedTier)), { status: 200 });
      }
      if (url.includes('/v1/near/stake/profits')) {
        stakedTier = 3;
        return new Response(
          JSON.stringify({
            quote: { amountInUsdc: '10.00', amountInAtomic: '10000000', amountOutNear: '2.5', nearUsd: 4, source: 'mock', dry: false },
            txHash: 'mock:sp1',
            position: null,
            walletBalanceNear: '2.5',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/tokens')) {
        return new Response(JSON.stringify({ tokens: [], presets: [{ assetId: 'nep141:usdc.near', symbol: 'USDC', decimals: 6, blockchain: 'near' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ source: 'fallback', amountOutFormatted: '10.00', minAmountOut: '9900000', timeEstimateSec: 12 }), { status: 200 });
    });

    const reloadBalances = vi.fn();
    const client = new TradeClient('tok', doFetch as unknown as typeof fetch);
    const header = new TradeStaking({ client, mode: () => mode, reloadBalances });
    const ramp = new RampView(client, { isMainnet: () => mode === 'mainnet' });
    document.body.append(header.pill.el, header.fee.el, header.profits.button, header.profits.dialog, ramp.root);

    const makeBalances = (colonyId: string): TradeBalancesResponse => ({
      planetId: 'planet-desert-01',
      colonyId,
      quote: { USDC: { free: '50000000', reserved: '0', total: '50000000' } },
      inOrbit: {},
    });

    header.updateBalances({ ...initialState('planet-desert-01', 'METALS/USDC'), balances: makeBalances('col_1') });
    await vi.waitFor(() => expect(header.pill.el.textContent).toContain('TIER 1'));
    expect(header.profits.button.hidden).toBe(false);

    // Switching colony updates StakingPill & FeePill to the new colony's wallet tier (Tier 3)
    header.updateBalances({ ...initialState('planet-ocean-02', 'METALS/USDC'), balances: makeBalances('col_2') });
    await vi.waitFor(() => expect(header.pill.el.textContent).toContain('TIER 3'));

    // Stake Trade Profits executes in mock mode and triggers reloadBalances
    header.profits.button.click();
    (header.profits.dialog.querySelector<HTMLInputElement>('[data-testid="stake-profits-amount"]')!).value = '10.00';
    (header.profits.dialog.querySelector<HTMLButtonElement>('[data-testid="stake-profits-submit"]')!).click();
    await vi.waitFor(() => expect(reloadBalances).toHaveBeenCalledTimes(1));

    // Mode switch syncs both Profits dialog and RampView confirmMainnet visibility
    mode = 'mainnet';
    header.syncMode();
    ramp.syncMode();
    expect(header.profits.dialog.querySelector('[data-testid="stake-profits-submit"]')?.textContent).toBe('GET QUOTE');
    expect((ramp.root.querySelector('[data-testid="ramp-confirm-row"]') as HTMLElement).hidden).toBe(false);
    header.pill.dispose();
  });
});
