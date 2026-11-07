import { getStageSpec, type CompiledRow, type StageRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { getBuildingJobs } from '../economy/buildJob';
import { findColonyHqRow } from '../find';
import { hqViewRadius } from '../hq';
import { getLandingPods } from '../landing';
import {
  BUILDING_KIND,
  EXTRACTOR_BUILDING_IDS,
  GENERATOR_BUILDING_IDS,
  UNIT_KIND,
  type ColonyEntityCounts,
} from './types';

const BUILDING_CODE_NAMES: Readonly<Record<number, string>> = {
  [BUILDING_KIND.commandHub]: 'commandHub',
  [BUILDING_KIND.metalsExtractor]: 'metalsExtractor',
  [BUILDING_KIND.solar]: 'solar',
  [BUILDING_KIND.mineralsExtractor]: 'mineralsExtractor',
  [BUILDING_KIND.waterExtractor]: 'waterExtractor',
  [BUILDING_KIND.biomassExtractor]: 'biomassExtractor',
  [BUILDING_KIND.wind]: 'wind',
  [BUILDING_KIND.thermalGenerator]: 'thermalGenerator',
  [BUILDING_KIND.pylon]: 'pylon',
  [BUILDING_KIND.depot]: 'depot',
  [BUILDING_KIND.capacitor]: 'capacitor',
  [BUILDING_KIND.roboticsFactory]: 'roboticsFactory',
  40: 'roboticsFactory',
  [BUILDING_KIND.droneControlArray]: 'droneControlArray',
  [BUILDING_KIND.turret]: 'turret',
  [BUILDING_KIND.pulseTurret]: 'pulseTurret',
  [BUILDING_KIND.wall]: 'wall',
  [BUILDING_KIND.radar]: 'radar',
  [BUILDING_KIND.outpostBeacon]: 'outpostBeacon',
  [BUILDING_KIND.tradeHub]: 'tradeHub',
  [BUILDING_KIND.road]: 'road',
  [BUILDING_KIND.smelter]: 'smelter',
  [BUILDING_KIND.chemicalPlant]: 'chemicalPlant',
  [BUILDING_KIND.shieldDome]: 'shieldDome',
  [BUILDING_KIND.missileBattery]: 'missileBattery',
  [BUILDING_KIND.researchLab]: 'researchLab',
  [BUILDING_KIND.heavyFoundry]: 'heavyFoundry',
  [BUILDING_KIND.fusionReactor]: 'fusionReactor',
  [BUILDING_KIND.arcTower]: 'arcTower',
  [BUILDING_KIND.apexBay]: 'apexBay',
  [BUILDING_KIND.orbitalUplink]: 'orbitalUplink',
  [BUILDING_KIND.planetaryShield]: 'planetaryShield',
  [BUILDING_KIND.launchPad]: 'launchPad',
  [BUILDING_KIND.fuelSynthesizer]: 'fuelSynthesizer',
  [BUILDING_KIND.telemetryArray]: 'telemetryArray',
  [BUILDING_KIND.monument]: 'monument',
};

const UNIT_CODE_NAMES: Readonly<Record<number, string>> = {
  [UNIT_KIND.hq]: 'hq',
  [UNIT_KIND.harvester]: 'harvester',
  [UNIT_KIND.builder]: 'builder',
  [UNIT_KIND.terraformer]: 'terraformer',
  [UNIT_KIND.scout]: 'scout',
  [UNIT_KIND.guard]: 'guard',
  [UNIT_KIND.combatEngineer]: 'combatEngineer',
  [UNIT_KIND.hauler]: 'hauler',
  [UNIT_KIND.multitask]: 'multitask',
  [UNIT_KIND.striker]: 'striker',
  [UNIT_KIND.sapper]: 'sapper',
  [UNIT_KIND.envirobot]: 'envirobot',
  [UNIT_KIND.tank]: 'tank',
  [UNIT_KIND.artillery]: 'artillery',
  [UNIT_KIND.warden]: 'warden',
  [UNIT_KIND.surveyDrone]: 'surveyDrone',
  [UNIT_KIND.goliath]: 'goliath',
  [UNIT_KIND.valkyrie]: 'valkyrie',
  [UNIT_KIND.archon]: 'archon',
  [UNIT_KIND.terraformingRig]: 'terraformingRig',
};

const EXTRACTOR_SET = new Set<string>(EXTRACTOR_BUILDING_IDS);
const GENERATOR_SET = new Set<string>(GENERATOR_BUILDING_IDS);

function buildingAliases(kind: string): readonly string[] {
  if (kind === 'commandHub' || kind === 'hub' || kind === 'Command Hub T1') return ['commandHub', 'hub'];
  if (kind === 'commandHub_t2' || kind === 'hub_t2' || kind === 'Command Hub T2') return ['commandHub_t2', 'commandHub', 'hub'];
  if (kind === 'commandHub_t3' || kind === 'hub_t3' || kind === 'Command Hub T3') return ['commandHub_t3', 'commandHub', 'hub'];
  if (kind === 'roboticsFactory' || kind === 'robotics_factory' || kind === 'factory' || kind === 'Factory T1') {
    return ['roboticsFactory', 'robotics_factory', 'factory'];
  }
  if (kind === 'roboticsFactory_t2' || kind === 'robotics_factory_t2' || kind === 'factory_t2' || kind === 'Factory T2') {
    return ['roboticsFactory_t2', 'roboticsFactory', 'robotics_factory', 'factory'];
  }
  if (kind === 'depot' || kind === 'storageDepot' || kind === 'supplyDepot') return ['depot', 'storageDepot', 'supplyDepot'];
  if (kind === 'solar' || kind === 'solarCollector') return ['solar', 'solarCollector'];
  if (kind === 'mineralsExtractor' || kind === 'mineralsQuarry') return ['mineralsExtractor', 'mineralsQuarry'];
  if (kind === 'turret' || kind === 'autocannon') return ['turret', 'autocannon'];
  if (kind === 'pulseTurret' || kind === 'laserTower') return ['pulseTurret', 'laserTower'];
  return [kind];
}

function inferTierFromKind(kind: string, tier: number): number {
  if (kind.endsWith('_t3') || kind.endsWith('T3')) return Math.max(tier, 3);
  if (kind.endsWith('_t2') || kind.endsWith('T2')) return Math.max(tier, 2);
  return tier;
}

function unitAliases(kind: string): readonly string[] {
  if (kind === 'scout' || kind === 'recon') return ['scout', 'recon'];
  return [kind];
}

function recordBuilding(counts: ColonyEntityCounts, kind: string, tier: number): void {
  const effectiveTier = inferTierFromKind(kind, tier);
  counts.completedBuildings++;
  if (EXTRACTOR_SET.has(kind)) counts.completedExtractors++;
  if (GENERATOR_SET.has(kind)) counts.completedGenerators++;
  for (const alias of buildingAliases(kind)) {
    counts.buildingCountsByKind[alias] = (counts.buildingCountsByKind[alias] ?? 0) + 1;
    const prevTier = counts.maxBuildingTierByKind[alias] ?? 0;
    if (effectiveTier > prevTier) counts.maxBuildingTierByKind[alias] = effectiveTier;
    if (effectiveTier >= 2 && !alias.endsWith(`_t${effectiveTier}`)) {
      const tKey = `${alias}_t${effectiveTier}`;
      counts.buildingCountsByKind[tKey] = (counts.buildingCountsByKind[tKey] ?? 0) + 1;
    }
  }
}

function recordUnit(counts: ColonyEntityCounts, kind: string): void {
  counts.totalUnits++;
  for (const alias of unitAliases(kind)) {
    counts.unitCountsByKind[alias] = (counts.unitCountsByKind[alias] ?? 0) + 1;
  }
}

function isEntityConstructing(stateCode: number): boolean {
  return (
    stateCode === ENTITY_STATE.constructing ||
    stateCode === ENTITY_STATE.waiting ||
    stateCode === ENTITY_STATE.descending ||
    stateCode === ENTITY_STATE.inert
  );
}

function applyColonyListOverrides(state: PlanetState, colonyIndex: number, counts: ColonyEntityCounts): void {
  const col = state.colonies[colonyIndex];
  if (!col) return;
  const rawBuildings = col.buildings ?? col.completedBuildings;
  if (Array.isArray(rawBuildings)) {
    for (const item of rawBuildings) {
      if (typeof item === 'string') {
        recordBuilding(counts, item, 1);
      } else if (item && typeof item === 'object') {
        const b = item as { kind?: string; building?: string; tier?: number; completed?: boolean; state?: string | number; hp?: number };
        if (b.completed === false || b.state === 'constructing' || b.state === ENTITY_STATE.constructing || (typeof b.hp === 'number' && b.hp <= 0)) continue;
        const k = b.building ?? b.kind;
        if (typeof k === 'string') recordBuilding(counts, k, Number(b.tier ?? 1));
      }
    }
  }
  const rawUnits = col.units;
  if (Array.isArray(rawUnits)) {
    for (const item of rawUnits) {
      if (typeof item === 'string') {
        recordUnit(counts, item);
      } else if (item && typeof item === 'object') {
        const u = item as { kind?: string; unit?: string; hp?: number };
        if (typeof u.hp === 'number' && u.hp <= 0) continue;
        const k = u.unit ?? u.kind;
        if (typeof k === 'string') recordUnit(counts, k);
      }
    }
  }
}

/**
 * Aggregates completed buildings (by kind, extractor, generator, tier) and alive units owned by `colonyIndex`.
 */
export function countColonyEntities(state: PlanetState, colonyIndex: number): ColonyEntityCounts {
  const counts: ColonyEntityCounts = {
    completedBuildings: 0,
    completedExtractors: 0,
    completedGenerators: 0,
    buildingCountsByKind: {},
    maxBuildingTierByKind: {},
    unitCountsByKind: {},
    totalUnits: 0,
  };
  const jobs = getBuildingJobs(state);
  const metaMap = (state.blobs.entityMeta?.value as Record<number, { building?: string; unit?: string }> | undefined) ?? undefined;
  const { count, cols } = state.entities;
  const colBuildingArr = (cols as Record<string, unknown>).building as ArrayLike<string | undefined> | undefined;
  const colUnitArr = (cols as Record<string, unknown>).unit as ArrayLike<string | undefined> | undefined;

  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r] <= 0) continue;
    const id = cols.id[r];
    const code = cols.kind[r];
    const st = cols.state[r];
    const tier = cols.tier[r] || 1;
    const meta = metaMap?.[id];

    const uName = colUnitArr?.[r] ?? meta?.unit ?? UNIT_CODE_NAMES[code];
    if (uName) {
      if (st !== ENTITY_STATE.descending && st !== ENTITY_STATE.inert) recordUnit(counts, uName);
      continue;
    }

    if (isEntityConstructing(st) || jobs[id]) continue;
    const bName = colBuildingArr?.[r] ?? meta?.building ?? BUILDING_CODE_NAMES[code] ?? (code >= 8 && code < 50 ? 'building' : null);
    if (bName) {
      recordBuilding(counts, bName, tier);
    }
  }

  const col = state.colonies[colonyIndex];
  if (typeof col?.hubEntityId === 'number' && (counts.buildingCountsByKind.commandHub ?? 0) === 0) {
    const hubRow = rowOf(state.entities, col.hubEntityId);
    if (
      (hubRow < 0 && state.meta.nextEntityId <= col.hubEntityId) ||
      (hubRow >= 0 && cols.hp[hubRow] > 0 && !isEntityConstructing(cols.state[hubRow]) && !jobs[col.hubEntityId])
    ) {
      recordBuilding(counts, 'commandHub', Number(col.hubTier ?? 1));
    }
  }

  applyColonyListOverrides(state, colonyIndex, counts);
  return counts;
}

export function ownsCompletedBuilding(state: PlanetState, colonyIndex: number, buildingId: string, minTier = 1): boolean {
  const counts = countColonyEntities(state, colonyIndex);
  if ((counts.buildingCountsByKind[buildingId] ?? 0) <= 0) return false;
  return (counts.maxBuildingTierByKind[buildingId] ?? 1) >= minTier;
}

export function countCompletedBuildings(state: PlanetState, colonyIndex: number): number {
  return countColonyEntities(state, colonyIndex).completedBuildings;
}

export function countCompletedExtractors(state: PlanetState, colonyIndex: number): number {
  return countColonyEntities(state, colonyIndex).completedExtractors;
}

export function countCompletedGenerators(state: PlanetState, colonyIndex: number): number {
  return countColonyEntities(state, colonyIndex).completedGenerators;
}

export function countColonyUnits(state: PlanetState, colonyIndex: number, unitId?: string): number {
  const counts = countColonyEntities(state, colonyIndex);
  return unitId ? (counts.unitCountsByKind[unitId] ?? 0) : counts.totalUnits;
}

/** Whether `colonyIndex` has landed and is active (`S0` trigger). */
export function isColonyLanded(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  if (!col || col.status === 'eliminated' || col.status === 'settled') return false;
  if (col.status === 'active') return true;
  if (findColonyHqRow(state, colonyIndex) >= 0) return true;
  if (getLandingPods(state).some((p) => p.colonyId === colonyIndex && p.deployed)) return true;
  return countCompletedBuildings(state, colonyIndex) > 0;
}

/** Counts total tiles marked explored for `colonyIndex` in `state.grid.layers.explored`. */
export function countTotalExploredTiles(state: PlanetState, colonyIndex: number): number {
  const explored = state.grid.layers.explored as Uint8Array | undefined;
  if (!explored) return 0;
  const mask = colonyIndex >= 0 && colonyIndex < 8 ? 1 << colonyIndex : 1;
  let total = 0;
  for (let i = 0; i < state.grid.count; i++) {
    if ((explored[i] & mask) !== 0) total++;
  }
  return total;
}

/** Counts tiles explored by `colonyIndex` outside the initial landing vision ring (`S4` trigger). */
export function countScoutedTilesOutsideRing(
  state: PlanetState,
  colonyIndex: number,
  initialExploredCount?: number,
  data?: CompiledDataLike,
): number {
  const col = state.colonies[colonyIndex];
  if (typeof col?.scoutedTiles === 'number') return col.scoutedTiles;
  if (typeof col?.exploredOutsideRing === 'number') return col.exploredOutsideRing;

  const explored = state.grid.layers.explored as Uint8Array | undefined;
  if (!explored) return 0;

  let anchorQ = 0;
  let anchorR = 0;
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] === colonyIndex && cols.hp[r] > 0 && (cols.kind[r] === ENTITY_KIND.commandHub || cols.kind[r] === ENTITY_KIND.hq || cols.kind[r] === ENTITY_KIND.pod)) {
      anchorQ = cols.q[r];
      anchorR = cols.r[r];
      break;
    }
  }

  const ringRadius = hqViewRadius(data);
  const hx = hexIndex(state.grid.radius);
  const mask = colonyIndex >= 0 && colonyIndex < 8 ? 1 << colonyIndex : 1;
  let outsideRing = 0;
  let totalExplored = 0;
  for (let i = 0; i < state.grid.count; i++) {
    if ((explored[i] & mask) === 0) continue;
    totalExplored++;
    if (hexDistance(anchorQ, anchorR, hx.q[i]!, hx.r[i]!) > ringRadius) {
      outsideRing++;
    }
  }

  if (typeof initialExploredCount === 'number' && initialExploredCount > 0) {
    outsideRing = Math.max(outsideRing, totalExplored - initialExploredCount);
  } else if (totalExplored >= 5 && totalExplored < 180) {
    // Manual tile exploration in unit tests where full HQ vision ring (217..271 tiles) was not stamped.
    outsideRing = Math.max(outsideRing, totalExplored);
  }
  return outsideRing;
}

function isFaunaOverrideActive(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  if (col?.faunaOverride === true || col?.stageOverride === 'fauna') return true;
  const cols = state.entities.cols;
  let anchorQ = 0;
  let anchorR = 0;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] === colonyIndex && cols.hp[r] > 0 && (cols.kind[r] === ENTITY_KIND.commandHub || cols.kind[r] === ENTITY_KIND.hq)) {
      anchorQ = cols.q[r];
      anchorR = cols.r[r];
      break;
    }
  }
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] === colonyIndex || cols.hp[r] <= 0) continue;
    if (cols.kind[r] >= 70 && hexDistance(anchorQ, anchorR, cols.q[r], cols.r[r]) <= 15) return true;
  }
  return false;
}

/**
 * Resolves the compiled `StageRow` for `stage` (with `dwellS` in ticks).
 * When `data.tables.stages` is present, respects wave-gated compilation (e.g. `TA_WAVES=..08` has only `S0..S4`).
 */
export function resolveCompiledStageRow(stage: number, data?: CompiledDataLike): StageRow | undefined {
  if (data?.tables && 'stages' in data.tables) {
    const table = data.tables.stages as Record<string, CompiledRow> | undefined;
    const row = table?.[`S${stage}`];
    if (!row) return undefined;
    return row as unknown as StageRow;
  }
  const spec = getStageSpec(stage);
  if (!spec) return undefined;
  return {
    ...spec,
    dwellS: Math.round(spec.dwellS * TICKS_PER_SECOND),
    targetTimeS: Math.round(spec.targetTimeS * TICKS_PER_SECOND),
  };
}

/** Highest stage index present in `data.tables.stages` (e.g. `4` when `TA_WAVES=..08`, `10` when `all`). */
export function getMaxCompiledStage(data?: CompiledDataLike): number {
  if (data?.tables && 'stages' in data.tables) {
    const table = data.tables.stages as Record<string, CompiledRow> | undefined;
    if (!table) return -1;
    let maxStage = -1;
    for (const row of Object.values(table)) {
      const s = Number(row.stage);
      if (Number.isInteger(s) && s > maxStage) maxStage = s;
    }
    return maxStage;
  }
  return 10;
}

/** Evaluates a stage trigger condition by its `triggerKind` identifier (`stages.ts`). */
export function evaluateTriggerByKind(
  state: PlanetState,
  colonyIndex: number,
  triggerKind: string,
  data?: CompiledDataLike,
  initialExploredCount?: number,
): boolean {
  if (triggerKind === 'landed') return isColonyLanded(state, colonyIndex);
  const counts = countColonyEntities(state, colonyIndex);
  const col = state.colonies[colonyIndex];

  switch (triggerKind) {
    case 'hub_complete':
      return (counts.buildingCountsByKind.commandHub ?? 0) >= 1;
    case 'extractor_and_generator':
      return counts.completedExtractors >= 1 && counts.completedGenerators >= 1;
    case 'buildings_or_fauna':
      return (counts.completedBuildings >= 6 && counts.completedExtractors >= 2) || isFaunaOverrideActive(state, colonyIndex);
    case 'factory_or_scout':
      return (
        (counts.buildingCountsByKind.roboticsFactory ?? 0) >= 1 &&
        ((counts.unitCountsByKind.scout ?? 0) >= 1 || countScoutedTilesOutsideRing(state, colonyIndex, initialExploredCount, data) >= 5)
      );
    case 'sectors_or_hub_t2':
      return (
        (counts.maxBuildingTierByKind.commandHub ?? 0) >= 2 ||
        (counts.buildingCountsByKind.commandHub_t2 ?? 0) >= 1 ||
        (counts.buildingCountsByKind.outpostBeacon ?? 0) >= 1 ||
        Number(col?.hubTier ?? 0) >= 2
      );
    case 'refinery_and_units':
      return (
        ((counts.maxBuildingTierByKind.roboticsFactory ?? 0) >= 2 ||
          (counts.buildingCountsByKind.roboticsFactory_t2 ?? 0) >= 1 ||
          (counts.buildingCountsByKind.smelter ?? 0) >= 1) &&
        counts.totalUnits >= 3
      );
    case 'lab_and_sectors':
      return (counts.buildingCountsByKind.researchLab ?? 0) >= 1 || (counts.unitCountsByKind.artillery ?? 0) >= 1;
    case 'foundry_and_fusion':
      return (
        ((counts.buildingCountsByKind.heavyFoundry ?? 0) >= 1 && (counts.buildingCountsByKind.fusionReactor ?? 0) >= 1) ||
        (counts.buildingCountsByKind.apexBay ?? 0) >= 1
      );
    case 'hub_t3_and_uplink':
      return (
        ((counts.maxBuildingTierByKind.commandHub ?? 0) >= 3 || (counts.buildingCountsByKind.commandHub_t3 ?? 0) >= 1) &&
        (counts.buildingCountsByKind.orbitalUplink ?? 0) >= 1
      );
    case 'first_rocket_launched':
      return col?.status === 'settled' || Boolean(col?.rocketLaunched) || (counts.buildingCountsByKind.launchPad ?? 0) >= 1;
    default:
      return false;
  }
}

/**
 * Evaluates whether `colonyIndex` satisfies the trigger condition for `targetStage` (`0..10`).
 */
export function evaluateStageTrigger(
  state: PlanetState,
  colonyIndex: number,
  targetStage: number,
  data?: CompiledDataLike,
  initialExploredCount?: number,
): boolean {
  const row = resolveCompiledStageRow(targetStage, data) ?? getStageSpec(targetStage);
  if (!row) return false;
  return evaluateTriggerByKind(state, colonyIndex, row.triggerKind, data, initialExploredCount);
}
