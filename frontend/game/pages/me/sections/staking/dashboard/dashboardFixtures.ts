// Schema-valid `StakingPerformanceResponse` fixtures shared by the dashboard specs (and mirrored by the Playwright mock).
import { CANONICAL_PLANETS, type StakingPerformanceResponse } from '@terra/contracts';
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
      stallRoyaltyBonusBp: tier.stallRoyaltyBonusBp, leadPatronPlanetIds: [CANONICAL_PLANETS.desert.id], nextTierMinNear: STAKING_TIERS[3]!.minStakeNear,
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
    patronage: {
      nominatedPlanetId: CANONICAL_PLANETS.desert.id,
      planets: [
        {
          planetId: CANONICAL_PLANETS.desert.id,
          leadPatron: { planetId: CANONICAL_PLANETS.desert.id, accountId: 'whale.near', carrierName: 'ISS whale.near', activeStakedNear: '750', sinceMs: NOW - 5 * DAY, protocolFeeShareBp: 1500 },
          stakeToLeadNear: '750',
          totalContenders: 2,
          contenders: [
            { rank: 1, accountId: 'whale.near', carrierName: 'ISS whale.near', activeStakedNear: '750', tier: 4, status: 'lead', gapToLeadNear: '0', stakedSinceMs: NOW - 10 * DAY, nominatedAtMs: NOW - 5 * DAY, isSelf: false },
            { rank: 2, accountId: 'pilot.mock', carrierName: 'ISS pilot.near', activeStakedNear: '70.5', tier: 2, status: 'below_threshold', gapToLeadNear: '679.5', stakedSinceMs: NOW - 2 * DAY, nominatedAtMs: NOW - DAY, isSelf: true },
          ],
          history: [
            { id: 'h-d-1', planetId: CANONICAL_PLANETS.desert.id, accountId: 'whale.near', carrierName: 'ISS whale.near', kind: 'fee_payout', activeStakedNear: '750', previousAccountId: null, previousStakedNear: null, payoutUsd: 12.5, atMs: NOW - DAY },
            { id: 'h-d-2', planetId: CANONICAL_PLANETS.desert.id, accountId: 'whale.near', carrierName: 'ISS whale.near', kind: 'seat_claimed', activeStakedNear: '750', previousAccountId: null, previousStakedNear: null, payoutUsd: null, atMs: NOW - 5 * DAY },
          ],
        },
        {
          planetId: CANONICAL_PLANETS.ocean.id,
          leadPatron: { planetId: CANONICAL_PLANETS.ocean.id, accountId: 'ocean.near', carrierName: 'ISS ocean.near', activeStakedNear: '520', sinceMs: NOW - 4 * DAY, protocolFeeShareBp: 1500 },
          stakeToLeadNear: '520',
          totalContenders: 1,
          contenders: [
            { rank: 1, accountId: 'ocean.near', carrierName: 'ISS ocean.near', activeStakedNear: '520', tier: 4, status: 'lead', gapToLeadNear: '0', stakedSinceMs: NOW - 8 * DAY, nominatedAtMs: NOW - 4 * DAY, isSelf: false },
          ],
          history: [
            { id: 'h-o-1', planetId: CANONICAL_PLANETS.ocean.id, accountId: 'ocean.near', carrierName: 'ISS ocean.near', kind: 'seat_claimed', activeStakedNear: '520', previousAccountId: null, previousStakedNear: null, payoutUsd: null, atMs: NOW - 4 * DAY },
          ],
        },
        {
          planetId: CANONICAL_PLANETS.temperate.id,
          leadPatron: null,
          stakeToLeadNear: '500',
          totalContenders: 1,
          contenders: [
            { rank: 1, accountId: 'scout.near', carrierName: 'ISS scout.near', activeStakedNear: '320', tier: 3, status: 'below_threshold', gapToLeadNear: '180', stakedSinceMs: NOW - 3 * DAY, nominatedAtMs: NOW - 2 * DAY, isSelf: false },
          ],
          history: [
            { id: 'h-t-1', planetId: CANONICAL_PLANETS.temperate.id, accountId: 'scout.near', carrierName: 'ISS scout.near', kind: 'nominated', activeStakedNear: '320', previousAccountId: null, previousStakedNear: null, payoutUsd: null, atMs: NOW - 2 * DAY },
          ],
        },
      ],
    },
  };
  return { ...base, ...over };
}
