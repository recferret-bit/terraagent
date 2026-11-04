import { rowOf } from '../../ecs/store';
import { setBlob, type PlanetState } from '../../kernel/state';
import {
  FAUNA_AGGRESSION_BLOB,
  FAUNA_HIVES_BLOB,
  FAUNA_MODE_BLOB,
  type FaunaAggressionEntry,
  type FaunaBehaviorMode,
  type FaunaCohortRecord,
  type FaunaHivesBlob,
  type HiveAggressionRecord,
  type HiveRecord,
  type PendingFaunaEvent,
  type ResidentBugRecord,
} from './types';

interface FaunaInternalTimingBlob {
  byEntityId: Record<number, FaunaAggressionEntry>;
  byHiveId: Record<number, FaunaAggressionEntry>;
  lastSeenHpByEntityId?: Record<number, number>;
  bugTimingById?: Record<number, { lastWanderTick: number; lastAttackTick: number }>;
  hiveReplenishById?: Record<number, number>;
  cohortsById?: Record<string, FaunaCohortRecord>;
  nextCohortSeq?: number;
  lastScheduledRollTickByColony?: Record<number, number>;
  scheduledRollIndexByColony?: Record<number, number>;
  pendingEvents?: PendingFaunaEvent[];
}

function cloneAggressionMap(
  src: Record<number, HiveAggressionRecord> | undefined,
): Record<number, HiveAggressionRecord> {
  if (!src) return {};
  const out: Record<number, HiveAggressionRecord> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!v) continue;
    out[Number(k)] = { ...v };
  }
  return out;
}

function cloneHiveRecord(hive: HiveRecord): HiveRecord {
  const aggressionByColony = cloneAggressionMap(hive.aggressionByColony);
  const aggressiveColonies = Object.keys(aggressionByColony)
    .map(Number)
    .sort((a, b) => a - b);
  return {
    ...hive,
    residentIds: [...hive.residentIds],
    aggressionByColony,
    aggressiveColonies,
    lastWaveTickByColony: hive.lastWaveTickByColony ? { ...hive.lastWaveTickByColony } : {},
    mode: aggressiveColonies.length > 0 ? 'aggressive' : hive.mode,
  };
}

function cloneBugRecord(bug: ResidentBugRecord): ResidentBugRecord {
  return {
    ...bug,
    aggressiveColonies: Array.isArray(bug.aggressiveColonies)
      ? [...bug.aggressiveColonies].sort((a, b) => a - b)
      : [],
  };
}

function cloneCohortsMap(
  src: Record<string, FaunaCohortRecord> | undefined,
): Record<string, FaunaCohortRecord> {
  if (!src) return {};
  const out: Record<string, FaunaCohortRecord> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!v) continue;
    out[k] = {
      ...v,
      memberIds: Array.isArray(v.memberIds) ? [...v.memberIds] : [],
    };
  }
  return out;
}

/**
 * Reads the current `FaunaHivesBlob` from `state.blobs.faunaHives`, returning a fresh mutable copy.
 */
export function getFaunaHivesState(state: PlanetState): FaunaHivesBlob {
  const raw = state.blobs[FAUNA_HIVES_BLOB]?.value as Partial<FaunaHivesBlob> | undefined;
  const aggro = state.blobs[FAUNA_AGGRESSION_BLOB]?.value as FaunaInternalTimingBlob | undefined;
  const hivesById: Record<number, HiveRecord> = {};
  const bugsById: Record<number, ResidentBugRecord> = {};
  const rawHives = raw?.hivesById ?? raw?.hives ?? {};
  for (const [k, h] of Object.entries(rawHives)) {
    if (!h) continue;
    const cloned = cloneHiveRecord(h);
    const repTick = aggro?.hiveReplenishById?.[cloned.hiveId];
    if (typeof repTick === 'number') cloned.lastReplenishTick = repTick;
    hivesById[Number(k)] = cloned;
  }
  const rawBugs = raw?.bugsById ?? {};
  for (const [k, b] of Object.entries(rawBugs)) {
    if (!b) continue;
    const cloned = cloneBugRecord(b);
    const timing = aggro?.bugTimingById?.[cloned.entityId];
    if (timing) {
      cloned.lastWanderTick = timing.lastWanderTick;
      cloned.lastAttackTick = timing.lastAttackTick;
    }
    bugsById[Number(k)] = cloned;
  }
  const lastSeenHpByEntityId: Record<number, number> = aggro?.lastSeenHpByEntityId
    ? { ...aggro.lastSeenHpByEntityId }
    : raw?.lastSeenHpByEntityId
      ? { ...raw.lastSeenHpByEntityId }
      : {};
  const cohortsById = cloneCohortsMap(aggro?.cohortsById ?? raw?.cohortsById);
  const nextCohortSeq =
    typeof aggro?.nextCohortSeq === 'number'
      ? aggro.nextCohortSeq
      : typeof raw?.nextCohortSeq === 'number'
        ? raw.nextCohortSeq
        : 1;
  const lastScheduledRollTickByColony: Record<number, number> = aggro?.lastScheduledRollTickByColony
    ? { ...aggro.lastScheduledRollTickByColony }
    : raw?.lastScheduledRollTickByColony
      ? { ...raw.lastScheduledRollTickByColony }
      : {};
  const scheduledRollIndexByColony: Record<number, number> = aggro?.scheduledRollIndexByColony
    ? { ...aggro.scheduledRollIndexByColony }
    : raw?.scheduledRollIndexByColony
      ? { ...raw.scheduledRollIndexByColony }
      : {};
  const srcEvents = aggro?.pendingEvents ?? raw?.pendingEvents;
  const pendingEvents: PendingFaunaEvent[] = Array.isArray(srcEvents)
    ? srcEvents.map((e) => ({ ...e, data: { ...e.data } }))
    : [];

  return buildSyncedFaunaState(
    Boolean(raw?.initialized),
    hivesById,
    bugsById,
    lastSeenHpByEntityId,
    cohortsById,
    nextCohortSeq,
    lastScheduledRollTickByColony,
    scheduledRollIndexByColony,
    pendingEvents,
  );
}

function buildSyncedFaunaState(
  initialized: boolean,
  hivesById: Record<number, HiveRecord>,
  bugsById: Record<number, ResidentBugRecord>,
  lastSeenHpByEntityId: Record<number, number>,
  cohortsById: Record<string, FaunaCohortRecord> = {},
  nextCohortSeq = 1,
  lastScheduledRollTickByColony: Record<number, number> = {},
  scheduledRollIndexByColony: Record<number, number> = {},
  pendingEvents: PendingFaunaEvent[] = [],
): FaunaHivesBlob {
  const hives: Record<number, HiveRecord> = {};
  const byEntityId: Record<number, HiveRecord | ResidentBugRecord> = {};
  const residentHiveByEntityId: Record<number, number> = {};

  for (const hive of Object.values(hivesById)) {
    hives[hive.hiveId] = hive;
    byEntityId[hive.hiveId] = hive;
  }
  for (const bug of Object.values(bugsById)) {
    byEntityId[bug.entityId] = bug;
    residentHiveByEntityId[bug.entityId] = bug.homeHiveId;
  }

  const out = {
    initialized,
    hivesById,
    bugsById,
  } as FaunaHivesBlob;
  Object.defineProperties(out, {
    hives: { value: hives, enumerable: false, writable: true, configurable: true },
    byEntityId: { value: byEntityId, enumerable: false, writable: true, configurable: true },
    residentHiveByEntityId: { value: residentHiveByEntityId, enumerable: false, writable: true, configurable: true },
    lastSeenHpByEntityId: { value: lastSeenHpByEntityId, enumerable: false, writable: true, configurable: true },
    cohortsById: { value: cohortsById, enumerable: false, writable: true, configurable: true },
    nextCohortSeq: { value: nextCohortSeq, enumerable: false, writable: true, configurable: true },
    lastScheduledRollTickByColony: { value: lastScheduledRollTickByColony, enumerable: false, writable: true, configurable: true },
    scheduledRollIndexByColony: { value: scheduledRollIndexByColony, enumerable: false, writable: true, configurable: true },
    pendingEvents: { value: pendingEvents, enumerable: false, writable: true, configurable: true },
  });
  return out;
}

function sameNumArr(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hasStructuralFaunaChange(prev: FaunaHivesBlob | undefined, next: FaunaHivesBlob): boolean {
  if (!prev) return true;
  if (prev.initialized !== next.initialized) return true;
  const pHives = Object.keys(prev.hivesById), nHives = Object.keys(next.hivesById);
  if (pHives.length !== nHives.length) return true;
  for (const k of nHives) {
    const ph = prev.hivesById[Number(k)], nh = next.hivesById[Number(k)]!;
    if (!ph || ph.destroyed !== nh.destroyed || ph.mode !== nh.mode || ph.decisionIndex !== nh.decisionIndex) return true;
    if (!sameNumArr(ph.aggressiveColonies, nh.aggressiveColonies)) return true;
  }
  for (const k of Object.keys(next.bugsById)) {
    const pb = prev.bugsById[Number(k)], nb = next.bugsById[Number(k)]!;
    if (!pb || pb.mode !== nb.mode || pb.cohortId !== nb.cohortId || pb.targetColony !== nb.targetColony) return true;
  }
  return false;
}

function hasModeMapChanged(
  prev: Record<number, FaunaBehaviorMode> | undefined,
  next: Record<number, FaunaBehaviorMode>,
): boolean {
  if (!prev) return true;
  const pKeys = Object.keys(prev), nKeys = Object.keys(next);
  if (pKeys.length !== nKeys.length) return true;
  for (const k of nKeys) if (prev[Number(k)] !== next[Number(k)]) return true;
  return false;
}

/**
 * Persists `fauna` into `state.blobs.faunaHives` and synchronizes `state.blobs.faunaMode` and
 * `state.blobs.faunaAggression` so `targeting.ts` (`W07-09`) sees colony-scoped hostility.
 */
export function saveFaunaHivesState(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  tick = state.meta.tick,
): void {
  const prevHivesBlob = state.blobs[FAUNA_HIVES_BLOB]?.value as FaunaHivesBlob | undefined;
  const synced = buildSyncedFaunaState(
    fauna.initialized,
    fauna.hivesById,
    fauna.bugsById,
    fauna.lastSeenHpByEntityId,
    fauna.cohortsById,
    fauna.nextCohortSeq,
    fauna.lastScheduledRollTickByColony,
    fauna.scheduledRollIndexByColony,
    fauna.pendingEvents,
  );

  const prevModeRaw = (
    state.blobs[FAUNA_MODE_BLOB]?.value as
      | { byEntityId?: Record<number, FaunaBehaviorMode> }
      | undefined
  )?.byEntityId;
  const modeByEntityId: Record<number, FaunaBehaviorMode> = prevModeRaw ? { ...prevModeRaw } : {};
  const aggroByEntityId: Record<number, FaunaAggressionEntry> = {};
  const aggroByHiveId: Record<number, FaunaAggressionEntry> = {};
  const bugTimingById: Record<number, { lastWanderTick: number; lastAttackTick: number }> = {};
  const hiveReplenishById: Record<number, number> = {};

  for (const hive of Object.values(synced.hivesById)) {
    const colonies = Object.keys(hive.aggressionByColony)
      .map(Number)
      .sort((a, b) => a - b);
    const mode: FaunaBehaviorMode = colonies.length > 0 ? 'aggressive' : 'passive';
    hive.mode = mode;
    hive.aggressiveColonies = colonies;
    modeByEntityId[hive.hiveId] = mode;
    hiveReplenishById[hive.hiveId] = hive.lastReplenishTick;
    const entry: FaunaAggressionEntry = {
      mode,
      aggressiveColonies: colonies,
      aggressionByColony: { ...hive.aggressionByColony },
      hiveId: hive.hiveId,
    };
    aggroByEntityId[hive.hiveId] = entry;
    aggroByHiveId[hive.hiveId] = entry;
  }

  for (const bug of Object.values(synced.bugsById)) {
    const mergedCols = Array.from(new Set(bug.aggressiveColonies)).sort((a, b) => a - b);
    const mode: FaunaBehaviorMode = mergedCols.length > 0 ? 'aggressive' : 'passive';
    bug.mode = mode;
    bug.aggressiveColonies = mergedCols;
    if (mode === 'passive') bug.targetColony = null;
    else if (bug.targetColony === null || !mergedCols.includes(bug.targetColony)) {
      bug.targetColony = mergedCols[0] ?? null;
    }
    modeByEntityId[bug.entityId] = mode;
    bugTimingById[bug.entityId] = {
      lastWanderTick: bug.lastWanderTick,
      lastAttackTick: bug.lastAttackTick,
    };
    aggroByEntityId[bug.entityId] = {
      mode,
      aggressiveColonies: mergedCols,
      targetColony: bug.targetColony,
      hiveId: bug.homeHiveId,
    };
  }

  const structuralChanged = hasStructuralFaunaChange(prevHivesBlob, synced);
  if (!state.blobs[FAUNA_HIVES_BLOB] || structuralChanged) {
    setBlob(state, FAUNA_HIVES_BLOB, synced, tick);
  }

  if (!state.blobs[FAUNA_MODE_BLOB] || hasModeMapChanged(prevModeRaw, modeByEntityId)) {
    setBlob(state, FAUNA_MODE_BLOB, { byEntityId: modeByEntityId }, tick);
  }

  const nextAggro: FaunaInternalTimingBlob = {
    byEntityId: aggroByEntityId,
    byHiveId: aggroByHiveId,
    lastSeenHpByEntityId: { ...fauna.lastSeenHpByEntityId },
    bugTimingById,
    hiveReplenishById,
    cohortsById: cloneCohortsMap(fauna.cohortsById),
    nextCohortSeq: fauna.nextCohortSeq,
    lastScheduledRollTickByColony: { ...fauna.lastScheduledRollTickByColony },
    scheduledRollIndexByColony: { ...fauna.scheduledRollIndexByColony },
    pendingEvents: fauna.pendingEvents.map((e) => ({ ...e, data: { ...e.data } })),
  };
  setBlob(state, FAUNA_AGGRESSION_BLOB, nextAggro, tick);
}

function syncHiveWithEntities(state: PlanetState, hive: HiveRecord): HiveRecord {
  const cols = state.entities.cols;
  const hRow = rowOf(state.entities, hive.hiveId);
  const hp = hRow >= 0 ? cols.hp[hRow]! : hive.hp;
  const destroyed = hRow >= 0 ? hp <= 0 : hive.destroyed;
  const residentIds =
    state.entities.count > 0 || state.entities.removed.length > 0
      ? hive.residentIds.filter((id) => {
          const r = rowOf(state.entities, id);
          return r >= 0 && cols.hp[r]! > 0;
        })
      : hive.residentIds;
  return { ...hive, hp, destroyed, residentIds, lastReplenishTick: 0 };
}

export function getHiveRecord(state: PlanetState, hiveId: number): HiveRecord | undefined {
  const h = getFaunaHivesState(state).hivesById[hiveId];
  return h ? syncHiveWithEntities(state, h) : undefined;
}

export function getAllHives(state: PlanetState): HiveRecord[] {
  return Object.values(getFaunaHivesState(state).hivesById)
    .map((h) => syncHiveWithEntities(state, h))
    .sort((a, b) => a.hiveId - b.hiveId);
}

export function getResidentBugRecord(
  state: PlanetState,
  entityId: number,
): ResidentBugRecord | undefined {
  const b = getFaunaHivesState(state).bugsById[entityId];
  if (!b) return undefined;
  if (state.entities.count > 0 || state.entities.removed.length > 0) {
    const r = rowOf(state.entities, entityId);
    if (r < 0 || state.entities.cols.hp[r]! <= 0) return undefined;
  }
  return { ...b, lastWanderTick: b.spawnedTick, lastAttackTick: -9999 };
}

export function getAllResidentBugs(state: PlanetState): ResidentBugRecord[] {
  const cols = state.entities.cols;
  const checkLiveness = state.entities.count > 0 || state.entities.removed.length > 0;
  return Object.values(getFaunaHivesState(state).bugsById)
    .filter((b) => {
      if (!checkLiveness) return true;
      const r = rowOf(state.entities, b.entityId);
      return r >= 0 && cols.hp[r]! > 0;
    })
    .map((b) => ({ ...b, lastWanderTick: b.spawnedTick, lastAttackTick: -9999 }))
    .sort((a, b) => a.entityId - b.entityId);
}

export function getCohortRecord(
  state: PlanetState,
  cohortId: string,
): FaunaCohortRecord | undefined {
  return getFaunaHivesState(state).cohortsById[cohortId];
}

export function getActiveCohorts(state: PlanetState): FaunaCohortRecord[] {
  return Object.values(getFaunaHivesState(state).cohortsById).sort((a, b) =>
    a.cohortId < b.cohortId ? -1 : a.cohortId > b.cohortId ? 1 : 0,
  );
}

export function isHiveAggressiveToColony(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
): boolean {
  const hive = getHiveRecord(state, hiveId);
  if (!hive) return false;
  return Boolean(hive.aggressionByColony[colonyIndex]);
}

export function isFaunaEntityAggressiveToColony(
  state: PlanetState,
  entityId: number,
  colonyIndex: number,
): boolean {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[entityId];
  if (hive) return Boolean(hive.aggressionByColony[colonyIndex]);
  const bug = fauna.bugsById[entityId];
  if (!bug) return false;
  return bug.aggressiveColonies.includes(colonyIndex);
}
