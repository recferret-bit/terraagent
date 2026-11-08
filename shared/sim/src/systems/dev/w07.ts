import { ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { inHex } from '../../grid/hex';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { isColonyGodMode } from '../combat/damage';
import { setUnitStance } from '../combat/stances';
import { emitFaunaDirective } from '../fauna/directives';
import { provokeHive } from '../fauna/provocation';
import { spawnFaunaBug, spawnHiveSite } from '../fauna/spawn';
import { getFaunaHivesState } from '../fauna/state';
import { resolveSpeciesConfig, type FaunaBehaviorMode, type FaunaSpeciesId } from '../fauna/types';
import { getFaunaSpeciesThreatCost, hasAnyAliveColonyEntity, spawnHiveRaidWave } from '../fauna/waves';
import { revealVision, spawnHqUnit } from '../hq';
import { recomputeAllColonyPower } from '../power-core';
import { evaluateColonySupply } from '../supply';
import {
  applyBugFaunaMode,
  applyHiveFaunaMode,
  classifyFaunaEntity,
  ensureDevColony,
  findColonyAnchorTile,
  isSpecies,
  replenishHiveResidentsForDevRaid,
  resolveColonyIdx,
  resolveColonyUnitSpec,
  selectOrSpawnRaidHive,
  syncSpawnedColonyUnitView,
} from './w07Helpers';

function dispatchRaidFromHive(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  budget: number | undefined,
  ctx: StepContext,
): number {
  if (budget !== undefined) {
    const cohort = spawnHiveRaidWave(state, { colonyIndex, hiveId, budget, tick: ctx.tick, data: ctx.data }, ctx);
    return cohort?.memberIds.length ?? 0;
  }
  return spawnHiveRaidWave(state, hiveId, colonyIndex, ctx.tick, ctx);
}

export const devSpawnRaid = defineCommandHandler({
  kind: 'dev.spawnraid',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      hiveId?: number;
      species?: string;
      colonyIndex?: number;
      q?: number;
      r?: number;
      count?: number;
      budget?: number;
    };
    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    ensureDevColony(state, colonyIndex, ctx.tick);
    if (!hasAnyAliveColonyEntity(state, colonyIndex)) {
      spawnHqUnit(state, { owner: colonyIndex, q: 0, r: 0 });
    }

    const resolved = selectOrSpawnRaidHive(state, colonyIndex, args, ctx);
    if (resolved.error || !resolved.hive) return resolved.error ?? 'unknown_entity';

    const hive = resolved.hive;
    const cost = Math.max(1, getFaunaSpeciesThreatCost(hive.species));
    const budget =
      args.budget ??
      (resolved.countOverride !== undefined ? Math.max(cost, resolved.countOverride * cost) : undefined);

    if (budget === undefined) {
      provokeHive(state, hive.hiveId, colonyIndex, ctx.tick, ctx.data, ctx);
    }
    const afterProvoke = getFaunaHivesState(state).hivesById[hive.hiveId];
    const activeId = afterProvoke?.aggressionByColony[colonyIndex]?.activeCohortId;
    const alreadyDispatchedThisTick =
      Boolean(activeId) && afterProvoke?.aggressionByColony[colonyIndex]?.lastWaveTick === ctx.tick;

    let dispatchedCount = alreadyDispatchedThisTick
      ? (getFaunaHivesState(state).cohortsById[activeId!]?.memberIds.length ?? 0)
      : 0;

    if (dispatchedCount === 0) {
      dispatchedCount = dispatchRaidFromHive(state, hive.hiveId, colonyIndex, budget, ctx);
    }
    if (dispatchedCount === 0) {
      replenishHiveResidentsForDevRaid(state, hive.hiveId, colonyIndex, ctx);
      dispatchRaidFromHive(state, hive.hiveId, colonyIndex, budget, ctx);
    }

    const latestFauna = getFaunaHivesState(state);
    const latestHive = latestFauna.hivesById[hive.hiveId];
    const cohortId = latestHive?.aggressionByColony[colonyIndex]?.activeCohortId;
    const cohort = cohortId ? latestFauna.cohortsById[cohortId] : undefined;
    if (latestHive && cohort) {
      emitFaunaDirective(
        state,
        {
          effectiveTick: ctx.tick,
          hiveId: latestHive.hiveId,
          decisionIndex: ++latestHive.decisionIndex,
          kind: 'cohortDispatch',
          payload: {
            cohortId: cohort.cohortId,
            species: latestHive.species,
            memberIds: [...cohort.memberIds],
            targetColony: colonyIndex,
            ...(cohort.targetEntityId !== null ? { targetEntityId: cohort.targetEntityId } : {}),
          },
        },
        ctx,
      );
    }
  },
});

export const devSpawnHive = defineCommandHandler({
  kind: 'dev.spawnhive',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      species?: string;
      q?: number;
      r?: number;
      mode?: string;
      colonyIndex?: number;
      entranceQ?: number;
      entranceR?: number;
      initialResidents?: number;
    };
    const species = args.species ?? 'blackAnt';
    if (!isSpecies(species)) return 'invalid_args';
    const mode = args.mode ?? 'passive';
    if (mode !== 'passive' && mode !== 'aggressive') return 'invalid_args';

    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    ensureDevColony(state, colonyIndex, ctx.tick);
    const anchor = findColonyAnchorTile(state, colonyIndex);
    const q = args.q ?? Math.min(state.grid.radius - 2, anchor.q + 10);
    const r = args.r ?? anchor.r;
    if (!inHex(q, r, state.grid.radius)) return 'invalid_args';

    const hiveId = spawnHiveSite(
      state,
      {
        species,
        q,
        r,
        footprintW: 3,
        footprintD: 3,
        ...(args.entranceQ !== undefined ? { entranceQ: args.entranceQ } : {}),
        ...(args.entranceR !== undefined ? { entranceR: args.entranceR } : {}),
        ...(args.initialResidents !== undefined ? { initialResidents: args.initialResidents } : {}),
      },
      ctx.tick,
      ctx.data,
    );

    if (mode === 'aggressive') {
      provokeHive(state, hiveId, colonyIndex, ctx.tick, ctx.data, ctx);
    }
  },
});

export const devSpawnUnit = defineCommandHandler({
  kind: 'dev.spawnunit',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      unit?: string;
      q?: number;
      r?: number;
      count?: number;
      colonyIndex?: number;
      owner?: number;
    };
    const unitRaw = typeof args.unit === 'string' ? args.unit.trim() : '';
    const count = args.count ?? 1;
    if (!unitRaw || !Number.isInteger(count) || count <= 0 || count > 100) return 'invalid_args';

    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    ensureDevColony(state, colonyIndex, ctx.tick);
    const anchor = findColonyAnchorTile(state, colonyIndex);
    const baseQ = args.q ?? anchor.q + 1;
    const baseR = args.r ?? anchor.r;
    if (!inHex(baseQ, baseR, state.grid.radius)) return 'invalid_args';

    if (isSpecies(unitRaw)) {
      const fallbackHp: Record<FaunaSpeciesId, number> = { blackAnt: 85, blueBeetle: 320, greenSpitter: 130 };
      const cfg = resolveSpeciesConfig(unitRaw, ctx.data);
      for (let i = 0; i < count; i++) {
        spawnFaunaBug(
          state,
          { species: unitRaw, q: baseQ, r: baseR, hp: cfg.hp || fallbackHp[unitRaw] },
          ctx.tick,
          ctx.data,
        );
      }
      return;
    }

    const spec = resolveColonyUnitSpec(unitRaw, ctx);
    if (!spec) return 'invalid_args';

    const owner = args.owner !== undefined ? args.owner : colonyIndex;
    for (let i = 0; i < count; i++) {
      const entityId = ctx.newEntityId();
      const row = insertRow(state.entities, entityId, ctx.tick);
      const cols = state.entities.cols;
      cols.kind[row] = spec.kind;
      cols.owner[row] = owner;
      cols.tier[row] = spec.tier ?? 1;
      cols.hp[row] = Math.fround(spec.hp);
      cols.hpMax[row] = Math.fround(spec.hp);
      cols.state[row] = ENTITY_STATE.idle;
      cols.workRate[row] = 1.0;
      placeSpawnedEntity(state.entities, row, baseQ, baseR, ctx.tick);
      if (owner >= 0) {
        revealVision(state, owner, baseQ, baseR, spec.viewRadius, ctx.tick);
      }
      syncSpawnedColonyUnitView(state, row, spec, ctx);
      setUnitStance(state, entityId, 'defend', { q: baseQ, r: baseR }, ctx.tick);
    }

    if (owner >= 0) {
      evaluateColonySupply(state, owner, ctx.tick, ctx.data);
      recomputeAllColonyPower(state, ctx.data, ctx.tick);
    }
  },
});

export const devGodMode = defineCommandHandler({
  kind: 'dev.godmode',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { enabled?: boolean; colonyIndex?: number };
    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    const colony = ensureDevColony(state, colonyIndex, ctx.tick);
    const current = isColonyGodMode(state, colonyIndex);
    const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : !current;

    const prevRaw = (state.blobs.godMode?.value ?? state.blobs.godMode) as
      | { byColony?: Record<number, boolean> }
      | undefined;
    const byColony: Record<number, boolean> = { ...(prevRaw?.byColony ?? {}), [colonyIndex]: nextEnabled };
    setBlob(state, 'godMode', { byColony }, ctx.tick);
    (colony as { godMode?: boolean }).godMode = nextEnabled;
    colony.changedAt = ctx.tick;
  },
});

export const devFaunaMode = defineCommandHandler({
  kind: 'dev.faunamode',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      id?: number;
      entityId?: number;
      hiveId?: number;
      mode?: FaunaBehaviorMode;
      targetId?: number;
      targetQ?: number;
      targetR?: number;
      q?: number;
      r?: number;
      colonyIndex?: number;
    };
    const entityId = args.id ?? args.entityId ?? args.hiveId;
    if (typeof entityId !== 'number' || !Number.isInteger(entityId) || entityId <= 0) {
      return 'invalid_args';
    }
    if (args.mode !== undefined && args.mode !== 'passive' && args.mode !== 'aggressive') {
      return 'invalid_args';
    }

    let targetQ = args.targetQ ?? args.q;
    let targetR = args.targetR ?? args.r;
    let targetOwner: number | undefined;
    if (args.targetId !== undefined) {
      const tRow = rowOf(state.entities, args.targetId);
      if (tRow < 0 || state.entities.cols.hp[tRow]! <= 0) return 'unknown_entity';
      targetQ = targetQ ?? state.entities.cols.q[tRow]!;
      targetR = targetR ?? state.entities.cols.r[tRow]!;
      if (state.entities.cols.owner[tRow]! >= 0) targetOwner = state.entities.cols.owner[tRow]!;
    }

    const colonyIndex = targetOwner ?? resolveColonyIdx(cmd, args.colonyIndex);
    const hasRetarget = args.targetId !== undefined || (targetQ !== undefined && targetR !== undefined);
    const nextMode: FaunaBehaviorMode = args.mode ?? (hasRetarget ? 'aggressive' : 'passive');
    const { row, isHive, isBug } = classifyFaunaEntity(state, entityId);
    if (!isHive && !isBug) return 'unknown_entity';

    if (isHive) {
      return applyHiveFaunaMode(
        state,
        entityId,
        nextMode,
        colonyIndex,
        hasRetarget,
        args.targetId,
        targetQ,
        targetR,
        ctx,
      );
    }

    applyBugFaunaMode(state, entityId, row, nextMode, colonyIndex, hasRetarget, args.targetId, targetQ, targetR, ctx);
  },
});
