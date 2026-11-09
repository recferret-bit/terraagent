import { RESOURCE_FAMILY_OF, type ResourceFamily, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import type { CompiledDataLike } from '../../../kernel/config';
import type { ColonyState, PlanetState } from '../../../kernel/state';
import { BASE_HUB_STORAGE_CAP } from '../../economy/ledger';
import { getEnvironment } from '../../environment';
import { workerPowerDrain } from '../../harvest/workers';
import { computeSolarOutputPerS, resolvePowerRow, type ColonyPowerSummary } from '../../power-core';

export const MAX_NEED_BP = 10000;
export const NEED_KEYS = ['energy', 'storage', 'supply', 'extraction', 'defense', 'expand', 'repair'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

export const PRIMARY_STORAGE_RESOURCES: readonly ResourceKey[] = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'];

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

export function readStoredPower(
  state: PlanetState,
  colonyIndex: number,
): (Partial<ColonyPowerSummary> & Record<string, unknown>) | null {
  const fromColony = state.colonies[colonyIndex]?.power;
  if (fromColony && typeof fromColony === 'object') return fromColony as Partial<ColonyPowerSummary> & Record<string, unknown>;
  const blobEntry = state.blobs.power;
  if (!blobEntry || typeof blobEntry !== 'object') return null;
  const val = ('value' in blobEntry && blobEntry.value && typeof blobEntry.value === 'object' ? blobEntry.value : blobEntry) as Record<string, unknown>;
  const byColony = val.byColony as Record<string, unknown> | undefined;
  const hit = byColony?.[String(colonyIndex)] ?? val[String(colonyIndex)];
  return hit && typeof hit === 'object' ? (hit as Partial<ColonyPowerSummary> & Record<string, unknown>) : null;
}

export function readDeficitTicks(
  state: PlanetState,
  colonyIndex: number,
  powerObj: Record<string, unknown> | null,
): number {
  const col = state.colonies[colonyIndex];
  if (typeof col?.brownoutTicks === 'number') return col.brownoutTicks;
  if (typeof powerObj?.deficitTicks === 'number') return powerObj.deficitTicks;
  if (typeof powerObj?.brownoutTicks === 'number') return powerObj.brownoutTicks;
  const val = state.blobs.power?.value as { trackers?: Record<string, { brownoutTicks?: number }> } | undefined;
  const tr = val?.trackers?.[String(colonyIndex)];
  return typeof tr?.brownoutTicks === 'number' ? tr.brownoutTicks : 0;
}

export function estimateEntityPower(state: PlanetState, colonyIndex: number, data?: CompiledDataLike): {
  founderCorePerS: number;
  solarNetPerS: number;
  solarInternalDrainPerS: number;
  supply: number;
  rawDemand: number;
} {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const extRow = resolvePowerRow(data, 'economyT1Basic', 'metalsExtractor');
  const env = getEnvironment(state, data);
  const cols = state.entities.cols;
  let hubCount = 0, solarDrain = 0, solarNet = 0, onlineGen = 0, demand = 0;

  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row], st = cols.state[row];
    if (st === ENTITY_STATE.constructing || st === ENTITY_STATE.offlineUnpowered) continue;
    if (kind === ENTITY_KIND.commandHub) {
      hubCount++;
    } else if (kind === ENTITY_KIND.solar) {
      const out = computeSolarOutputPerS(env.daylight, state.meta.planetType, data);
      solarDrain += out.internalDrain;
      solarNet += out.net;
      if (env.phase !== 'night' && env.daylight > 0.001 && out.net > 0) onlineGen += out.net;
    } else if (kind === ENTITY_KIND.metalsExtractor) {
      demand += Number(extRow.powerDrainPerS ?? 6);
    } else if (kind === ENTITY_KIND.worker) {
      const full = workerPowerDrain(cols.tier[row] || 1, data);
      demand += st === ENTITY_STATE.idle || st === ENTITY_STATE.offlineBrownout ? full * 0.5 : full;
    }
  }
  const founderCorePerS = hubCount * Number(hubRow.founderCoreGenPerS ?? 8);
  const hubDrain = hubCount * Number(hubRow.powerDrainPerS ?? 5);
  return { founderCorePerS, solarNetPerS: solarNet, solarInternalDrainPerS: solarDrain, supply: founderCorePerS + onlineGen, rawDemand: hubDrain + demand };
}

export function readResourceStockAndCaps(
  colony: ColonyState | undefined,
  overrides?: NeedsEvalInput,
): { stock: Record<ResourceKey, number>; capFor: (key: ResourceKey) => number } {
  const rawStock = (overrides?.stock ?? colony?.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const rawCaps = (overrides?.caps ?? colony?.caps ?? {}) as Partial<Record<string, number>>;
  const stock = {} as Record<ResourceKey, number>;
  for (const key of PRIMARY_STORAGE_RESOURCES) {
    stock[key] = typeof rawStock[key] === 'number' && Number.isFinite(rawStock[key]!) ? rawStock[key]! : 0;
  }
  const capFor = (key: ResourceKey): number => {
    const direct = rawCaps[key];
    if (typeof direct === 'number' && direct > 0) return direct;
    const famCap = rawCaps[RESOURCE_FAMILY_OF[key]];
    return typeof famCap === 'number' && famCap > 0 ? famCap : BASE_HUB_STORAGE_CAP;
  };
  return { stock, capFor };
}

export function findColonyAnchors(state: PlanetState, colonyIndex: number): Array<{ q: number; r: number }> {
  const cols = state.entities.cols;
  const anchors: Array<{ q: number; r: number }> = [];
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] === colonyIndex && cols.hp[row] > 0) anchors.push({ q: cols.q[row], r: cols.r[row] });
  }
  if (anchors.length === 0) anchors.push({ q: 0, r: 0 });
  return anchors;
}
