import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';

export const FAUNA_HIVES_BLOB = 'faunaHives';
export const FAUNA_MODE_BLOB = 'faunaMode';
export const FAUNA_AGGRESSION_BLOB = 'faunaAggression';
export const WORLDGEN_HIVE_SITES_BLOB = 'worldgenHiveSites';

export type FaunaSpeciesId = 'blackAnt' | 'blueBeetle' | 'greenSpitter';
export type FaunaBehaviorMode = 'passive' | 'aggressive';

export const SPECIES_ORDER: readonly FaunaSpeciesId[] = ['blackAnt', 'blueBeetle', 'greenSpitter'];

export const SPECIES_TO_BUG_KIND: Readonly<Record<FaunaSpeciesId, number>> = {
  blackAnt: ENTITY_KIND.blackAnt,
  blueBeetle: ENTITY_KIND.blueBeetle,
  greenSpitter: ENTITY_KIND.greenSpitter,
};

export const SPECIES_TO_HIVE_KIND: Readonly<Record<FaunaSpeciesId, number>> = {
  blackAnt: ENTITY_KIND.hiveBlackAnt,
  blueBeetle: ENTITY_KIND.hiveBlueBeetle,
  greenSpitter: ENTITY_KIND.hiveGreenSpitter,
};

export const SPECIES_TO_HIVE_ROW_ID: Readonly<Record<FaunaSpeciesId, string>> = {
  blackAnt: 'hiveBlackAnt',
  blueBeetle: 'hiveBlueBeetle',
  greenSpitter: 'hiveGreenSpitter',
};

export interface WorldgenHiveSite {
  siteIndex: number;
  species: FaunaSpeciesId;
  q: number;
  r: number;
  entranceQ: number;
  entranceR: number;
}

export interface WorldgenHiveSitesBlob {
  sites: WorldgenHiveSite[];
}

export interface HiveAggressionRecord {
  colonyIndex: number;
  triggeredAtTick: number;
  wavesSent: number;
  maxWaves: number;
  lastWaveTick: number;
  activeCohortId: string | null;
}

export interface FaunaCohortRecord {
  cohortId: string;
  hiveId: number;
  species: FaunaSpeciesId;
  colonyIndex: number;
  memberIds: number[];
  dispatchedAtTick: number;
  targetEntityId: number | null;
  timeoutTicks: number;
}

export interface PendingFaunaEvent {
  kind: 'raidStarted' | 'raidRepelled';
  colonyIndex: number;
  data: Record<string, unknown>;
}

export interface HiveRecord {
  hiveId: number;
  species: FaunaSpeciesId;
  q: number;
  r: number;
  entranceQ: number;
  entranceR: number;
  hp: number;
  hpMax: number;
  destroyed: boolean;
  popCap: number;
  replenishTicks: number;
  lastReplenishTick: number;
  patrolRadius: number;
  residentIds: number[];
  decisionIndex: number;
  mode: FaunaBehaviorMode;
  aggressionByColony: Record<number, HiveAggressionRecord>;
  aggressiveColonies: number[];
  lastWaveTickByColony?: Record<number, number>;
}

export interface ResidentBugRecord {
  entityId: number;
  species: FaunaSpeciesId;
  homeHiveId: number;
  mode: FaunaBehaviorMode;
  targetColony: number | null;
  aggressiveColonies: number[];
  cohortId: string | null;
  lastWanderTick: number;
  lastAttackTick: number;
  spawnedTick: number;
}

export interface FaunaAggressionEntry {
  mode: FaunaBehaviorMode;
  aggressiveColonies: number[];
  aggressionByColony?: Record<number, HiveAggressionRecord>;
  targetColony?: number | null;
  hiveId?: number;
}

export interface FaunaHivesBlob {
  initialized: boolean;
  hivesById: Record<number, HiveRecord>;
  bugsById: Record<number, ResidentBugRecord>;
  hives: Record<number, HiveRecord>;
  byEntityId: Record<number, HiveRecord | ResidentBugRecord>;
  residentHiveByEntityId: Record<number, number>;
  lastSeenHpByEntityId: Record<number, number>;
  cohortsById: Record<string, FaunaCohortRecord>;
  nextCohortSeq: number;
  lastScheduledRollTickByColony: Record<number, number>;
  scheduledRollIndexByColony: Record<number, number>;
  pendingEvents: PendingFaunaEvent[];
}

export interface ResolvedSpeciesConfig {
  species: FaunaSpeciesId;
  bugKind: number;
  hiveKind: number;
  hp: number;
  hiveHp: number;
  speedPerTick: number;
  radius: number;
  viewRadius: number;
  weaponId: string;
  attackKind: 'melee' | 'rangedAcid';
  damage: number;
  attackIntervalTicks: number;
  dps: number;
  range: number;
  projSpeed: number;
  popCap: number;
  initialResidents: number;
  replenishTicks: number;
  patrolRadius: number;
  threatCost: number;
}

const DEFAULT_SPECIES_CONFIG: Readonly<Record<FaunaSpeciesId, ResolvedSpeciesConfig>> = {
  blackAnt: {
    species: 'blackAnt',
    bugKind: ENTITY_KIND.blackAnt,
    hiveKind: ENTITY_KIND.hiveBlackAnt,
    hp: 120,
    hiveHp: 1500,
    speedPerTick: Math.fround(0.4),
    radius: 0.3,
    viewRadius: 6,
    weaponId: 'antBite',
    attackKind: 'melee',
    damage: 8,
    attackIntervalTicks: 5,
    dps: 8,
    range: 1,
    projSpeed: 0,
    popCap: 12,
    initialResidents: 4,
    replenishTicks: 60 * TICKS_PER_SECOND,
    patrolRadius: 5,
    threatCost: 1,
  },
  blueBeetle: {
    species: 'blueBeetle',
    bugKind: ENTITY_KIND.blueBeetle,
    hiveKind: ENTITY_KIND.hiveBlueBeetle,
    hp: 900,
    hiveHp: 1500,
    speedPerTick: Math.fround(0.16),
    radius: 0.8,
    viewRadius: 6,
    weaponId: 'beetleBite',
    attackKind: 'melee',
    damage: 24,
    attackIntervalTicks: 10,
    dps: 12,
    range: 1,
    projSpeed: 0,
    popCap: 3,
    initialResidents: 2,
    replenishTicks: 180 * TICKS_PER_SECOND,
    patrolRadius: 4,
    threatCost: 4,
  },
  greenSpitter: {
    species: 'greenSpitter',
    bugKind: ENTITY_KIND.greenSpitter,
    hiveKind: ENTITY_KIND.hiveGreenSpitter,
    hp: 180,
    hiveHp: 1500,
    speedPerTick: Math.fround(0.28),
    radius: 0.4,
    viewRadius: 7,
    weaponId: 'spitterAcid',
    attackKind: 'rangedAcid',
    damage: 12,
    attackIntervalTicks: 10,
    dps: 6,
    range: 5,
    projSpeed: 4,
    popCap: 6,
    initialResidents: 3,
    replenishTicks: 120 * TICKS_PER_SECOND,
    patrolRadius: 5,
    threatCost: 2,
  },
};

const W07_FLAGS = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
let cachedW07Data: CompiledDataLike | null = null;

export function defaultFaunaData(): CompiledDataLike {
  if (!cachedW07Data) cachedW07Data = compileData(W07_FLAGS);
  return cachedW07Data;
}

export function speciesOfEntityKind(kind: number): FaunaSpeciesId | null {
  if (kind === ENTITY_KIND.blackAnt || kind === ENTITY_KIND.hiveBlackAnt) return 'blackAnt';
  if (kind === ENTITY_KIND.blueBeetle || kind === ENTITY_KIND.hiveBlueBeetle) return 'blueBeetle';
  if (kind === ENTITY_KIND.greenSpitter || kind === ENTITY_KIND.hiveGreenSpitter) return 'greenSpitter';
  return null;
}

export function resolveSpeciesConfig(
  species: FaunaSpeciesId,
  data?: CompiledDataLike,
): ResolvedSpeciesConfig {
  const base = DEFAULT_SPECIES_CONFIG[species];
  const tbl = data?.tables?.fauna as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  const bugRow = tbl?.[species];
  const hiveRow = tbl?.[SPECIES_TO_HIVE_ROW_ID[species]];
  if (!bugRow && !hiveRow) return base;

  const rawSpeed = Number(bugRow?.speed ?? base.speedPerTick);
  const speedPerTick = Math.fround(rawSpeed);
  const attackIntervalS = Number(bugRow?.attackIntervalS ?? base.attackIntervalTicks / TICKS_PER_SECOND);
  const replenishS = Number(
    hiveRow?.replenishS ?? bugRow?.replenishS ?? base.replenishTicks / TICKS_PER_SECOND,
  );
  const popCap = Number(hiveRow?.popCap ?? bugRow?.hivePopCap ?? base.popCap);
  const initialResidents = Number(
    hiveRow?.initialResidents ?? bugRow?.initialResidents ?? base.initialResidents,
  );
  const patrolRadius = Number(hiveRow?.patrolRadius ?? bugRow?.patrolRadius ?? base.patrolRadius);

  return {
    ...base,
    hp: Number(bugRow?.hp ?? base.hp),
    hiveHp: Number(hiveRow?.hp ?? base.hiveHp),
    speedPerTick,
    radius: Number(bugRow?.radius ?? base.radius),
    viewRadius: Number(bugRow?.viewRadius ?? base.viewRadius),
    weaponId: typeof bugRow?.weaponId === 'string' ? bugRow.weaponId : base.weaponId,
    attackKind: bugRow?.attackKind === 'rangedAcid' ? 'rangedAcid' : base.attackKind,
    damage: Number(bugRow?.damage ?? base.damage),
    attackIntervalTicks: Math.max(1, Math.round(attackIntervalS * TICKS_PER_SECOND)),
    dps: Number(bugRow?.dps ?? base.dps),
    range: Number(bugRow?.range ?? base.range),
    projSpeed: Number(bugRow?.projSpeed ?? base.projSpeed),
    popCap: Math.max(1, Math.round(popCap)),
    initialResidents: Math.max(0, Math.round(initialResidents)),
    replenishTicks: Math.max(1, Math.round(replenishS * TICKS_PER_SECOND)),
    patrolRadius: Math.max(1, Math.round(patrolRadius)),
    threatCost: Number(hiveRow?.threatCost ?? bugRow?.threatCost ?? base.threatCost),
  };
}
