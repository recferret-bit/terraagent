import { RESOURCE_FAMILY_OF, type ResourceFamily, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { BASE_HUB_STORAGE_CAP } from '../economy/ledger';
import { getEnvironment } from '../environment';
import { getColonySupply, getHubUnitQueue } from '../factories-hub';
import { computeSolarOutputPerS, resolvePowerRow, type ColonyPowerSummary } from '../power-core';

export const MAX_NEED_BP = 10000;
export const NEED_KEYS = ['energy', 'storage', 'supply', 'extraction', 'defense', 'expand', 'repair'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

const PRIMARY_STORAGE_RESOURCES: readonly ResourceKey[] = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'];

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

function clampBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_NEED_BP, Math.round(value)));
}

function readStoredPower(state: PlanetState, colonyIndex: number): (Partial<ColonyPowerSummary> & Record<string, unknown>) | null {
  const fromColony = state.colonies[colonyIndex]?.power;
  if (fromColony && typeof fromColony === 'object') return fromColony as Partial<ColonyPowerSummary> & Record<string, unknown>;
  const blobEntry = state.blobs.power;
  if (!blobEntry || typeof blobEntry !== 'object') return null;
  const val = ('value' in blobEntry && blobEntry.value && typeof blobEntry.value === 'object' ? blobEntry.value : blobEntry) as Record<string, unknown>;
  const byColony = val.byColony as Record<string, unknown> | undefined;
  const hit = byColony?.[String(colonyIndex)] ?? val[String(colonyIndex)];
  return hit && typeof hit === 'object' ? (hit as Partial<ColonyPowerSummary> & Record<string, unknown>) : null;
}

function readDeficitTicks(state: PlanetState, colonyIndex: number, powerObj: Record<string, unknown> | null): number {
  const col = state.colonies[colonyIndex];
  if (typeof col?.brownoutTicks === 'number') return col.brownoutTicks;
  if (typeof powerObj?.deficitTicks === 'number') return powerObj.deficitTicks;
  if (typeof powerObj?.brownoutTicks === 'number') return powerObj.brownoutTicks;
  const val = state.blobs.power?.value as { trackers?: Record<string, { brownoutTicks?: number }> } | undefined;
  const tr = val?.trackers?.[String(colonyIndex)];
  return typeof tr?.brownoutTicks === 'number' ? tr.brownoutTicks : 0;
}

function estimateEntityPower(state: PlanetState, colonyIndex: number, data?: CompiledDataLike): {
  founderCorePerS: number;
  solarNetPerS: number;
  solarInternalDrainPerS: number;
  supply: number;
  rawDemand: number;
} {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const extRow = resolvePowerRow(data, 'economyT1Basic', 'metalsExtractor');
  const harvRow = resolvePowerRow(data, 'unitsWorkersBasic', 'harvester');
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
    } else if (kind === ENTITY_KIND.harvester) {
      const full = Number(harvRow.powerDrainPerS ?? 1.5);
      demand += st === ENTITY_STATE.idle || st === ENTITY_STATE.offlineBrownout ? full * 0.5 : full;
    }
  }
  const founderCorePerS = hubCount * Number(hubRow.founderCoreGenPerS ?? 8);
  const hubDrain = hubCount * Number(hubRow.powerDrainPerS ?? 5);
  return { founderCorePerS, solarNetPerS: solarNet, solarInternalDrainPerS: solarDrain, supply: founderCorePerS + onlineGen, rawDemand: hubDrain + demand };
}

export function scoreEnergyNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; netPowerPerS: number; nightNetPerS: number; brownout: boolean; deficitTicks: number } {
  const stored = readStoredPower(state, colonyIndex);
  const est = stored ? null : estimateEntityPower(state, colonyIndex, overrides?.data);
  const supply = overrides?.supplyPerS ?? overrides?.supply ?? Number(stored?.supply ?? est?.supply ?? 0);
  const rawDemand = overrides?.rawDemandPerS ?? overrides?.rawDemand ?? overrides?.demand ?? Number(stored?.rawDemand ?? stored?.demand ?? est?.rawDemand ?? 0);
  const solarNetPerS = overrides?.solarNetPerS ?? Number(stored?.solarNetPerS ?? est?.solarNetPerS ?? 0);
  const solarDrain = Number(stored?.solarInternalDrainPerS ?? est?.solarInternalDrainPerS ?? 0);
  const founderCore = overrides?.founderCorePerS ?? Number(stored?.founderCorePerS ?? est?.founderCorePerS ?? 0);
  const netPowerPerS = overrides?.netPowerPerS ?? overrides?.net ?? Number(stored?.net ?? supply - rawDemand);
  const deficitTicks = overrides?.deficitTicks ?? readDeficitTicks(state, colonyIndex, stored);
  const brownout = overrides?.brownout ?? (Boolean(stored?.brownout) || deficitTicks > 0 || netPowerPerS < 0 || rawDemand > supply + 1e-6);

  let nightNetPerS: number;
  if (typeof overrides?.nightNetPerS === 'number') {
    nightNetPerS = overrides.nightNetPerS;
  } else if (typeof stored?.nightNetPerS === 'number') {
    nightNetPerS = stored.nightNetPerS;
  } else {
    const nonSolarSupply = solarNetPerS !== 0
      ? supply - Math.max(0, solarNetPerS) - solarDrain
      : founderCore > 0 && founderCore < supply ? founderCore : supply;
    nightNetPerS = nonSolarSupply - rawDemand;
  }

  let score = 0;
  const deficitE = Math.max(0, -netPowerPerS, rawDemand - supply);
  if (brownout || netPowerPerS < 0) {
    score = clampBp(8000 + Math.min(2000, Math.round(deficitE * 200) + deficitTicks * 10));
  } else if (nightNetPerS < 0) {
    score = clampBp(6000 + Math.min(3500, Math.round(Math.abs(nightNetPerS) * 200)));
  } else if (supply > 0 || rawDemand > 0 || overrides?.netPowerPerS !== undefined || overrides?.net !== undefined) {
    score = netPowerPerS < 5
      ? clampBp(3000 + Math.round((5 - netPowerPerS) * 500))
      : clampBp(Math.max(0, 2000 - Math.round((netPowerPerS - 5) * 100)));
  }
  return { score, netPowerPerS, nightNetPerS, brownout, deficitTicks };
}

function readResourceStockAndCaps(
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

export function scoreStorageNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; maxStorageRatio: number } {
  const { stock, capFor } = readResourceStockAndCaps(state.colonies[colonyIndex], overrides);
  let maxRatio = overrides?.storageFillRatio ?? overrides?.maxStorageRatio ?? 0;
  if (overrides?.storageFillRatio === undefined && overrides?.maxStorageRatio === undefined) {
    for (const key of PRIMARY_STORAGE_RESOURCES) {
      const cap = capFor(key);
      if (cap > 0 && stock[key] / cap > maxRatio) maxRatio = stock[key] / cap;
    }
  }
  let score = 0;
  if (maxRatio >= 0.85) score = clampBp(4000 + Math.round(((maxRatio - 0.85) / 0.15) * 6000));
  else if (maxRatio > 0.7) score = clampBp(Math.round((maxRatio - 0.7) * 20000));
  return { score, maxStorageRatio: maxRatio };
}

export function scoreSupplyNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; supplyRatio: number; supplyUsed: number; supplyCap: number; producerIdle: boolean } {
  const colony = state.colonies[colonyIndex];
  const colSupply = colony?.supply as { used?: number; cap?: number } | undefined;
  const prodBlob = (state.blobs.production?.value as Record<string, { supplyUsed?: number; supplyCap?: number; factoryIdle?: boolean }> | undefined)?.[String(colonyIndex)];
  const queueEntries = getHubUnitQueue(state, colonyIndex);
  const computed = getColonySupply(state, colonyIndex, queueEntries, overrides?.data);

  const supplyUsed = overrides?.supplyUsed ?? (typeof colony?.supplyUsed === 'number' ? colony.supplyUsed : undefined) ?? colSupply?.used ?? prodBlob?.supplyUsed ?? computed.used;
  const supplyCap = overrides?.supplyCap ?? (typeof colony?.supplyCap === 'number' ? colony.supplyCap : undefined) ?? colSupply?.cap ?? prodBlob?.supplyCap ?? computed.cap;
  const explicitIdle = overrides?.producerIdle ?? overrides?.factoryIdle ?? prodBlob?.factoryIdle;
  const producerIdle = explicitIdle !== undefined ? explicitIdle : true;
  const supplyRatio = supplyCap > 0 ? supplyUsed / supplyCap : 0;

  let score = 0;
  if (supplyCap > 0 && supplyRatio >= 0.9 && (producerIdle || queueEntries.length > 0)) {
    score = clampBp(6000 + Math.round(((supplyRatio - 0.9) / 0.1) * 4000));
  } else if (supplyCap > 0 && supplyRatio >= 0.75) {
    score = clampBp(Math.round(((supplyRatio - 0.75) / 0.15) * 5000));
  }
  return { score, supplyRatio, supplyUsed, supplyCap, producerIdle };
}

export function scoreExtractionNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; extractorCount: number; minResourceRatio: number; netResourcePerS: number } {
  const colony = state.colonies[colonyIndex];
  const { stock, capFor } = readResourceStockAndCaps(colony, overrides);
  const cols = state.entities.cols;
  let extractors = 0, activeExtractors = 0;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] === colonyIndex && cols.hp[row] > 0 && cols.kind[row] === ENTITY_KIND.metalsExtractor) {
      extractors++;
      if (cols.state[row] === ENTITY_STATE.active) activeExtractors++;
    }
  }
  const extractorCount = overrides?.extractorCount ?? extractors;
  const prod = colony?.production as { familyIncomePerS?: Record<string, number> } | undefined;
  let income = 0;
  if (typeof overrides?.resourceIncomePerS === 'number') income = overrides.resourceIncomePerS;
  else if (overrides?.resourceIncomePerS) for (const v of Object.values(overrides.resourceIncomePerS)) income += v ?? 0;
  else if (prod?.familyIncomePerS) income = (prod.familyIncomePerS.metals ?? 0) + (prod.familyIncomePerS.minerals ?? 0) + (prod.familyIncomePerS.bio ?? 0);
  else income = activeExtractors * 1.0;

  let spend = 0;
  if (typeof overrides?.resourceSpendPerS === 'number') spend = overrides.resourceSpendPerS;
  else if (overrides?.resourceSpendPerS) for (const v of Object.values(overrides.resourceSpendPerS)) spend += v ?? 0;
  else if (typeof colony?.spendPerS === 'number') spend = colony.spendPerS;

  const netResourcePerS = income - spend;
  const minResourceRatio = Math.min(stock['metals.t1'] / Math.max(1, capFor('metals.t1')), stock['minerals.t1'] / Math.max(1, capFor('minerals.t1')));

  let score: number;
  if (extractorCount === 0) score = clampBp(5500 + Math.round(Math.max(0, 1 - minResourceRatio) * 400));
  else if (netResourcePerS < 0) score = clampBp(6000 + Math.min(2500, Math.round(Math.abs(netResourcePerS) * 500)));
  else if (minResourceRatio < 0.4) score = clampBp(5500 + Math.round(((0.4 - minResourceRatio) / 0.4) * 3000));
  else if (income <= 0) score = 5500;
  else score = clampBp(Math.max(0, Math.round((1 - minResourceRatio) * 2500)));
  return { score, extractorCount, minResourceRatio, netResourcePerS };
}

function findColonyAnchors(state: PlanetState, colonyIndex: number): Array<{ q: number; r: number }> {
  const cols = state.entities.cols;
  const anchors: Array<{ q: number; r: number }> = [];
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] === colonyIndex && cols.hp[row] > 0) anchors.push({ q: cols.q[row], r: cols.r[row] });
  }
  if (anchors.length === 0) anchors.push({ q: 0, r: 0 });
  return anchors;
}

export function scoreDefenseNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; hostilesWithin15: number; underAttack: boolean } {
  const colony = state.colonies[colonyIndex];
  const anchors = findColonyAnchors(state, colonyIndex);
  const cols = state.entities.cols;
  let hostiles = 0, closestDist = 999;

  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] === colonyIndex || cols.state[row] === ENTITY_STATE.inert) continue;
    if (cols.kind[row] === ENTITY_KIND.devProbe || cols.kind[row] === ENTITY_KIND.pod) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    let minDist = 999;
    for (const a of anchors) {
      const dq = cols.q[row] - a.q, dr = cols.r[row] - a.r;
      const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      if (d < minDist) minDist = d;
    }
    if (minDist <= 15) {
      hostiles++;
      if (minDist < closestDist) closestDist = minDist;
    }
  }

  const hostilesWithin15 = overrides?.hostilesWithin15 ?? hostiles;
  const recentDamage = overrides?.recentDamage ?? (typeof colony?.recentDamage === 'number' ? colony.recentDamage : 0);
  const underAttack = overrides?.underAttack ?? (Boolean(colony?.underAttack) || recentDamage > 0);

  let score = 0;
  if (hostilesWithin15 > 0 || underAttack) {
    const proxBonus = closestDist <= 15 ? Math.round(((15 - closestDist) / 15) * 1000) : 500;
    const countBonus = Math.min(1000, Math.max(0, hostilesWithin15 - 1) * 300 + (underAttack ? 500 : 0));
    score = clampBp(8000 + proxBonus + countBonus);
  }
  return { score, hostilesWithin15, underAttack };
}

export function scoreExpandNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; freeBuildableOwnedTiles: number; unclaimedDepositsWithin20: number; ownedDepositsAllOccupied: boolean } {
  const occupied = occupiedGroundTiles(state, overrides?.data);
  const hubAnchor = findColonyAnchors(state, colonyIndex)[0]!;
  const hx = hexIndex(state.grid.radius);
  const layers = state.grid.layers;
  const ownerLayer = layers.owner as Int8Array, terrainLayer = layers.terrain as Uint8Array;
  const prepLayer = layers.prep as Uint8Array, depositLayer = layers.deposit as Uint8Array;

  let ownedTiles = 0, freeBuildable = 0, ownedDeposits = 0, freeOwnedDeposits = 0, unclaimedNear = 0;
  for (let i = 0; i < state.grid.count; i++) {
    const own = ownerLayer[i], dep = depositLayer[i], isOcc = occupied.has(i);
    if (own === colonyIndex) {
      ownedTiles++;
      if (dep !== DEPOSIT.none) {
        ownedDeposits++;
        if (!isOcc) freeOwnedDeposits++;
      } else if (!isOcc && terrainLayer[i] === TERRAIN.flat && prepLayer[i] !== PREP.ridge && prepLayer[i] !== PREP.moat) {
        freeBuildable++;
      }
    } else if (own === -1 && dep !== DEPOSIT.none && hexDistance(hubAnchor.q, hubAnchor.r, hx.q[i]!, hx.r[i]!) <= 20) {
      unclaimedNear++;
    }
  }

  const freeBuildableOwnedTiles = overrides?.freeBuildableOwnedTiles ?? freeBuildable;
  const unclaimedDepositsWithin20 = overrides?.unclaimedDepositsWithin20 ?? unclaimedNear;
  const ownedDepositsAllOccupied = overrides?.ownedDepositsAllOccupied ?? (ownedDeposits === 0 || freeOwnedDeposits === 0);
  const hasTerritory = ownedTiles > 0 || overrides?.freeBuildableOwnedTiles !== undefined || overrides?.unclaimedDepositsWithin20 !== undefined;

  let score = 0;
  if (hasTerritory && freeBuildableOwnedTiles < 30) {
    score = Math.max(score, clampBp(5000 + Math.round(((30 - Math.max(0, freeBuildableOwnedTiles)) / 30) * 3500)));
  }
  if (hasTerritory && unclaimedDepositsWithin20 > 0 && ownedDepositsAllOccupied) {
    score = Math.max(score, clampBp(5000 + Math.min(3500, unclaimedDepositsWithin20 * 700)));
  }
  if (hasTerritory && score === 0 && freeBuildableOwnedTiles < 90) {
    score = clampBp(Math.round(((90 - freeBuildableOwnedTiles) / 60) * 2500));
  }
  return { score, freeBuildableOwnedTiles, unclaimedDepositsWithin20, ownedDepositsAllOccupied };
}

export function scoreRepairNeed(
  state: PlanetState,
  colonyIndex: number,
  overrides?: NeedsEvalInput,
): { score: number; damagedEntityCount: number; severedEntityCount: number; minHpRatio: number } {
  const cols = state.entities.cols;
  const altMaxHp = (cols as Record<string, ArrayLike<number> | undefined>).maxHp;
  let damaged = 0, severed = 0, minRatio = 1;

  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    const hp = Number(cols.hp[row] ?? 0);
    if (hp <= 0) continue;
    const maxHp = Number(cols.hpMax[row] || altMaxHp?.[row] || 0);
    if (maxHp > 0 && hp < maxHp) {
      damaged++;
      if (hp / maxHp < minRatio) minRatio = hp / maxHp;
    }
    if (cols.state[row] === ENTITY_STATE.offlineUnpowered) severed++;
  }

  const damagedEntityCount = overrides?.damagedEntities ?? damaged;
  const severedEntityCount = overrides?.severedEntities ?? severed;
  const minHpRatio = overrides?.minHpRatio ?? (damagedEntityCount > 0 && damaged === 0 ? 0.5 : minRatio);

  let score = 0;
  if (damagedEntityCount > 0 || severedEntityCount > 0) {
    const missingRatio = Math.max(0, Math.min(1, 1 - minHpRatio));
    const countBonus = Math.min(500, Math.max(0, damagedEntityCount + severedEntityCount - 1) * 150);
    score = clampBp(8000 + Math.round(missingRatio * 1500) + countBonus);
  }
  return { score, damagedEntityCount, severedEntityCount, minHpRatio };
}

/** Evaluates all 7 canonical colony needs in basis points (`0..10000` integer bp, `SIM-R-02`). */
export function evaluateColonyNeeds(
  state: PlanetState,
  colonyIndex = 0,
  overrides?: NeedsEvalInput,
): ColonyNeedsScore {
  const energyRes = scoreEnergyNeed(state, colonyIndex, overrides);
  const storageRes = scoreStorageNeed(state, colonyIndex, overrides);
  const supplyRes = scoreSupplyNeed(state, colonyIndex, overrides);
  const extractionRes = scoreExtractionNeed(state, colonyIndex, overrides);
  const defenseRes = scoreDefenseNeed(state, colonyIndex, overrides);
  const expandRes = scoreExpandNeed(state, colonyIndex, overrides);
  const repairRes = scoreRepairNeed(state, colonyIndex, overrides);

  const scores: Record<NeedKey, number> = {
    energy: energyRes.score,
    storage: storageRes.score,
    supply: supplyRes.score,
    extraction: extractionRes.score,
    defense: defenseRes.score,
    expand: expandRes.score,
    repair: repairRes.score,
  };

  let topNeed: NeedKey = 'energy';
  let topScore = -1;
  for (const key of NEED_KEYS) {
    if (scores[key] > topScore) {
      topScore = scores[key];
      topNeed = key;
    }
  }

  return {
    colonyIndex,
    ...scores,
    scores,
    topNeed,
    topScore,
    detail: {
      netPowerPerS: energyRes.netPowerPerS,
      nightNetPerS: energyRes.nightNetPerS,
      brownout: energyRes.brownout,
      deficitTicks: energyRes.deficitTicks,
      maxStorageRatio: storageRes.maxStorageRatio,
      supplyRatio: supplyRes.supplyRatio,
      supplyUsed: supplyRes.supplyUsed,
      supplyCap: supplyRes.supplyCap,
      producerIdle: supplyRes.producerIdle,
      extractorCount: extractionRes.extractorCount,
      minResourceRatio: extractionRes.minResourceRatio,
      netResourcePerS: extractionRes.netResourcePerS,
      hostilesWithin15: defenseRes.hostilesWithin15,
      underAttack: defenseRes.underAttack,
      freeBuildableOwnedTiles: expandRes.freeBuildableOwnedTiles,
      unclaimedDepositsWithin20: expandRes.unclaimedDepositsWithin20,
      ownedDepositsAllOccupied: expandRes.ownedDepositsAllOccupied,
      damagedEntityCount: repairRes.damagedEntityCount,
      severedEntityCount: repairRes.severedEntityCount,
      minHpRatio: repairRes.minHpRatio,
    },
  };
}
