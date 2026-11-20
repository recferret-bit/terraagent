// Schema-valid `StakingPerformanceResponse` fixtures shared by the dashboard specs (and mirrored by the Playwright mock).
import type { StakingPerformanceResponse } from '@terra/contracts';
import { STAKING_TIERS } from '@terra/contracts/staking/tiers';

export const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

export function makePerformance(over: Partial<StakingPerformanceResponse> = {}, window: '30d' | '90d' | '1y' = '30d'): StakingPerformanceResponse {
  const tier = STAKING_TIERS[2]!;
  const base: StakingPerformanceResponse = {
    accountId: 'pilot.mock',
    asOfMs: NOW,
    price: { nearUsd: 5, source: 'live', asOfMs: NOW },
    apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'sim' },
    balances: {
      walletNear: '12.5', activeStakedNear: '60', unbondingNear: '0', withdrawableNear: '0', accruedYieldNear: '0.5',
      lst: [{ asset: 'stNEAR', amount: '10', nearValue: '10.5' }], totalStakedUsd: 352.5,
    },
    timers: { stakedSinceMs: NOW - 2 * DAY, feeWarmupReadyAtMs: null, earlyExitFreeAtMs: NOW + 5 * DAY, earlyExitFeeBp: 25, unbondingReadyAtMs: null },
    income: { stakingYieldNear: 1, stakingYieldUsd: 5, marketFeeSavingsUsd: 2, stallRoyaltiesUsd: 0, patronRevenueUsd: 0, selfFillsExcluded: 3 },
    projection: { amountNear: 70.5, dailyNear: 0.0139, monthlyNear: 0.423, yearlyNear: 5.076, dailyUsd: 0.07, monthlyUsd: 2.1, yearlyUsd: 25.4 },
    effectiveApyBp: 810,
    perks: {
      active: true, minStakeNear: '10', totalStakedNear: '70.5', grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000,
      platformFeeBp: 65, standardPlatformFeeBp: 100, managedAutopilotUnlocked: true, protocolAccountId: 'protocol.mock',
      version: 2, tier: 2, tierKey: tier.key, tierName: tier.name, feeTier: 1, activeStakedNear: '60', unbondingNear: '0',
      aiModel: 'z-ai/glm-5.3-flash', aiMode: 'tee', maxAiColonySlots: tier.aiColonySlots, activeAiColonySlots: 1, dailyAiCallLimit: 90,
      dailyAiCallsUsed: 10, dailyAiBudgetUsd: 0.5, freeTrialTurnsRemaining: 0, feeWarmupReadyAtMs: null, earlyExitFeeBp: 25,
      earlyExitFreeAtMs: NOW + 5 * DAY, stakedSinceMs: NOW - 2 * DAY, gasMultiplier: tier.gasMultiplier, sweepSeconds: tier.sweepSeconds,
      botKeys: tier.botKeys, guildRadarLeadMs: tier.guildRadarLeadMs, daoVoteWeightBp: tier.daoVoteWeightBp,
      stallRoyaltyBonusBp: tier.stallRoyaltyBonusBp, leadPatronPlanetIds: ['dune'], nextTierMinNear: STAKING_TIERS[3]!.minStakeNear,
    },
    aiBudget: {
      model: 'z-ai/glm-5.3-flash', mode: 'tee', dailyBudgetUsd: 0.5, dailyBudgetUsedUsd: 0.1, dailyCallLimit: 90, dailyCallsUsed: 10,
      tradeBonusCalls: 4, freeTrialTurnsRemaining: 0, freeTrialTurnsTotal: 5, trialEligible: true, colonySlotsUsed: 1, colonySlotsMax: tier.aiColonySlots,
    },
    ecosystem: { totalNear: '0', entries: [] },
    series: {
      window,
      points: [
        { tMs: NOW - 10 * DAY, valueNear: 0, kind: 'realized' },
        { tMs: NOW - 5 * DAY, valueNear: 0.4, kind: 'realized' },
        { tMs: NOW, valueNear: 1, kind: 'realized' },
        { tMs: NOW + 15 * DAY, valueNear: 1.6, kind: 'projected' },
        { tMs: NOW + 30 * DAY, valueNear: 2.2, kind: 'projected' },
      ],
    },
    txs: [
      { txHash: 'AbCdEf0123456789XyZ', kind: 'stake', amountNear: '60', asset: 'near', atMs: NOW - 2 * DAY, explorerUrl: 'https://testnet.nearblocks.io/txns/AbCdEf0123456789XyZ' },
      { txHash: 'mock-tx-1', kind: 'compound', amountNear: '0.1', asset: 'near', atMs: NOW - DAY, explorerUrl: null },
    ],
  };
  return { ...base, ...over };
}
