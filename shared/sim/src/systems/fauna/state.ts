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
  const hivesById: Record<number, HiveRecord> = {};
  const bugsById: Record<number, ResidentBugRecord> = {};
  const rawHives = raw?.hivesById ?? raw?.hives ?? {};
  for (const [k, h] of Object.entries(rawHives)) {
    if (h) hivesById[Number(k)] = cloneHiveRecord(h);
  }
  const rawBugs = raw?.bugsById ?? {};
  for (const [k, b] of Object.entries(rawBugs)) {
    if (b) bugsById[Number(k)] = cloneBugRecord(b);
  }
  const lastSeenHpByEntityId: Record<number, number> = raw?.lastSeenHpByEntityId
    ? { ...raw.lastSeenHpByEntityId }
    : {};
  const cohortsById = cloneCohortsMap(raw?.cohortsById);
  const nextCohortSeq = typeof raw?.nextCohortSeq === 'number' ? raw.nextCohortSeq : 1;
  const lastScheduledRollTickByColony: Record<number, number> = raw?.lastScheduledRollTickByColony
    ? { ...raw.lastScheduledRollTickByColony }
    : {};
  const scheduledRollIndexByColony: Record<number, number> = raw?.scheduledRollIndexByColony
    ? { ...raw.scheduledRollIndexByColony }
    : {};
  const pendingEvents: PendingFaunaEvent[] = Array.isArray(raw?.pendingEvents)
    ? raw.pendingEvents.map((e) => ({ ...e, data: { ...e.data } }))
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

  return {
    initialized,
    hivesById,
    bugsById,
    hives,
    byEntityId,
    residentHiveByEntityId,
    lastSeenHpByEntityId,
    cohortsById,
    nextCohortSeq,
    lastScheduledRollTickByColony,
    scheduledRollIndexByColony,
    pendingEvents,
  };
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
    if (!ph || ph.destroyed !== nh.destroyed || ph.mode !== nh.mode) return true;
    if (!sameNumArr(ph.aggressiveColonies, nh.aggressiveColonies)) return true;
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

  for (const hive of Object.values(synced.hivesById)) {
    const colonies = Object.keys(hive.aggressionByColony)
      .map(Number)
      .sort((a, b) => a - b);
    const mode: FaunaBehaviorMode = colonies.length > 0 ? 'aggressive' : 'passive';
    hive.mode = mode;
    hive.aggressiveColonies = colonies;
    modeByEntityId[hive.hiveId] = mode;
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
  } else {
    state.blobs[FAUNA_HIVES_BLOB].value = synced;
  }

  if (!state.blobs[FAUNA_MODE_BLOB] || hasModeMapChanged(prevModeRaw, modeByEntityId)) {
    setBlob(state, FAUNA_MODE_BLOB, { byEntityId: modeByEntityId }, tick);
  } else {
    state.blobs[FAUNA_MODE_BLOB].value = { byEntityId: modeByEntityId };
  }

  const nextAggro = { byEntityId: aggroByEntityId, byHiveId: aggroByHiveId };
  if (!state.blobs[FAUNA_AGGRESSION_BLOB] || structuralChanged) {
    setBlob(state, FAUNA_AGGRESSION_BLOB, nextAggro, tick);
  } else {
    state.blobs[FAUNA_AGGRESSION_BLOB].value = nextAggro;
  }
}

export function getHiveRecord(state: PlanetState, hiveId: number): HiveRecord | undefined {
  return getFaunaHivesState(state).hivesById[hiveId];
}

export function getAllHives(state: PlanetState): HiveRecord[] {
  return Object.values(getFaunaHivesState(state).hivesById).sort((a, b) => a.hiveId - b.hiveId);
}

export function getResidentBugRecord(
  state: PlanetState,
  entityId: number,
): ResidentBugRecord | undefined {
  return getFaunaHivesState(state).bugsById[entityId];
}

export function getAllResidentBugs(state: PlanetState): ResidentBugRecord[] {
  return Object.values(getFaunaHivesState(state).bugsById).sort((a, b) => a.entityId - b.entityId);
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
