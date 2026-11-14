import { z } from 'zod';
import { PlanetType } from '../ws/sim';

export const MOCK_DEED_CONTRACT = 'deeds.terraagent.mock';

export const deedTokenId = (colonyId: string): string =>
  colonyId.startsWith('deed:') ? colonyId : `deed:${colonyId}`;
export const deedMintOpId = (colonyId: string): string => `deed-mint:${colonyId}`;
export const deedMetaOpId = (colonyId: string, version: number): string => `deed-meta:${colonyId}:${version}`;
export const deedFinalOpId = (colonyId: string, version: number): string => `deed-final:${colonyId}:${version}`;
export const deedSettleOpId = (colonyId: string): string => `deed-settle:${colonyId}`;
export const accountClaimOpId = (colonyId: string): string => `account-claim:${colonyId}`;

export const DeedStatus = z.enum(['active', 'settled', 'eliminated', 'abandoned']);
export type DeedStatus = z.infer<typeof DeedStatus>;

export const DeedHexCoord = z.strictObject({
  q: z.number().int(),
  r: z.number().int(),
});
export type DeedHexCoord = z.infer<typeof DeedHexCoord>;

export const DeedPlanetType = z.union([PlanetType, z.enum(['dune', 'oceanForest', 'forestRock'])]);
export type DeedPlanetType = z.infer<typeof DeedPlanetType>;

/**
 * Colony Deed NFT metadata (`DeedMetadataV1`, W20-01 / NEAR §6).
 * Strictly validated: unknown fields are rejected, `walls` is optional and omitted while W14 is postponed,
 * and optional milestone fields are absent when their producer wave is off.
 */
export const DeedMetadataV1 = z.strictObject({
  planet: z.string().min(1),
  colony: z.string().min(1),
  colonyName: z.string().min(1).max(80).optional(),
  planetType: DeedPlanetType.optional(),
  stage: z.number().int().min(0).max(10).optional(),
  terraformBp: z.number().int().min(0).max(10_000).optional(),
  walls: z.number().int().nonnegative().optional(),
  tradeVolume: z.number().nonnegative().optional(),
  truces: z.number().int().nonnegative().optional(),
  rank: z.number().int().positive().optional(),
  territoryHexes: z.array(DeedHexCoord).max(512).optional(),
  status: DeedStatus,
  settled: z.boolean(),
  version: z.number().int().positive(),
  imageUrl: z.string().min(1),
});
export const DeedMetadataV1Schema = DeedMetadataV1;
export type DeedMetadataV1 = z.infer<typeof DeedMetadataV1>;

export const DeedHistoryEntry = z.strictObject({
  version: z.number().int().positive(),
  at: z.number().int().nonnegative(),
  change: z.string().min(1),
  txHash: z.string().optional(),
  metadata: DeedMetadataV1,
});
export type DeedHistoryEntry = z.infer<typeof DeedHistoryEntry>;

export const DeedPendingState = z.enum(['NONE', 'PENDING', 'FINAL', 'FAILED']);
export type DeedPendingState = z.infer<typeof DeedPendingState>;

export const DeedView = z.strictObject({
  tokenId: z.string().min(1),
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  playerId: z.string().optional(),
  ownerAccountId: z.string().min(1),
  contractId: z.string().min(1),
  status: DeedStatus,
  settled: z.boolean(),
  version: z.number().int().positive(),
  metadata: DeedMetadataV1,
  history: z.array(DeedHistoryEntry),
  pendingState: DeedPendingState,
  pendingRetries: z.number().int().nonnegative().optional(),
  lastError: z.string().optional(),
  txHash: z.string().optional(),
  mintedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  accountClaimed: z.boolean().optional(),
  claimedByAccountId: z.string().nullable().optional(),
  canSettle: z.boolean().optional(),
});
export type DeedView = z.infer<typeof DeedView>;

export const NearDeedListResponse = z.strictObject({
  deed: DeedView.nullable(),
  deeds: z.array(DeedView),
});
export type NearDeedListResponse = z.infer<typeof NearDeedListResponse>;

export const PublicDeedResponse = z.strictObject({
  tokenId: z.string().min(1),
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  ownerAccountId: z.string().min(1),
  contractId: z.string().min(1),
  status: DeedStatus,
  settled: z.boolean(),
  version: z.number().int().positive(),
  metadata: DeedMetadataV1,
  history: z.array(DeedHistoryEntry),
  txHash: z.string().optional(),
  mintedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type PublicDeedResponse = z.infer<typeof PublicDeedResponse>;

export const DeedUpdatedPayload = z.strictObject({
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  tokenId: z.string().min(1),
  version: z.number().int().positive(),
  change: z.string().min(1),
  status: DeedStatus,
  settled: z.boolean(),
  metadata: DeedMetadataV1,
  pendingState: DeedPendingState.optional(),
  txHash: z.string().optional(),
  deed: DeedView.optional(),
});
export const DeedUpdatedPayloadSchema = DeedUpdatedPayload;
export type DeedUpdatedPayload = z.infer<typeof DeedUpdatedPayload>;

export const Nep413Signature = z.strictObject({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().min(1).max(160),
  signature: z.string().min(1).max(512),
  message: z.string().min(1).max(1024),
  nonce: z.string().min(8).max(128),
  recipient: z.string().min(1).max(128),
  callbackUrl: z.string().max(512).optional(),
});
export type Nep413Signature = z.infer<typeof Nep413Signature>;

export const StakingPoolInfo = z.strictObject({
  poolId: z.string().min(2).max(64),
  name: z.string().min(1).max(80),
  apyBp: z.number().int().nonnegative().max(100_000),
});
export type StakingPoolInfo = z.infer<typeof StakingPoolInfo>;

export const StakingPositionDto = z.strictObject({
  colonyId: z.string().min(1),
  accountId: z.string().min(2).max(64),
  pool: z.string().min(2).max(64),
  poolName: z.string().optional(),
  apyBp: z.number().int().nonnegative().optional(),
  staked: z.string().regex(/^\d+(\.\d+)?$/),
  unbonding: z.string().regex(/^\d+(\.\d+)?$/),
  unbondingReadyAtMs: z.number().int().nonnegative().nullable(),
  withdrawable: z.string().regex(/^\d+(\.\d+)?$/),
  rewards: z.string().regex(/^\d+(\.\d+)?$/),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type StakingPositionDto = z.infer<typeof StakingPositionDto>;

export const StakeRequestSchema = z.strictObject({
  colonyId: z.string().min(1).optional(),
  pool: z.string().min(2).max(64),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
});
export type StakeRequest = z.infer<typeof StakeRequestSchema>;

export const UnstakeRequestSchema = z.strictObject({
  colonyId: z.string().min(1).optional(),
  pool: z.string().min(2).max(64),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
});
export type UnstakeRequest = z.infer<typeof UnstakeRequestSchema>;

export const WithdrawRequestSchema = z.strictObject({
  colonyId: z.string().min(1).optional(),
  pool: z.string().min(2).max(64),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
});
export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;

export const StakerPerksInfo = z.strictObject({
  active: z.boolean(),
  minStakeNear: z.string(),
  totalStakedNear: z.string(),
  grossApyBp: z.number().int().nonnegative(),
  netApyBp: z.number().int().nonnegative(),
  protocolYieldShareBp: z.number().int().nonnegative(),
  platformFeeBp: z.number().int().nonnegative(),
  stakerPlatformFeeBp: z.number().int().nonnegative().optional(),
  standardPlatformFeeBp: z.number().int().nonnegative(),
  managedAutopilotUnlocked: z.boolean(),
  protocolAccountId: z.string().min(2).max(64),
});
export type StakerPerksInfo = z.infer<typeof StakerPerksInfo>;

export const StakingStatusResponse = z.strictObject({
  colonyId: z.string().min(1),
  accountId: z.string().min(2).max(64),
  walletAccountId: z.string().min(2).max(64),
  walletBalanceNear: z.string(),
  deedSettled: z.boolean(),
  accountClaimed: z.boolean(),
  claimedByAccountId: z.string().nullable(),
  pools: z.array(StakingPoolInfo),
  positions: z.array(StakingPositionDto),
  perks: StakerPerksInfo.optional(),
});
export type StakingStatusResponse = z.infer<typeof StakingStatusResponse>;

export const StakingActionResponse = z.strictObject({
  txHash: z.string().min(1),
  position: StakingPositionDto,
  walletBalanceNear: z.string(),
});
export type StakingActionResponse = z.infer<typeof StakingActionResponse>;

export const ClaimAccountRequestSchema = z.strictObject({
  colonyId: z.string().min(1).optional(),
  newPublicKey: z.string().min(1).max(160).optional(),
  walletAccountId: z.string().min(2).max(64).optional(),
  walletSignature: Nep413Signature.optional(),
  opId: z.string().min(1).max(200).optional(),
});
export type ClaimAccountRequest = z.infer<typeof ClaimAccountRequestSchema>;

export const ClaimAccountResponseSchema = z.strictObject({
  colonyId: z.string().min(1),
  accountId: z.string().min(2).max(64),
  claimedAt: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  claimedByAccountId: z.string().min(2).max(64),
  txHash: z.string().min(1),
});
export type ClaimAccountResponse = z.infer<typeof ClaimAccountResponseSchema>;

/** Computes SVG polygon points for a flat-top/point-top hex at `(cx, cy)` with radius `r`. */
export function deedHexPolygonPoints(cx: number, cy: number, radius: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    const x = Math.round((cx + radius * Math.cos(angle)) * 10) / 10;
    const y = Math.round((cy + radius * Math.sin(angle)) * 10) / 10;
    pts.push(`${x},${y}`);
  }
  return pts.join(' ');
}
