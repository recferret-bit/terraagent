// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS } from '@terra/contracts';
import { TradeClient } from '../api/client';
import { initialState } from '../model/state';
import { TradeStaking } from './stakingHeader';

const makePerksPayload = (accountId = 'pilot.testnet', tier: 0 | 1 | 2 | 3 | 4 = 2, futureWarmupMs: number | null = Date.now() + 3_600_000) => {
  const row = STAKING_TIERS[tier]!;
  return {
    accountId,
    perks: {
      active: tier >= 1,
      minStakeNear: '10',
      totalStakedNear: String(row.minStakeNear || 0),
      grossApyBp: 900,
      netApyBp: 720,
      protocolYieldShareBp: 2000,
      platformFeeBp: futureWarmupMs ? 65 : row.takerFeeBp,
      standardPlatformFeeBp: 100,
      managedAutopilotUnlocked: tier >= 1,
      protocolAccountId: 'protocol.testnet',
      version: 2 as const,
      tier,
      tierKey: row.key,
      tierName: row.name,
      feeTier: futureWarmupMs ? 1 : tier,
      activeStakedNear: String(row.minStakeNear || 0),
      unbondingNear: '0',
      aiModel: 'z-ai/glm-5.3-flash',
      aiMode: 'tee' as const,
      maxAiColonySlots: row.aiColonySlots,
      activeAiColonySlots: 0,
      dailyAiCallLimit: 90,
      dailyAiCallsUsed: 0,
      dailyAiBudgetUsd: 0.25,
      freeTrialTurnsRemaining: 0,
      feeWarmupReadyAtMs: futureWarmupMs,
      earlyExitFeeBp: 0,
      earlyExitFreeAtMs: null,
      stakedSinceMs: Date.now() - 10_000,
      gasMultiplier: row.gasMultiplier,
      sweepSeconds: row.sweepSeconds,
      botKeys: row.botKeys,
      guildRadarLeadMs: row.guildRadarLeadMs,
      daoVoteWeightBp: row.daoVoteWeightBp,
      stallRoyaltyBonusBp: row.stallRoyaltyBonusBp,
      leadPatronPlanetIds: [],
      nextTierMinNear: tier < 4 ? STAKING_TIERS[tier + 1]!.minStakeNear : null,
    },
    aiBudget: {
      model: 'z-ai/glm-5.3-flash',
      mode: 'tee' as const,
      dailyBudgetUsd: 0.25,
      dailyBudgetUsedUsd: 0,
      dailyCallLimit: 90,
      dailyCallsUsed: 0,
      tradeBonusCalls: 0,
      freeTrialTurnsRemaining: 0,
      freeTrialTurnsTotal: 5,
      trialEligible: true,
      colonySlotsUsed: 0,
      colonySlotsMax: row.aiColonySlots,
    },
  };
};

describe('TradeStaking header controller (unit)', () => {
  it('mounts StakingPill + FeePill, refreshes perks & warmup fee countdown, and hides on 404 or empty account/token', async () => {
    let status = 200;
    const doFetch = vi.fn(async (input: string) => {
      if (input.includes('/v1/near/staking/overview')) {
        return new Response(JSON.stringify({ apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'live' } }), { status: 200 });
      }
      if (status !== 200) return new Response('{}', { status });
      return new Response(JSON.stringify(makePerksPayload('pilot.testnet', 2, Date.now() + 7_200_000)), { status: 200 });
    });

    const reloadBalances = vi.fn();
    let mode: 'mock' | 'testnet' | 'mainnet' = 'mock';
    const header = new TradeStaking({
      client: new TradeClient('tok-1', doFetch as unknown as typeof fetch),
      mode: () => mode,
      accountId: () => 'pilot.testnet',
      reloadBalances,
    });

    await header.refresh();
    expect(header.pill.el.hidden).toBe(false);
    expect(header.pill.el.textContent).toContain('TIER 2');
    expect(header.fee.el.hidden).toBe(false);
    expect(header.fee.el.dataset.warmup).toBe('true');

    // Syncing mode toggles Stake Profits label between mock execute and testnet quote
    mode = 'testnet';
    header.syncMode();
    expect(header.profits.dialog.querySelector('[data-testid="stake-profits-submit"]')?.textContent).toBe('GET QUOTE');

    header.tick();
    expect(header.fee.el.hidden).toBe(false);

    // 404 hides both pills cleanly (W28 wave off)
    status = 404;
    await header.refresh();
    expect(header.pill.el.hidden).toBe(true);
    expect(header.fee.el.hidden).toBe(true);

    // Update balances hides profits button when no USDC quote token is free
    const state = initialState('planet-desert-01', 'METALS/USDC');
    header.updateBalances(state);
    expect(header.profits.button.hidden).toBe(true);

    header.pill.dispose();
  });
});
