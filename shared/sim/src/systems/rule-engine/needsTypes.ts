import type { ResourceFamily, ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';

export const MAX_NEED_BP = 10000;
export const NEED_KEYS = ['energy', 'storage', 'supply', 'extraction', 'defense', 'expand', 'repair'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

export interface NeedsEvalInput {
  data?: CompiledDataLike;
  netPowerPerS?: number;
  net?: number;
  supplyPerS?: number;
  supply?: number;
  rawDemandPerS?: number;
  rawDemand?: number;
  demand?: number;
  solarNetPerS?: number;
  founderCorePerS?: number;
  nightNetPerS?: number;
  brownout?: boolean;
  deficitTicks?: number;
  stock?: Partial<Record<ResourceKey, number>>;
  caps?: Partial<Record<ResourceFamily | ResourceKey, number>>;
  storageFillRatio?: number;
  maxStorageRatio?: number;
  supplyUsed?: number;
  supplyCap?: number;
  producerIdle?: boolean;
  factoryIdle?: boolean;
  extractorCount?: number;
  resourceIncomePerS?: Partial<Record<ResourceKey, number>> | number;
  resourceSpendPerS?: Partial<Record<ResourceKey, number>> | number;
  hostilesWithin15?: number;
  underAttack?: boolean;
  recentDamage?: number;
  freeBuildableOwnedTiles?: number;
  unclaimedDepositsWithin20?: number;
  ownedDepositsAllOccupied?: boolean;
  damagedEntities?: number;
  severedEntities?: number;
  minHpRatio?: number;
}

export type NeedsEvalOverrides = NeedsEvalInput;

export interface ColonyNeedsDetail {
  netPowerPerS: number;
  nightNetPerS: number;
  brownout: boolean;
  deficitTicks: number;
  maxStorageRatio: number;
  supplyRatio: number;
  supplyUsed: number;
  supplyCap: number;
  producerIdle: boolean;
  extractorCount: number;
  minResourceRatio: number;
  netResourcePerS: number;
  hostilesWithin15: number;
  underAttack: boolean;
  freeBuildableOwnedTiles: number;
  unclaimedDepositsWithin20: number;
  ownedDepositsAllOccupied: boolean;
  damagedEntityCount: number;
  severedEntityCount: number;
  minHpRatio: number;
}

export interface ColonyNeedsScore {
  colonyIndex: number;
  energy: number;
  storage: number;
  supply: number;
  extraction: number;
  defense: number;
  expand: number;
  repair: number;
  scores: Record<NeedKey, number>;
  topNeed: NeedKey;
  topScore: number;
  detail: ColonyNeedsDetail;
}

export function clampBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_NEED_BP, Math.round(value)));
}
