import type { CompiledRow } from '../../data';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import { defaultFaunaData } from './types';

function resolveMaxWavesPerEpisode(data?: CompiledDataLike): number {
  const src = data ?? defaultFaunaData();
  const cfg = (src.tables?.fauna as Record<string, CompiledRow | undefined> | undefined)?.hiveConfig;
  const v = Number(cfg?.maxWavesPerEpisode ?? 3);
  return Number.isFinite(v) && v >= 1 ? Math.round(v) : 3;
}

/**
 * Provokes a specific hive (`hiveId`) and its current resident bugs against `colonyIndex`
 * (`fauna-hives-spec.md` §2). Other hives and other colonies remain neutral.
 */
export function provokeHiveAgainstColony(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  if (!Number.isInteger(colonyIndex) || colonyIndex < 0) return false;
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[hiveId];
  if (!hive || hive.destroyed) return false;

  const maxWaves = resolveMaxWavesPerEpisode(data);
  const existing = hive.aggressionByColony[colonyIndex];
  hive.aggressionByColony[colonyIndex] = {
    colonyIndex,
    triggeredAtTick: existing ? existing.triggeredAtTick : tick,
    wavesSent: existing ? existing.wavesSent : 0,
    maxWaves,
    lastWaveTick: existing ? existing.lastWaveTick : tick,
    activeCohortId: existing ? existing.activeCohortId : null,
  };
  hive.mode = 'aggressive';
  if (!hive.aggressiveColonies.includes(colonyIndex)) {
    hive.aggressiveColonies = [...hive.aggressiveColonies, colonyIndex].sort((a, b) => a - b);
  }

  for (const bugId of hive.residentIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    if (!bug.aggressiveColonies.includes(colonyIndex)) {
      bug.aggressiveColonies = [...bug.aggressiveColonies, colonyIndex].sort((a, b) => a - b);
    }
    bug.mode = 'aggressive';
    if (bug.targetColony === null) {
      bug.targetColony = colonyIndex;
    }
  }

  saveFaunaHivesState(state, fauna, tick);
  return true;
}

/**
 * Clears aggression of `hiveId` against `colonyIndex` (e.g. after a bounded episode resolves or the colony is eliminated).
 */
export function clearHiveAggressionAgainstColony(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  tick = state.meta.tick,
): boolean {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[hiveId];
  if (!hive || !hive.aggressionByColony[colonyIndex]) return false;

  delete hive.aggressionByColony[colonyIndex];
  hive.aggressiveColonies = Object.keys(hive.aggressionByColony)
    .map(Number)
    .sort((a, b) => a - b);
  hive.mode = hive.aggressiveColonies.length > 0 ? 'aggressive' : 'passive';

  for (const bugId of hive.residentIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    bug.aggressiveColonies = bug.aggressiveColonies.filter((c) => c !== colonyIndex);
    bug.mode = bug.aggressiveColonies.length > 0 ? 'aggressive' : 'passive';
    if (bug.targetColony === colonyIndex) {
      bug.targetColony = bug.aggressiveColonies[0] ?? null;
    }
  }

  saveFaunaHivesState(state, fauna, tick);
  return true;
}

function resolveAttackerColony(
  state: PlanetState,
  attackerOwner?: number,
  attackerEntityId?: number,
): number | null {
  if (typeof attackerOwner === 'number' && Number.isInteger(attackerOwner) && attackerOwner >= 0) {
    return attackerOwner;
  }
  if (typeof attackerEntityId === 'number' && attackerEntityId > 0) {
    const row = rowOf(state.entities, attackerEntityId);
    if (row >= 0) {
      const owner = state.entities.cols.owner[row]!;
      if (owner >= 0) return owner;
    }
  }
  return null;
}

/**
 * Handles confirmed damage dealt to `targetEntityId` (a hive or resident bug) by a colony (`attackerOwner` or `attackerEntityId`).
 * Provokes ONLY that hive (or that bug's `homeHiveId`) against the responsible colony (`fauna-hives-spec.md` §2).
 */
export function provokeHiveFromDamage(
  state: PlanetState,
  targetEntityId: number,
  attackerOwner?: number,
  attackerEntityId?: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  const colonyIndex = resolveAttackerColony(state, attackerOwner, attackerEntityId);
  if (colonyIndex === null || colonyIndex < 0) return false;

  const fauna = getFaunaHivesState(state);
  const directHive = fauna.hivesById[targetEntityId];
  if (directHive) {
    return provokeHiveAgainstColony(state, directHive.hiveId, colonyIndex, tick, data);
  }

  const bug = fauna.bugsById[targetEntityId];
  if (bug) {
    return provokeHiveAgainstColony(state, bug.homeHiveId, colonyIndex, tick, data);
  }
  return false;
}

export const onFaunaDamaged = provokeHiveFromDamage;

function findColonyAttackingEntity(state: PlanetState, targetEntityId: number): number | null {
  const dmgBlob = state.blobs.combatDamage?.value as
    | { lastAttackerOwnerByEntity?: Record<number, number> }
    | undefined;
  const recordedOwner = dmgBlob?.lastAttackerOwnerByEntity?.[targetEntityId];
  if (typeof recordedOwner === 'number' && recordedOwner >= 0) {
    return recordedOwner;
  }

  const book = new UnitBook(state);
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    const owner = cols.owner[r]!;
    if (owner < 0 || cols.hp[r]! <= 0) continue;
    const cmd = book.peek(cols.id[r]!)?.current;
    if (cmd?.kind === 'attack' && cmd.targetId === targetEntityId) {
      return owner;
    }
  }

  const targetsBlob = state.blobs.combatTargets?.value as
    | { byEntityId?: Record<number, number> }
    | undefined;
  if (targetsBlob?.byEntityId) {
    for (const [attackerIdStr, tgtId] of Object.entries(targetsBlob.byEntityId)) {
      if (tgtId !== targetEntityId) continue;
      const aRow = rowOf(state.entities, Number(attackerIdStr));
      if (aRow >= 0 && cols.owner[aRow]! >= 0) return cols.owner[aRow]!;
    }
  }
  return null;
}

/**
 * Scans combat events and HP deltas on `state` to trigger colony-scoped provocation whenever a
 * passive bug or hive takes confirmed damage from a colony (`fauna-hives-spec.md` §2).
 */
export function detectAndApplyDamageProvocation(
  state: PlanetState,
  tick = state.meta.tick,
  ctx?: StepContext,
): void {
  if (ctx?.events) {
    for (const ev of ctx.events) {
      if (ev.atTick !== tick) continue;
      const d = (ev.data ?? {}) as Record<string, unknown>;
      if (ev.kind === 'projectileImpact' && d.hit === true) {
        const attackerId = typeof d.attackerId === 'number' ? d.attackerId : undefined;
        const colonyIndex = typeof d.colonyIndex === 'number' ? d.colonyIndex : undefined;
        const hitIds = Array.isArray(d.hitEntityIds) ? (d.hitEntityIds as number[]) : [];
        for (const tid of hitIds) {
          provokeHiveFromDamage(state, tid, colonyIndex, attackerId, tick, ctx.data);
        }
      } else if (ev.kind === 'faunaKilled' || ev.kind === 'nestDestroyed') {
        const tid = Number(d.entityId ?? d.hiveId ?? 0);
        const attackerId = typeof d.attackerId === 'number' ? d.attackerId : undefined;
        const colonyIndex = typeof d.colonyIndex === 'number' ? d.colonyIndex : undefined;
        if (tid > 0) {
          provokeHiveFromDamage(state, tid, colonyIndex, attackerId, tick, ctx.data);
        }
      }
    }
  }

  const fauna = getFaunaHivesState(state);
  const cols = state.entities.cols;
  let dirty = false;

  for (const hive of Object.values(fauna.hivesById)) {
    const row = rowOf(state.entities, hive.hiveId);
    const curHp = row >= 0 ? cols.hp[row]! : 0;
    const prevHp = fauna.lastSeenHpByEntityId[hive.hiveId] ?? hive.hpMax;
    if (curHp < prevHp) {
      const attackerColony = findColonyAttackingEntity(state, hive.hiveId);
      if (attackerColony !== null) {
        provokeHiveAgainstColony(state, hive.hiveId, attackerColony, tick, ctx?.data);
      }
      fauna.lastSeenHpByEntityId[hive.hiveId] = curHp;
      dirty = true;
    }
  }

  for (const bug of Object.values(fauna.bugsById)) {
    const row = rowOf(state.entities, bug.entityId);
    const curHp = row >= 0 ? cols.hp[row]! : 0;
    const prevHp = fauna.lastSeenHpByEntityId[bug.entityId] ?? curHp;
    if (curHp < prevHp) {
      const attackerColony = findColonyAttackingEntity(state, bug.entityId);
      if (attackerColony !== null) {
        provokeHiveAgainstColony(state, bug.homeHiveId, attackerColony, tick, ctx?.data);
      }
      fauna.lastSeenHpByEntityId[bug.entityId] = curHp;
      dirty = true;
    }
  }

  if (dirty) {
    const latest = getFaunaHivesState(state);
    latest.lastSeenHpByEntityId = { ...latest.lastSeenHpByEntityId, ...fauna.lastSeenHpByEntityId };
    saveFaunaHivesState(state, latest, tick);
  }
}
