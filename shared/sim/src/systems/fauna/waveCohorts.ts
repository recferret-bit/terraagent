import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import { nextFloat, seedStream } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { getMotion } from '../../units/movement/orchestrator';
import {
  emitRaidRepelled,
  getCombatEventsBlob,
  setCombatEventsBlob,
} from '../combat/events';
import { threatOf } from '../progression/threat';
import { issueUnitCommand } from '../units/registry';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import {
  resolveSpeciesConfig,
  type FaunaCohortRecord,
  type FaunaHivesBlob,
} from './types';
import {
  dispatchHiveWave,
  findNearestColonyTarget,
  hasAnyAliveColonyEntity,
  resolveWaveConfig,
  selectCandidateHiveForRaid,
  spawnHiveRaidWave,
} from './waves';

function clearActiveRaidTrackingWithoutRepelled(
  state: PlanetState,
  colonyIndex: number,
  cohortId: string,
  tick: number,
): void {
  const evState = getCombatEventsBlob(state);
  const active = evState.activeRaidsByColony?.[colonyIndex];
  if (active && active.raidId === cohortId && evState.activeRaidsByColony) {
    delete evState.activeRaidsByColony[colonyIndex];
    setCombatEventsBlob(state, evState, tick);
  }
}

function resolveAllDeadCohort(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  cohort: FaunaCohortRecord,
  ctx: StepContext,
): void {
  for (const id of cohort.memberIds) {
    const bug = fauna.bugsById[id];
    if (bug && bug.cohortId === cohort.cohortId) {
      bug.cohortId = null;
    }
  }
  delete fauna.cohortsById[cohort.cohortId];

  const hive = fauna.hivesById[cohort.hiveId];
  if (hive) {
    const agg = hive.aggressionByColony[cohort.colonyIndex];
    if (agg && agg.activeCohortId === cohort.cohortId) {
      agg.activeCohortId = null;
      if (
        agg.wavesSent >= agg.maxWaves ||
        hive.destroyed ||
        !hasAnyAliveColonyEntity(state, cohort.colonyIndex)
      ) {
        delete hive.aggressionByColony[cohort.colonyIndex];
      }
    }
  }
  saveFaunaHivesState(state, fauna, ctx.tick);
  emitRaidRepelled(state, { colonyIndex: cohort.colonyIndex, raidId: cohort.cohortId }, ctx);
}

function withdrawCohort(
  state: PlanetState,
  fauna: FaunaHivesBlob,
  cohort: FaunaCohortRecord,
  aliveMemberIds: number[],
  colonyEliminated: boolean,
  ctx: StepContext,
): void {
  const hive = fauna.hivesById[cohort.hiveId];
  for (const bugId of aliveMemberIds) {
    const bug = fauna.bugsById[bugId];
    if (bug) {
      bug.cohortId = null;
      bug.aggressiveColonies = bug.aggressiveColonies.filter((c) => c !== cohort.colonyIndex);
      bug.mode = bug.aggressiveColonies.length > 0 ? 'aggressive' : 'passive';
      bug.targetColony = bug.aggressiveColonies[0] ?? null;
    }
    const bRow = rowOf(state.entities, bugId);
    if (bRow >= 0 && hive && !hive.destroyed) {
      issueUnitCommand(
        state,
        bRow,
        {
          kind: 'move',
          source: 'auto',
          q: hive.entranceQ,
          r: hive.entranceR,
          minDist: 0,
          maxDist: 2,
        },
        ctx,
      );
    }
  }

  delete fauna.cohortsById[cohort.cohortId];
  if (hive) {
    const agg = hive.aggressionByColony[cohort.colonyIndex];
    if (agg && agg.activeCohortId === cohort.cohortId) {
      agg.activeCohortId = null;
      if (colonyEliminated || agg.wavesSent >= agg.maxWaves || hive.destroyed) {
        delete hive.aggressionByColony[cohort.colonyIndex];
      }
    }
  }
  saveFaunaHivesState(state, fauna, ctx.tick);
  clearActiveRaidTrackingWithoutRepelled(state, cohort.colonyIndex, cohort.cohortId, ctx.tick);
}

function enforceDestroyedHivePassiveRule(state: PlanetState, fauna: FaunaHivesBlob, tick: number): void {
  let dirty = false;
  for (const hive of Object.values(fauna.hivesById)) {
    if (!hive.destroyed) continue;
    for (const bugId of hive.residentIds) {
      const bug = fauna.bugsById[bugId];
      if (!bug || bug.cohortId !== null) continue;
      if (bug.mode !== 'passive' || bug.aggressiveColonies.length > 0) {
        bug.aggressiveColonies = [];
        bug.mode = 'passive';
        bug.targetColony = null;
        dirty = true;
      }
    }
  }
  if (dirty) saveFaunaHivesState(state, fauna, tick);
}

/**
 * Steps all active wave cohorts:
 * - Emits `raidRepelled` when all cohort members are dead.
 * - Withdraws surviving cohort members back to `(hive.entranceQ, hive.entranceR)` on `300 s` (`1500` ticks)
 *   timeout, unreachable target, or colony elimination without emitting `raidRepelled`.
 * - Enforces destroyed-hive behavior: non-cohort residents stay passive while active cohort members finish their wave.
 */
export function stepActiveCohorts(state: PlanetState, ctx: StepContext): void {
  let fauna = getFaunaHivesState(state);
  const cols = state.entities.cols;
  enforceDestroyedHivePassiveRule(state, fauna, ctx.tick);

  const cohortIds = Object.keys(fauna.cohortsById).sort();
  for (const cohortId of cohortIds) {
    fauna = getFaunaHivesState(state);
    const cohort = fauna.cohortsById[cohortId];
    if (!cohort) continue;

    const aliveMembers = cohort.memberIds.filter((id) => {
      const r = rowOf(state.entities, id);
      return r >= 0 && cols.hp[r]! > 0;
    });

    if (aliveMembers.length === 0) {
      resolveAllDeadCohort(state, fauna, cohort, ctx);
      continue;
    }

    const colonyEliminated = !hasAnyAliveColonyEntity(state, cohort.colonyIndex);
    const timedOut = ctx.tick - cohort.dispatchedAtTick >= cohort.timeoutTicks;

    const leadRow = rowOf(state.entities, aliveMembers[0]!);
    const fromQ = leadRow >= 0 ? cols.q[leadRow]! : 0;
    const fromR = leadRow >= 0 ? cols.r[leadRow]! : 0;
    const speciesCfg = resolveSpeciesConfig(cohort.species, ctx.data);
    const bandMax = speciesCfg.range >= 2 ? Math.floor(speciesCfg.range) - 1 : 1;
    const nearestTarget = colonyEliminated
      ? null
      : findNearestColonyTarget(state, fromQ, fromR, cohort.colonyIndex, bandMax, ctx.data);
    const allFailedMotion =
      ctx.tick > cohort.dispatchedAtTick &&
      aliveMembers.every((id) => getMotion(state, id)?.status === 'failed');
    const targetUnreachable =
      ctx.tick > cohort.dispatchedAtTick &&
      (!nearestTarget || !nearestTarget.reachable || allFailedMotion);

    if (colonyEliminated || timedOut || targetUnreachable) {
      withdrawCohort(state, fauna, cohort, aliveMembers, colonyEliminated, ctx);
      continue;
    }

    if (nearestTarget && cohort.targetEntityId !== nearestTarget.id) {
      cohort.targetEntityId = nearestTarget.id;
      saveFaunaHivesState(state, fauna, ctx.tick);
    }
  }
}

/**
 * Dispatches follow-up waves (`wavesSent < maxWaves`, up to 3 waves per episode) for provoked hives
 * once the previous cohort has resolved and `waveCooldownTicks` (`300` ticks = `60 s`) has elapsed.
 */
export function stepProvokedHiveWaveDispatches(state: PlanetState, ctx: StepContext): void {
  const fauna = getFaunaHivesState(state);
  const hiveIds = Object.keys(fauna.hivesById)
    .map(Number)
    .sort((a, b) => a - b);

  for (const hiveId of hiveIds) {
    const current = getFaunaHivesState(state);
    const hive = current.hivesById[hiveId];
    if (!hive || hive.destroyed) continue;
    const colonies = Object.keys(hive.aggressionByColony)
      .map(Number)
      .sort((a, b) => a - b);

    for (const colonyIndex of colonies) {
      if (!hasAnyAliveColonyEntity(state, colonyIndex)) {
        delete hive.aggressionByColony[colonyIndex];
        saveFaunaHivesState(state, current, ctx.tick);
        continue;
      }
      dispatchHiveWave(state, hiveId, colonyIndex, { tick: ctx.tick, data: ctx.data }, ctx);
    }
  }
}

/**
 * Scheduled pressure (`UO-T-01..04`, `fauna-hives-spec.md` §2):
 * - Not before `S3 + 5 min` (`1500` ticks after reaching S3 / first completed Robotics Factory).
 * - Every `10 min` (`3000` ticks), rolls `chance = Math.min(1, 0.10 + 0.05 * thermalCount)` using
 *   a deterministic seeded xoshiro stream (`seedStream`).
 * - On success, selects the closest live reachable hive to the colony's Hub/HQ (tie-break by lowest `hiveId`)
 *   and starts a bounded episode against that colony.
 */
export function stepScheduledHiveWaves(state: PlanetState, ctx: StepContext): void {
  const waveCfg = resolveWaveConfig(ctx.data);
  const colonyIndices = Object.keys(state.colonies)
    .map(Number)
    .sort((a, b) => a - b);

  for (const colonyIndex of colonyIndices) {
    const col = state.colonies[colonyIndex];
    if (!col || col.status !== 'active') continue;
    if (!hasAnyAliveColonyEntity(state, colonyIndex)) continue;

    const threat = threatOf(state, colonyIndex);
    if (!threat.raidsAllowed) continue;

    const fauna = getFaunaHivesState(state);
    const s3Tick = typeof col.s3ReachedAtTick === 'number' ? col.s3ReachedAtTick : 0;
    const lastRollTick = fauna.lastScheduledRollTickByColony[colonyIndex] ?? s3Tick;
    if (ctx.tick - lastRollTick < waveCfg.raidIntervalTicks) continue;

    const rollIndex = fauna.scheduledRollIndexByColony[colonyIndex] ?? 0;
    fauna.lastScheduledRollTickByColony[colonyIndex] = ctx.tick;
    fauna.scheduledRollIndexByColony[colonyIndex] = rollIndex + 1;
    saveFaunaHivesState(state, fauna, ctx.tick);

    const chance = Math.min(
      1,
      waveCfg.baseChance + waveCfg.perThermalChance * threat.thermalGenerators,
    );
    const rng = seedStream(
      String(state.meta.seed),
      `fauna:scheduledRaid:col:${colonyIndex}:roll:${rollIndex}:tick:${ctx.tick}`,
    );
    const u = nextFloat(rng);
    if (u >= chance) continue;

    const targetHive = selectCandidateHiveForRaid(state, colonyIndex, {
      requireReachable: true,
      data: ctx.data,
    });
    if (!targetHive) continue;

    spawnHiveRaidWave(
      state,
      { colonyIndex, hiveId: targetHive.hiveId, tick: ctx.tick, data: ctx.data },
      ctx,
    );
  }
}
