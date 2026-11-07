import { combatApproachBand, footprintAttackRange } from '../combat/approachBand';
import { ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf, setField, type EntityStore } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getUnitCommand } from '../../units/book';
import { issueUnitCommand } from '../units/registry';
import type { FaunaDirective, FaunaDirectivesBlob, FaunaSparseBugRecord } from './directives';
import { clearHiveAggressionAgainstColony, provokeHiveAgainstColony } from './provocation';
import { findResidentSpawnTile } from './spawn';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import { defaultFaunaData, resolveSpeciesConfig, type FaunaHivesBlob } from './types';

const DEFAULT_W07_FLAGS = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);

export function makeDirectiveStepCtx(
  state: PlanetState,
  tick: number,
  data?: CompiledDataLike,
): StepContext {
  return {
    dt: 1,
    tick,
    flags: DEFAULT_W07_FLAGS,
    data: data ?? defaultFaunaData(),
    events: [],
    postings: [],
    record: () => {},
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => {},
  };
}

function applySpawnPayload(
  state: PlanetState,
  directive: FaunaDirective,
  tick: number,
  data: CompiledDataLike,
): void {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[directive.hiveId];
  const species = directive.payload.species ?? hive?.species ?? 'blackAnt';
  const cfg = resolveSpeciesConfig(species, data);
  const bugId = directive.payload.bugId ?? state.meta.nextEntityId;

  let row = rowOf(state.entities, bugId);
  if (row < 0) {
    if (state.meta.nextEntityId <= bugId) state.meta.nextEntityId = bugId + 1;
    const fallback = hive
      ? (findResidentSpawnTile(state, hive, data) ?? { q: hive.entranceQ, r: hive.entranceR })
      : { q: 0, r: 0 };
    const q = directive.payload.q ?? fallback.q;
    const r = directive.payload.r ?? fallback.r;
    row = insertRow(state.entities, bugId, tick);
    const cols = state.entities.cols;
    cols.kind[row] = cfg.bugKind;
    cols.owner[row] = -1;
    cols.hp[row] = cfg.hp;
    cols.hpMax[row] = cfg.hp;
    cols.state[row] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, row, q, r, tick);
  }

  if (!fauna.bugsById[bugId]) {
    fauna.bugsById[bugId] = {
      entityId: bugId,
      species,
      homeHiveId: directive.hiveId,
      mode: 'passive',
      targetColony: null,
      aggressiveColonies: [],
      cohortId: null,
      lastWanderTick: tick,
      lastAttackTick: -9999,
      spawnedTick: tick,
    };
  }
  if (hive) {
    if (!hive.residentIds.includes(bugId)) hive.residentIds.push(bugId);
    hive.lastReplenishTick = tick;
    hive.decisionIndex = Math.max(hive.decisionIndex, directive.decisionIndex);
  }
  fauna.lastSeenHpByEntityId[bugId] = state.entities.cols.hp[row]!;
  saveFaunaHivesState(state, fauna, tick);
}

function applyModePayload(
  state: PlanetState,
  directive: FaunaDirective,
  tick: number,
  data: CompiledDataLike,
): void {
  const mode = directive.payload.mode ?? 'passive';
  const col = directive.payload.targetColony;
  if (mode === 'aggressive') {
    if (col !== undefined) provokeHiveAgainstColony(state, directive.hiveId, col, tick, data);
    else {
      const fauna = getFaunaHivesState(state);
      const hive = fauna.hivesById[directive.hiveId];
      if (hive) {
        hive.mode = 'aggressive';
        saveFaunaHivesState(state, fauna, tick);
      }
    }
  } else if (col !== undefined) {
    clearHiveAggressionAgainstColony(state, directive.hiveId, col, tick);
  } else {
    const fauna = getFaunaHivesState(state);
    const hive = fauna.hivesById[directive.hiveId];
    if (hive) {
      for (const c of [...hive.aggressiveColonies]) {
        clearHiveAggressionAgainstColony(state, directive.hiveId, c, tick);
      }
    }
  }
  const latest = getFaunaHivesState(state);
  const hive = latest.hivesById[directive.hiveId];
  if (hive) {
    hive.decisionIndex = Math.max(hive.decisionIndex, directive.decisionIndex);
    saveFaunaHivesState(state, latest, tick);
  }
}

function applyCohortDispatchPayload(
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  tick: number,
  data: CompiledDataLike,
): void {
  const targetColony = directive.payload.targetColony ?? 0;
  provokeHiveAgainstColony(state, directive.hiveId, targetColony, tick, data);

  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[directive.hiveId];
  const species = directive.payload.species ?? hive?.species ?? 'blackAnt';
  const cfg = resolveSpeciesConfig(species, data);
  const cohortId = directive.payload.cohortId ?? `cohort:${directive.hiveId}:${directive.seq}`;
  const rawMembers = directive.payload.memberIds ?? (hive ? [...hive.residentIds] : []);
  const memberIds = Array.from(new Set(rawMembers)).filter((id) => {
    const r = rowOf(state.entities, id);
    return r >= 0 && state.entities.cols.hp[r]! > 0;
  });

  const tRow =
    directive.payload.targetEntityId !== undefined
      ? rowOf(state.entities, directive.payload.targetEntityId)
      : -1;
  const objectiveQ =
    directive.payload.objectiveQ ??
    (tRow >= 0 ? state.entities.cols.q[tRow]! : (hive?.entranceQ ?? 0));
  const objectiveR =
    directive.payload.objectiveR ??
    (tRow >= 0 ? state.entities.cols.r[tRow]! : (hive?.entranceR ?? 0));

  if (hive && hive.aggressionByColony[targetColony]) {
    const rec = hive.aggressionByColony[targetColony]!;
    if (rec.activeCohortId !== cohortId) {
      rec.activeCohortId = cohortId;
      rec.wavesSent += 1;
      rec.lastWaveTick = tick;
    }
    hive.decisionIndex = Math.max(hive.decisionIndex, directive.decisionIndex);
  }

  const bandMax = combatApproachBand(footprintAttackRange(cfg.range, tRow >= 0 ? state.entities.cols.footprintW[tRow] : 1)).maxDist;
  const stepCtx = makeDirectiveStepCtx(state, tick, data);
  for (const bugId of memberIds) {
    const bug = fauna.bugsById[bugId];
    if (bug) {
      bug.cohortId = cohortId;
      bug.mode = 'aggressive';
      bug.targetColony = targetColony;
      if (!bug.aggressiveColonies.includes(targetColony)) {
        bug.aggressiveColonies = [...bug.aggressiveColonies, targetColony].sort((a, b) => a - b);
      }
    }
    const bugRow = rowOf(state.entities, bugId);
    if (bugRow >= 0) {
      setField(state.entities, bugRow, 'targetQ', objectiveQ, tick);
      setField(state.entities, bugRow, 'targetR', objectiveR, tick);
      issueUnitCommand(
        state,
        bugRow,
        { kind: 'move', source: 'auto', q: objectiveQ, r: objectiveR, minDist: 0, maxDist: bandMax },
        stepCtx,
      );
    }
  }

  saveFaunaHivesState(state, fauna, tick);
  blob.cohortsById[cohortId] = {
    cohortId,
    hiveId: directive.hiveId,
    species,
    memberIds,
    targetColony,
    ...(directive.payload.targetEntityId !== undefined
      ? { targetEntityId: directive.payload.targetEntityId }
      : {}),
    objectiveQ,
    objectiveR,
    dispatchedAtTick: tick,
  };
}

function applyCohortReturnPayload(
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  tick: number,
  data: CompiledDataLike,
): void {
  const cohortId = directive.payload.cohortId;
  const cohort = cohortId ? blob.cohortsById[cohortId] : undefined;
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[directive.hiveId];
  const entranceQ = directive.payload.objectiveQ ?? hive?.entranceQ ?? hive?.q ?? 0;
  const entranceR = directive.payload.objectiveR ?? hive?.entranceR ?? hive?.r ?? 0;
  const memberIds =
    directive.payload.memberIds ??
    cohort?.memberIds ??
    Object.values(fauna.bugsById)
      .filter((b) => (cohortId ? b.cohortId === cohortId : b.homeHiveId === directive.hiveId))
      .map((b) => b.entityId);

  const stepCtx = makeDirectiveStepCtx(state, tick, data);
  for (const bugId of memberIds) {
    const bug = fauna.bugsById[bugId];
    if (bug) {
      bug.cohortId = null;
      if (directive.payload.mode === 'passive') {
        bug.mode = 'passive';
        bug.targetColony = null;
        bug.aggressiveColonies = [];
      }
    }
    const bugRow = rowOf(state.entities, bugId);
    if (bugRow >= 0 && state.entities.cols.hp[bugRow]! > 0) {
      setField(state.entities, bugRow, 'targetQ', entranceQ, tick);
      setField(state.entities, bugRow, 'targetR', entranceR, tick);
      issueUnitCommand(
        state,
        bugRow,
        { kind: 'move', source: 'auto', q: entranceQ, r: entranceR, minDist: 0, maxDist: 2 },
        stepCtx,
      );
    }
  }

  const targetColony = directive.payload.targetColony ?? cohort?.targetColony;
  if (hive && targetColony !== undefined && hive.aggressionByColony[targetColony]) {
    hive.aggressionByColony[targetColony]!.activeCohortId = null;
  }
  if (hive) hive.decisionIndex = Math.max(hive.decisionIndex, directive.decisionIndex);
  if (cohortId) delete blob.cohortsById[cohortId];
  saveFaunaHivesState(state, fauna, tick);
}

function applyTargetChangePayload(
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  tick: number,
  data: CompiledDataLike,
): void {
  const cohortId = directive.payload.cohortId;
  const cohort = cohortId ? blob.cohortsById[cohortId] : undefined;
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[directive.hiveId];
  const tRow =
    directive.payload.targetEntityId !== undefined
      ? rowOf(state.entities, directive.payload.targetEntityId)
      : -1;
  const objectiveQ =
    directive.payload.objectiveQ ??
    (tRow >= 0 ? state.entities.cols.q[tRow]! : (cohort?.objectiveQ ?? hive?.entranceQ ?? 0));
  const objectiveR =
    directive.payload.objectiveR ??
    (tRow >= 0 ? state.entities.cols.r[tRow]! : (cohort?.objectiveR ?? hive?.entranceR ?? 0));

  if (cohort) {
    if (directive.payload.targetEntityId !== undefined) {
      cohort.targetEntityId = directive.payload.targetEntityId;
    }
    cohort.objectiveQ = objectiveQ;
    cohort.objectiveR = objectiveR;
  }

  const memberIds =
    directive.payload.memberIds ??
    cohort?.memberIds ??
    (directive.payload.bugId !== undefined
      ? [directive.payload.bugId]
      : (hive?.residentIds ?? []));
  const species = directive.payload.species ?? cohort?.species ?? hive?.species ?? 'blackAnt';
  const cfg = resolveSpeciesConfig(species, data);
  const bandMax = combatApproachBand(footprintAttackRange(cfg.range, tRow >= 0 ? state.entities.cols.footprintW[tRow] : 1)).maxDist;
  const stepCtx = makeDirectiveStepCtx(state, tick, data);

  for (const bugId of memberIds) {
    const bug = fauna.bugsById[bugId];
    if (bug && directive.payload.targetColony !== undefined) {
      bug.targetColony = directive.payload.targetColony;
      if (!bug.aggressiveColonies.includes(directive.payload.targetColony)) {
        bug.aggressiveColonies = [
          ...bug.aggressiveColonies,
          directive.payload.targetColony,
        ].sort((a, b) => a - b);
      }
      bug.mode = 'aggressive';
    }
    const bugRow = rowOf(state.entities, bugId);
    if (bugRow >= 0 && state.entities.cols.hp[bugRow]! > 0) {
      setField(state.entities, bugRow, 'targetQ', objectiveQ, tick);
      setField(state.entities, bugRow, 'targetR', objectiveR, tick);
      issueUnitCommand(
        state,
        bugRow,
        { kind: 'move', source: 'auto', q: objectiveQ, r: objectiveR, minDist: 0, maxDist: bandMax },
        stepCtx,
      );
    }
  }
  if (hive) hive.decisionIndex = Math.max(hive.decisionIndex, directive.decisionIndex);
  saveFaunaHivesState(state, fauna, tick);
}

export function executeFaunaDirectivePayload(
  state: PlanetState,
  directive: FaunaDirective,
  blob: FaunaDirectivesBlob,
  data?: CompiledDataLike,
): void {
  const resolvedData = data ?? defaultFaunaData();
  const tick = directive.effectiveTick ?? state.meta.tick;
  switch (directive.kind) {
    case 'spawn':
      applySpawnPayload(state, directive, tick, resolvedData);
      break;
    case 'mode':
      applyModePayload(state, directive, tick, resolvedData);
      break;
    case 'cohortDispatch':
      applyCohortDispatchPayload(state, directive, blob, tick, resolvedData);
      break;
    case 'cohortReturn':
      applyCohortReturnPayload(state, directive, blob, tick, resolvedData);
      break;
    case 'targetChange':
      applyTargetChangePayload(state, directive, blob, tick, resolvedData);
      break;
  }
}

function syncReplicaPositionField(
  store: EntityStore,
  row: number,
  colName: 'x' | 'y' | 'q' | 'r',
  val: number,
  tick: number,
): void {
  const col = store.cols[colName];
  if (col && col[row] !== val) {
    col[row] = val;
    store.cols.changedAt[row] = tick;
  }
}

export function reconcileSingleBugRecord(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  item: FaunaSparseBugRecord,
  tick: number,
  data: CompiledDataLike,
): 'reconciled' | 'spawned' | 'removed' {
  const hive = fauna.hivesById[item.hiveId];
  const species = hive?.species ?? fauna.bugsById[item.entityId]?.species ?? 'blackAnt';
  const cfg = resolveSpeciesConfig(species, data);
  let row = rowOf(state.entities, item.entityId);

  if (item.hp <= 0) {
    if (row >= 0) setField(state.entities, row, 'hp', 0, tick);
    delete fauna.bugsById[item.entityId];
    if (hive) hive.residentIds = hive.residentIds.filter((id) => id !== item.entityId);
    return 'removed';
  }

  let spawned = false;
  if (row < 0) {
    if (state.meta.nextEntityId <= item.entityId) state.meta.nextEntityId = item.entityId + 1;
    row = insertRow(state.entities, item.entityId, tick);
    const cols = state.entities.cols;
    cols.kind[row] = cfg.bugKind;
    cols.owner[row] = -1;
    cols.hp[row] = item.hp;
    cols.hpMax[row] = cfg.hp;
    cols.state[row] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, row, item.q, item.r, tick);
    spawned = true;
  }

  setField(state.entities, row, 'hp', Math.fround(item.hp), tick);
  syncReplicaPositionField(state.entities, row, 'q', item.q, tick);
  syncReplicaPositionField(state.entities, row, 'r', item.r, tick);
  syncReplicaPositionField(state.entities, row, 'x', Math.fround(item.x), tick);
  syncReplicaPositionField(state.entities, row, 'y', Math.fround(item.y), tick);

  if (!fauna.bugsById[item.entityId]) {
    fauna.bugsById[item.entityId] = {
      entityId: item.entityId,
      species,
      homeHiveId: item.hiveId,
      mode: hive?.mode ?? 'passive',
      targetColony: hive?.aggressiveColonies[0] ?? null,
      aggressiveColonies: hive ? [...hive.aggressiveColonies] : [],
      cohortId: null,
      lastWanderTick: tick,
      lastAttackTick: -9999,
      spawnedTick: tick,
    };
  }
  if (hive && !hive.residentIds.includes(item.entityId)) hive.residentIds.push(item.entityId);

  if (item.targetQ !== undefined && item.targetR !== undefined) {
    setField(state.entities, row, 'targetQ', item.targetQ, tick);
    setField(state.entities, row, 'targetR', item.targetR, tick);
    const curCmd = getUnitCommand(state, item.entityId);
    if (
      item.orderKind === 'move' &&
      (curCmd?.kind !== 'move' || curCmd.q !== item.targetQ || curCmd.r !== item.targetR)
    ) {
      issueUnitCommand(
        state,
        row,
        { kind: 'move', source: 'auto', q: item.targetQ, r: item.targetR },
        makeDirectiveStepCtx(state, tick, data),
      );
    }
  }
  fauna.lastSeenHpByEntityId[item.entityId] = item.hp;
  return spawned ? 'spawned' : 'reconciled';
}
