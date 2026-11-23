import { z } from 'zod';
import { StakingAsset } from './core';
import { EvaluatedStakerPerksV2, AiBudgetView } from './perks';
import { StakingTierRow } from './tiers';

const Near = z.string().regex(/^\d+(\.\d+)?$/);
const Ms = z.number().int().nonnegative();

export const PERFORMANCE_WINDOWS = ['30d', '90d', '1y'] as const;
export const PerformanceWindow = z.enum(PERFORMANCE_WINDOWS);
export type PerformanceWindow = z.infer<typeof PerformanceWindow>;

/** `Live` = fresh oracle / RPC read; `Est.` = cached fallback (`STAKING_RULES.estNearUsd`). */
export const NearPriceView = z.strictObject({
  nearUsd: z.number().nonnegative(),
  source: z.enum(['live', 'est']),
  asOfMs: Ms,
});
export type NearPriceView = z.infer<typeof NearPriceView>;

/** `live` = trailing validator APY from RPC (mainnet); `sim` = `STAKING_RULES.simGrossApyBp` (mock / testnet). */
export const ApyView = z.strictObject({
  grossApyBp: z.number().int().nonnegative(),
  netApyBp: z.number().int().nonnegative(),
  protocolYieldShareBp: z.number().int().nonnegative(),
  source: z.enum(['live', 'sim']),
});
export type ApyView = z.infer<typeof ApyView>;

export const EcosystemTvlEntry = z.strictObject({
  id: z.enum(['metapool', 'linear', 'validator']),
  label: z.string().min(1).max(80),
  asset: StakingAsset,
  tvlNear: Near,
  sharePct: z.number().nonnegative().max(100),
});
export const EcosystemTvlView = z.strictObject({
  totalNear: Near,
  entries: z.array(EcosystemTvlEntry),
});
export type EcosystemTvlView = z.infer<typeof EcosystemTvlView>;

export const IncomeProjection = z.strictObject({
  amountNear: z.number().nonnegative(),
  dailyNear: z.number().nonnegative(),
  monthlyNear: z.number().nonnegative(),
  yearlyNear: z.number().nonnegative(),
  dailyUsd: z.number().nonnegative(),
  monthlyUsd: z.number().nonnegative(),
  yearlyUsd: z.number().nonnegative(),
});
export type IncomeProjection = z.infer<typeof IncomeProjection>;

/** `GET /v1/near/staking/overview?amount=<X>`: the public, unauthenticated preview (landing pill, `/me.html#staking`). */
export const StakingOverviewResponse = z.strictObject({
  asOfMs: Ms,
  network: z.enum(['mock', 'testnet', 'mainnet']),
  price: NearPriceView,
  apy: ApyView,
  tiers: z.array(StakingTierRow),
  rules: z.strictObject({
    feeWarmupMs: Ms,
    earlyExitWindowMs: Ms,
    earlyExitFeeBp: z.number().int().nonnegative(),
    freeTrialTurns: z.number().int().nonnegative(),
    standardTakerFeeBp: z.number().int().nonnegative(),
    unbondingMs: Ms.optional(),
    rewardRateMultiplier: z.number().positive().optional(),
  }),
  projection: IncomeProjection,
  ecosystem: EcosystemTvlView,
});
export type StakingOverviewResponse = z.infer<typeof StakingOverviewResponse>;

export const PerformancePoint = z.strictObject({
  tMs: Ms,
  /** Cumulative value in NEAR (yield + non-self fee savings + royalties + patron), realized or projected. */
  valueNear: z.number(),
  kind: z.enum(['realized', 'projected']),
});
export type PerformancePoint = z.infer<typeof PerformancePoint>;

export const StakingTxRow = z.strictObject({
  txHash: z.string().min(1),
  kind: z.enum(['stake', 'unstake', 'withdraw', 'compound', 'stake_profits', 'early_exit_fee']),
  amountNear: Near,
  asset: StakingAsset,
  atMs: Ms,
  explorerUrl: z.string().nullable(),
});
export type StakingTxRow = z.infer<typeof StakingTxRow>;

/** `GET /v1/near/staking/performance?accountId=…&window=30d|90d|1y` (W28-05 wealth dashboard). */
export const StakingPerformanceResponse = z.strictObject({
  accountId: z.string().min(2).max(64),
  asOfMs: Ms,
  price: NearPriceView,
  apy: ApyView,
  balances: z.strictObject({
    walletNear: Near,
    activeStakedNear: Near,
    unbondingNear: Near,
    withdrawableNear: Near,
    accruedYieldNear: Near,
    lst: z.array(z.strictObject({ asset: StakingAsset, amount: Near, nearValue: Near })),
    totalStakedUsd: z.number().nonnegative(),
  }),
  timers: z.strictObject({
    stakedSinceMs: Ms.nullable(),
    feeWarmupReadyAtMs: Ms.nullable(),
    earlyExitFreeAtMs: Ms.nullable(),
    earlyExitFeeBp: z.number().int().nonnegative(),
    unbondingReadyAtMs: Ms.nullable(),
  }),
  /** Income over the selected window, USD; self-fills (`buyerOwner == sellerOwner|stallOwner`) excluded. */
  income: z.strictObject({
    stakingYieldNear: z.number().nonnegative(),
    stakingYieldUsd: z.number().nonnegative(),
    marketFeeSavingsUsd: z.number().nonnegative(),
    stallRoyaltiesUsd: z.number().nonnegative(),
    patronRevenueUsd: z.number().nonnegative(),
    selfFillsExcluded: z.number().int().nonnegative(),
  }),
  projection: IncomeProjection,
  effectiveApyBp: z.number().int().nonnegative(),
  perks: EvaluatedStakerPerksV2,
  aiBudget: AiBudgetView,
  ecosystem: EcosystemTvlView,
  series: z.strictObject({ window: PerformanceWindow, points: z.array(PerformancePoint) }),
  txs: z.array(StakingTxRow),
});
export type StakingPerformanceResponse = z.infer<typeof StakingPerformanceResponse>;

/** One King-of-the-Hill seat: the highest active `≥500 NEAR` staker nominating the planet. */
export const PlanetPatronView = z.strictObject({
  planetId: z.string().min(1).max(80),
  accountId: z.string().min(2).max(64),
  /** `ISS <handle>.near` (shown on the orbit-menu Flagship Carrier). */
  carrierName: z.string().min(1).max(96),
  activeStakedNear: Near,
  sinceMs: Ms,
  /** Share of the Protocol's trade-fee cut paid to the patron (`1500` = `15 %`). */
  protocolFeeShareBp: z.number().int().nonnegative(),
});
export type PlanetPatronView = z.infer<typeof PlanetPatronView>;

/**
 * `GET /v1/near/staking/prestige?planetId=…`: cosmetic-only tier view for the 3D diorama (HQ uplink beam, dish,
 * drop-pod trail, gold trim) and the orbit-menu carrier. Read by the client renderer, never by `@terra/sim`.
 */
export const StakingPrestigeResponse = z.strictObject({
  planetId: z.string().min(1).max(80),
  leadPatron: PlanetPatronView.nullable(),
  /**
   * Per-colony tier. `colonyIndex` (the sim slot) lets the client match colonies whose sim id differs from the
   * `core.colony` id (dev scenarios seat `co_…` rows for sim colony `col_N`).
   */
  colonies: z.array(z.strictObject({ colonyId: z.string().min(1), colonyIndex: z.number().int().min(0).optional(), tier: z.number().int().min(0).max(4) })),
});
export type StakingPrestigeResponse = z.infer<typeof StakingPrestigeResponse>;
